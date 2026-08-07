import crypto from 'node:crypto'
import { Types, type ClientSession, type HydratedDocument } from 'mongoose'
import { env } from '../config/env.js'
import { StaffInvitationModel, type StaffInvitationDocument } from '../models/staff-invitation.model.js'
import { BusinessMembershipModel } from '../models/business-membership.model.js'
import { BusinessAccountModel } from '../models/business-account.model.js'
import { BranchModel } from '../models/branch.model.js'
import { UserModel } from '../models/user.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { sendStaffInvitationEmail } from './email.service.js'

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

type InvitationRole = 'admin' | 'manager' | 'staff' | 'cashier'

export interface CreateStaffInvitationInput {
  businessAccountId: Types.ObjectId
  email: string
  role: InvitationRole
  assignedBranchIds: Types.ObjectId[]
  permissions?: string[]
  invitedBy: Types.ObjectId
  session?: ClientSession
}

export async function createStaffInvitation(input: CreateStaffInvitationInput) {
  const rawToken = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashInvitationToken(rawToken)
  const email = input.email.toLowerCase()
  const now = new Date()

  await StaffInvitationModel.updateMany(
    {
      businessAccountId: input.businessAccountId,
      email,
      status: 'pending'
    },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: now
      }
    },
    input.session ? { session: input.session } : {}
  )

  const [invitation] = await StaffInvitationModel.create(
    [
      {
        businessAccountId: input.businessAccountId,
        email,
        sourceRole: input.role,
        role: mapInvitationRole(input.role),
        tokenHash,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        assignedBranchIds: input.assignedBranchIds,
        permissions: input.permissions ?? [],
        invitedBy: input.invitedBy
      }
    ],
    input.session ? { session: input.session } : {}
  )

  return serializeInvitation(invitation, rawToken)
}

export async function listStaffInvitations(context: RequestContext, input: { status?: 'pending' | 'accepted' | 'cancelled' }) {
  requireManagerRole(context)
  const query: Record<string, unknown> = { businessAccountId: context.businessAccountId }
  if (input.status) query.status = input.status
  const invitations = await StaffInvitationModel.find(query).sort({ createdAt: -1 })
  return invitations.map((invitation) => serializeInvitation(invitation))
}

export async function inviteStaff(context: RequestContext, input: {
  email: string
  role: 'manager' | 'cashier'
  branchIds: string[]
  permissions: string[]
}) {
  requireManagerRole(context)
  if (!context.businessAccountId) throw new ApiError(403, 'business_required', 'Business context required')

  const invitation = await createStaffInvitation({
    businessAccountId: context.businessAccountId,
    email: input.email,
    role: input.role,
    assignedBranchIds: input.branchIds.map(objectId),
    permissions: input.permissions,
    invitedBy: context.userId
  })

  // Best-effort invitation email; the invite (and its shareable link) succeeds either way.
  const [account, branches] = await Promise.all([
    BusinessAccountModel.findById(context.businessAccountId).select('businessName').lean(),
    BranchModel.find({ _id: { $in: input.branchIds.map(objectId) } }).select('name').lean()
  ])
  const emailSent = await sendStaffInvitationEmail({
    to: input.email,
    businessName: account?.businessName ?? 'a business',
    role: mapInvitationRole(input.role),
    branchNames: branches.map((branch) => branch.name),
    inviteUrl: String((invitation as { inviteUrl?: unknown }).inviteUrl ?? ''),
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS)
  })

  return { ...invitation, emailSent }
}

export async function cancelStaffInvitation(context: RequestContext, invitationId: Types.ObjectId) {
  requireManagerRole(context)
  const invitation = await StaffInvitationModel.findOne({
    _id: invitationId,
    businessAccountId: context.businessAccountId
  })
  if (!invitation) throw new ApiError(404, 'invitation_not_found', 'Staff invitation not found')
  if (invitation.status === 'accepted') throw new ApiError(409, 'invitation_already_accepted', 'Staff invitation has already been accepted')

  invitation.status = 'cancelled'
  invitation.cancelledAt = new Date()
  await invitation.save()
  return serializeInvitation(invitation)
}

/**
 * Look up an invitation by its raw token to show the invitee what they were invited to.
 * Returns only non-sensitive context (no token hash). Requires a valid token (the secret).
 */
export async function lookupStaffInvitation(token: string) {
  const tokenHash = hashInvitationToken(token)
  const invitation = await StaffInvitationModel.findOne({ tokenHash }).select('+tokenHash')
  if (!invitation) throw new ApiError(404, 'invitation_not_found', 'Staff invitation not found')

  const [account, branches] = await Promise.all([
    BusinessAccountModel.findById(invitation.businessAccountId).select('businessName').lean(),
    BranchModel.find({ _id: { $in: invitation.assignedBranchIds } }).select('name').lean()
  ])

  return {
    email: invitation.email,
    role: invitation.role,
    sourceRole: invitation.sourceRole,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    expired: invitation.expiresAt.getTime() <= Date.now(),
    businessName: account?.businessName ?? 'this business',
    branchNames: branches.map((branch) => branch.name)
  }
}

/**
 * Pending invitations addressed to the signed-in user's own email. Auth-only (no business
 * context) — invitees have no membership yet. Lets the app recognise an invited staff
 * member who signed up through the normal flow and keep them out of business onboarding.
 */
export async function listMyPendingInvitations(context: RequestContext) {
  const email = context.auth.email?.toLowerCase()
  if (!email) return []

  const invitations = await StaffInvitationModel.find({
    email,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 })
  if (!invitations.length) return []

  const accountIds = [...new Set(invitations.map((inv) => inv.businessAccountId.toString()))]
  const branchIds = [...new Set(invitations.flatMap((inv) => inv.assignedBranchIds.map((id) => id.toString())))]
  const [accounts, branches] = await Promise.all([
    BusinessAccountModel.find({ _id: { $in: accountIds.map((id) => new Types.ObjectId(id)) } }).select('businessName').lean(),
    BranchModel.find({ _id: { $in: branchIds.map((id) => new Types.ObjectId(id)) } }).select('name').lean()
  ])
  const accountNames = new Map(accounts.map((account) => [account._id.toString(), account.businessName]))
  const branchNames = new Map(branches.map((branch) => [branch._id.toString(), branch.name]))

  return invitations.map((invitation) => ({
    id: invitation._id.toString(),
    businessName: accountNames.get(invitation.businessAccountId.toString()) ?? 'a business',
    role: invitation.role,
    branchNames: invitation.assignedBranchIds
      .map((id) => branchNames.get(id.toString()))
      .filter((name): name is string => Boolean(name)),
    expiresAt: invitation.expiresAt.toISOString()
  }))
}

/**
 * Re-send an invitation email to the signed-in user themselves. Only the token HASH is
 * stored, so the original link can't be reconstructed — we rotate the token and email the
 * new link. Safe without further checks because the mail only ever goes to the invited
 * address, which must equal the caller's own email.
 */
export async function resendMyInvitation(context: RequestContext, invitationId: Types.ObjectId) {
  const email = context.auth.email?.toLowerCase()
  const invitation = await StaffInvitationModel.findById(invitationId).select('+tokenHash')
  if (!invitation || !email || invitation.email !== email) {
    throw new ApiError(404, 'invitation_not_found', 'Staff invitation not found')
  }
  if (invitation.status !== 'pending') {
    throw new ApiError(409, 'invitation_not_pending', 'Staff invitation is no longer pending')
  }
  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(410, 'invitation_expired', 'Staff invitation has expired')
  }

  const rawToken = crypto.randomBytes(32).toString('base64url')
  invitation.tokenHash = hashInvitationToken(rawToken)
  await invitation.save()

  const [account, branches] = await Promise.all([
    BusinessAccountModel.findById(invitation.businessAccountId).select('businessName').lean(),
    BranchModel.find({ _id: { $in: invitation.assignedBranchIds } }).select('name').lean()
  ])
  const emailSent = await sendStaffInvitationEmail({
    to: invitation.email,
    businessName: account?.businessName ?? 'a business',
    role: invitation.role,
    branchNames: branches.map((branch) => branch.name),
    inviteUrl: buildInviteUrl(rawToken),
    expiresAt: invitation.expiresAt
  })

  return { emailSent }
}

export async function acceptStaffInvitation(context: RequestContext, token: string) {
  const tokenHash = hashInvitationToken(token)
  const invitation = await StaffInvitationModel.findOne({ tokenHash }).select('+tokenHash')
  if (!invitation) throw new ApiError(404, 'invitation_not_found', 'Staff invitation not found')
  if (invitation.status === 'accepted') throw new ApiError(409, 'invitation_already_accepted', 'Staff invitation has already been accepted')
  if (invitation.status === 'cancelled') throw new ApiError(410, 'invitation_cancelled', 'Staff invitation has been cancelled')
  if (invitation.expiresAt.getTime() <= Date.now()) throw new ApiError(410, 'invitation_expired', 'Staff invitation has expired')

  const authEmail = context.auth.email?.toLowerCase()
  if (!authEmail || authEmail !== invitation.email) {
    throw new ApiError(403, 'invitation_email_mismatch', 'Signed-in email must match the invited email')
  }

  const existing = await BusinessMembershipModel.findOne({
    businessAccountId: invitation.businessAccountId,
    userId: context.userId
  })
  if (existing) {
    // Already a member: treat accepting as a no-op success instead of consuming
    // the invite AND erroring (which read as a confusing dead-end to the invitee).
    invitation.status = 'accepted'
    invitation.acceptedAt = new Date()
    invitation.acceptedByUserId = context.userId
    await invitation.save()
    return {
      invitation: serializeInvitation(invitation),
      membership: normalizeMongo(existing.toObject({ versionKey: false })),
      businessAccountId: invitation.businessAccountId.toString(),
      role: existing.role,
      assignedBranchIds: existing.assignedBranchIds.map((id) => id.toString()),
      alreadyMember: true
    }
  }

  await UserModel.updateOne(
    { _id: context.userId },
    {
      $set: {
        email: invitation.email,
        lastLoginAt: new Date()
      }
    }
  )

  const membership = await BusinessMembershipModel.create({
    businessAccountId: invitation.businessAccountId,
    userId: context.userId,
    role: invitation.role,
    assignedBranchIds: invitation.assignedBranchIds,
    permissions: invitation.permissions ?? [],
    createdBy: invitation.invitedBy
  })

  invitation.status = 'accepted'
  invitation.acceptedAt = new Date()
  invitation.acceptedByUserId = context.userId
  await invitation.save()

  return {
    invitation: serializeInvitation(invitation),
    membership: normalizeMongo(membership.toObject({ versionKey: false })),
    businessAccountId: invitation.businessAccountId.toString(),
    role: membership.role,
    assignedBranchIds: membership.assignedBranchIds.map((id) => id.toString())
  }
}

export function serializeInvitation(invitation: HydratedDocument<StaffInvitationDocument>, rawToken?: string) {
  const base = normalizeMongo(invitation.toObject({ versionKey: false })) as Record<string, unknown>
  delete base.tokenHash
  // Surface expiry as a real state: a "pending" invite past its TTL is dead, and
  // showing it as Pending forever hid the need to re-send.
  const expired = invitation.status === 'pending' && invitation.expiresAt.getTime() <= Date.now()
  base.expired = expired
  if (expired) base.status = 'expired'
  if (!rawToken) return base
  return {
    ...base,
    inviteUrl: buildInviteUrl(rawToken)
  }
}

function buildInviteUrl(token: string) {
  const baseUrl =
    env.STAFF_INVITE_BASE_URL ??
    env.NEXT_PUBLIC_BASE_URL ??
    (env.NODE_ENV === 'production' ? 'https://fahampesa.com' : env.APP_BASE_URL)
  const url = new URL('/staff/invite', baseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

function hashInvitationToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function mapInvitationRole(role: InvitationRole) {
  if (role === 'staff' || role === 'cashier') return 'cashier'
  return 'manager'
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  if (context.role !== 'owner' && context.role !== 'manager') {
    throw new ApiError(403, 'manager_required', 'Only owners and managers can manage staff')
  }
}

function objectId(value: string) {
  if (!Types.ObjectId.isValid(value)) throw new ApiError(400, 'invalid_object_id', 'Invalid object id')
  return new Types.ObjectId(value)
}
