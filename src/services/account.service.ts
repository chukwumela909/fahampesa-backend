import { Types, type ClientSession } from 'mongoose'
import { BusinessAccountModel } from '../models/business-account.model.js'
import { BusinessMembershipModel } from '../models/business-membership.model.js'
import { SettingsModel } from '../models/settings.model.js'
import { BranchModel } from '../models/branch.model.js'
import { UserModel } from '../models/user.model.js'
import { ApiError } from '../utils/api-error.js'
import { withTransaction } from '../config/database.js'
import { writeAuditLog } from './audit.service.js'
import { markOnboardingCompleted } from './onboarding.service.js'
import { createStaffInvitation } from './staff-invitation.service.js'

export function billingRegionFromCountry(country: string) {
  return country.trim().toLowerCase() === 'kenya' ? 'KENYA' : 'OTHER'
}

export function getEffectiveBranchLimit(account: {
  planTier: 'free' | 'paid'
  branchLimitOverride?: number | null
}) {
  if (typeof account.branchLimitOverride === 'number') return account.branchLimitOverride
  return account.planTier === 'paid' ? 6 : 1
}

export function isBusinessWritable(account: {
  accountStatus: 'active' | 'paused' | 'revoked'
  planTier: 'free' | 'paid'
  subscriptionStatus: 'none' | 'pending' | 'active' | 'expired' | 'failed' | 'cancelled'
  subscriptionEndsAt?: Date | null
}) {
  if (account.accountStatus !== 'active') return false
  if (account.planTier === 'free') return true
  if (account.subscriptionStatus !== 'active') return false
  if (!account.subscriptionEndsAt) return false
  return account.subscriptionEndsAt.getTime() > Date.now()
}

export async function resolveActiveMembership(userId: Types.ObjectId) {
  const membership = await BusinessMembershipModel.findOne({ userId, status: 'active' }).sort({ createdAt: 1 })
  if (!membership) return null

  const account = await BusinessAccountModel.findById(membership.businessAccountId)
  if (!account) return null

  return { membership, account }
}

export interface OnboardBusinessInput {
  userId: Types.ObjectId
  personalProfile?: {
    fullName?: string
    phoneNumber?: string
    phoneVerified?: boolean
  }
  companyProfile?: {
    legalCompanyName?: string
    registrationNumber?: string
  }
  business: {
    businessName: string
    businessType: string
    country: string
    currency: string
  }
  branch: {
    name: string
    location: {
      address: string
      city?: string
      region?: string
      postalCode?: string
      country?: string
      latitude?: number
      longitude?: number
      landmark?: string
      directions?: string
    }
    contact?: {
      phone?: string
      alternatePhone?: string
      email?: string
      whatsapp?: string
    }
    branchCode?: string
    branchType?: 'MAIN' | 'BRANCH' | 'OUTLET' | 'WAREHOUSE' | 'KIOSK'
    description?: string
    currency?: string
  }
  staffInvitations?: {
    email: string
    role: 'admin' | 'manager' | 'staff' | 'cashier'
    branchIds?: string[]
    permissions?: string[]
  }[]
  requestMeta?: {
    ipAddress?: string
    userAgent?: string
  }
}

export async function onboardBusiness(input: OnboardBusinessInput) {
  const existing = await BusinessMembershipModel.findOne({ userId: input.userId, status: 'active' })
  if (existing) {
    throw new ApiError(409, 'business_already_exists', 'User already has an active business membership')
  }

  return withTransaction(async (session) => createBusinessWithOwnerAndBranch(input, session.inTransaction() ? session : undefined))
}

async function createBusinessWithOwnerAndBranch(input: OnboardBusinessInput, session?: ClientSession) {
  await updateOwnerProfile(input, session)

  const [account] = await BusinessAccountModel.create(
    [
      {
        businessName: input.business.businessName,
        businessType: input.business.businessType,
        legalCompanyName: input.companyProfile?.legalCompanyName,
        registrationNumber: input.companyProfile?.registrationNumber,
        country: input.business.country,
        billingRegion: billingRegionFromCountry(input.business.country),
        currency: input.business.currency,
        planTier: 'free',
        subscriptionStatus: 'none',
        createdByUserId: input.userId,
        settings: {}
      }
    ],
    session ? { session } : {}
  )

  const [branch] = await BranchModel.create(
    [
      {
        businessAccountId: account._id,
        name: input.branch.name,
        location: {
          ...input.branch.location,
          country: input.branch.location.country || input.business.country
        },
        contact: input.branch.contact || {},
        branchCode: input.branch.branchCode || 'MAIN',
        branchType: input.branch.branchType || 'MAIN',
        currency: input.branch.currency || input.business.currency,
        createdBy: input.userId
      }
    ],
    session ? { session } : {}
  )

  const [membership] = await BusinessMembershipModel.create(
    [
      {
        businessAccountId: account._id,
        userId: input.userId,
        role: 'owner',
        assignedBranchIds: [branch._id],
        permissions: ['all:*'],
        createdBy: input.userId
      }
    ],
    session ? { session } : {}
  )

  const invitations = []
  if (input.staffInvitations?.length) {
    for (const invitation of input.staffInvitations) {
      invitations.push(
        await createStaffInvitation({
          businessAccountId: account._id,
          email: invitation.email,
          role: invitation.role,
          assignedBranchIds: invitation.branchIds?.length ? invitation.branchIds.map(objectId) : [branch._id],
          permissions: invitation.permissions,
          invitedBy: input.userId,
          session
        })
      )
    }
  }

  await SettingsModel.create(
    [
      {
        businessAccountId: account._id,
        businessProfile: {
          businessName: account.businessName,
          businessType: account.businessType,
          legalCompanyName: account.legalCompanyName,
          companyLegalName: account.legalCompanyName,
          registrationNumber: account.registrationNumber,
          companyRegistrationNumber: account.registrationNumber,
          country: account.country,
          currency: account.currency,
          ownerFullName: input.personalProfile?.fullName,
          ownerPhoneNumber: input.personalProfile?.phoneNumber
        },
        syncSettings: {
          offlineSyncEnabled: true,
          autoSyncInterval: 30
        }
      }
    ],
    session ? { session } : {}
  )

  await writeAuditLog(
    {
      scope: 'business',
      businessAccountId: account._id,
      actorUserId: input.userId,
      actorRole: 'owner',
      action: 'business.onboarded',
      targetType: 'business_account',
      targetId: account._id,
      branchId: branch._id,
      metadata: { branchName: branch.name },
      ipAddress: input.requestMeta?.ipAddress,
      userAgent: input.requestMeta?.userAgent
    },
    session
  )

  await markOnboardingCompleted(
    input.userId,
    {
      personalProfile: input.personalProfile ?? {},
      companyProfile: input.companyProfile ?? {},
      business: input.business,
      branch: input.branch,
      staffInvitations: input.staffInvitations ?? []
    },
    session
  )

  return { account, branch, membership, invitations }
}

async function updateOwnerProfile(input: OnboardBusinessInput, session?: ClientSession) {
  const profileUpdate: Record<string, unknown> = {}
  if (input.personalProfile?.fullName) profileUpdate.fullName = input.personalProfile.fullName
  if (input.personalProfile?.phoneNumber) profileUpdate.phone = input.personalProfile.phoneNumber
  if (input.personalProfile?.phoneVerified !== undefined) profileUpdate.phoneVerified = input.personalProfile.phoneVerified
  if (Object.keys(profileUpdate).length === 0) return

  await UserModel.updateOne({ _id: input.userId }, { $set: profileUpdate }, session ? { session } : {})
}

function objectId(value: string) {
  if (!Types.ObjectId.isValid(value)) throw new ApiError(400, 'invalid_object_id', 'Invalid object id')
  return new Types.ObjectId(value)
}
