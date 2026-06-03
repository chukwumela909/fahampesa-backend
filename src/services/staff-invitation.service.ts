import crypto from 'node:crypto'
import { Types, type ClientSession, type HydratedDocument } from 'mongoose'
import { env } from '../config/env.js'
import { StaffInvitationModel, type StaffInvitationDocument } from '../models/staff-invitation.model.js'
import { BusinessMembershipModel } from '../models/business-membership.model.js'
import { UserModel } from '../models/user.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'

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

  return createStaffInvitation({
    businessAccountId: context.businessAccountId,
    email: input.email,
    role: input.role,
    assignedBranchIds: input.branchIds.map(objectId),
    permissions: input.permissions,
    invitedBy: context.userId
  })
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
    invitation.status = 'accepted'
    invitation.acceptedAt = new Date()
    invitation.acceptedByUserId = context.userId
    await invitation.save()
    throw new ApiError(409, 'staff_already_exists', 'User is already a staff member for this business')
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
  if (!rawToken) return base
  return {
    ...base,
    inviteUrl: buildInviteUrl(rawToken)
  }
}

function buildInviteUrl(token: string) {
  const baseUrl = env.NEXT_PUBLIC_BASE_URL ?? env.APP_BASE_URL
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
