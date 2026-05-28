import crypto from 'node:crypto'
import { Types, type HydratedDocument } from 'mongoose'
import { BusinessMembershipModel, type BusinessMembershipDocument } from '../models/business-membership.model.js'
import { StaffActivityLogModel } from '../models/staff-activity-log.model.js'
import { UserModel } from '../models/user.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import type { CreateActivityLogInput, CreateStaffInput, UpdateStaffInput } from '../validators/staff.validator.js'

type StaffMembershipDoc = HydratedDocument<BusinessMembershipDocument>

export async function listStaff(context: RequestContext, input: { branchId?: string; status?: 'active' | 'inactive' | 'suspended' }) {
  requireManagerRole(context)
  const query: Record<string, unknown> = { businessAccountId: context.businessAccountId }
  if (input.status) query.status = input.status
  if (input.branchId) query.assignedBranchIds = objectId(input.branchId)
  const memberships = await BusinessMembershipModel.find(query).sort({ createdAt: -1 })
  return serializeMemberships(memberships)
}

export async function getStaff(context: RequestContext, staffId: Types.ObjectId) {
  requireManagerRole(context)
  const membership = await BusinessMembershipModel.findOne({ _id: staffId, businessAccountId: context.businessAccountId })
  if (!membership) throw notFound('Staff member not found')
  return serializeMembership(membership)
}

export async function createStaff(context: RequestContext, input: CreateStaffInput) {
  requireManagerRole(context)
  if (!context.businessAccountId) throw new ApiError(403, 'business_required', 'Business context required')

  const email = input.email?.toLowerCase()
  const firebaseUid = input.firebaseUid ?? (email ? `pending:${email}` : `pending:${crypto.randomUUID()}`)
  let user = await UserModel.findOne({ $or: [{ firebaseUid }, ...(email ? [{ email }] : [])] })
  if (!user) {
    user = await UserModel.create({
      firebaseUid,
      email,
      phone: input.phone,
      fullName: input.fullName
    })
  } else {
    user.email = email ?? user.email
    user.phone = input.phone ?? user.phone
    user.fullName = input.fullName ?? user.fullName
    await user.save()
  }

  const existing = await BusinessMembershipModel.findOne({ businessAccountId: context.businessAccountId, userId: user._id })
  if (existing) throw new ApiError(409, 'staff_already_exists', 'User is already a staff member for this business')

  const membership = await BusinessMembershipModel.create({
    businessAccountId: context.businessAccountId,
    userId: user._id,
    role: input.role,
    assignedBranchIds: input.branchIds.map(objectId),
    permissions: input.permissions,
    employeeId: input.employeeId,
    salary: input.salary,
    emergencyContact: input.emergencyContact,
    createdBy: context.userId
  })
  await writeStaffActivity(context, {
    staffId: membership._id.toString(),
    action: 'staff_created',
    description: `Staff member ${input.fullName} was created`,
    metadata: { role: input.role },
    severity: 'info'
  })
  return serializeMembership(membership)
}

export async function updateStaff(context: RequestContext, staffId: Types.ObjectId, input: UpdateStaffInput) {
  requireManagerRole(context)
  const membership = await BusinessMembershipModel.findOne({ _id: staffId, businessAccountId: context.businessAccountId })
  if (!membership) throw notFound('Staff member not found')
  const user = await UserModel.findById(membership.userId)
  if (!user) throw notFound('Staff user not found')

  if (input.email !== undefined) user.email = input.email?.toLowerCase()
  if (input.phone !== undefined) user.phone = input.phone
  if (input.fullName !== undefined) user.fullName = input.fullName
  await user.save()

  if (input.role !== undefined) membership.role = input.role
  if (input.status !== undefined) membership.status = input.status
  if (input.branchIds !== undefined) membership.assignedBranchIds = input.branchIds.map(objectId)
  if (input.permissions !== undefined) membership.permissions = input.permissions
  if (input.employeeId !== undefined) membership.employeeId = input.employeeId
  if (input.salary !== undefined) membership.salary = input.salary
  if (input.emergencyContact !== undefined) membership.emergencyContact = input.emergencyContact
  if (input.twoFactorEnabled !== undefined) membership.twoFactorEnabled = input.twoFactorEnabled
  await membership.save()

  await writeStaffActivity(context, {
    staffId: membership._id.toString(),
    action: 'staff_updated',
    description: `Staff member ${user.fullName ?? user.email ?? membership._id.toString()} was updated`,
    metadata: { changedFields: Object.keys(input) },
    severity: 'info'
  })
  return serializeMembership(membership)
}

export async function deactivateStaff(context: RequestContext, staffId: Types.ObjectId) {
  return updateStaff(context, staffId, { status: 'inactive' })
}

export async function activateStaff(context: RequestContext, staffId: Types.ObjectId) {
  return updateStaff(context, staffId, { status: 'active' })
}

export async function setupStaffTwoFactor(context: RequestContext, staffId?: Types.ObjectId) {
  const targetId = staffId ?? context.membershipId
  if (!targetId) throw new ApiError(403, 'business_required', 'Business context required')
  const membership = await membershipForTwoFactor(context, targetId)
  const secret = randomBase32Secret()
  membership.twoFactorSecret = secret
  membership.twoFactorEnabled = false
  await membership.save()
  return {
    secret,
    otpauthUrl: `otpauth://totp/FahamPesa:${membership._id.toString()}?secret=${secret}&issuer=FahamPesa`
  }
}

export async function verifyStaffTwoFactor(context: RequestContext, token: string, staffId?: Types.ObjectId) {
  const targetId = staffId ?? context.membershipId
  if (!targetId) throw new ApiError(403, 'business_required', 'Business context required')
  const membership = await membershipForTwoFactor(context, targetId)
  if (!membership.twoFactorSecret) throw new ApiError(400, 'two_factor_not_setup', 'Two-factor setup has not been started')
  if (!verifyTotp(membership.twoFactorSecret, token)) throw new ApiError(400, 'invalid_two_factor_token', 'Invalid two-factor token')
  membership.twoFactorEnabled = true
  await membership.save()
  return { enabled: true }
}

export async function disableStaffTwoFactor(context: RequestContext, staffId?: Types.ObjectId) {
  const targetId = staffId ?? context.membershipId
  if (!targetId) throw new ApiError(403, 'business_required', 'Business context required')
  const membership = await membershipForTwoFactor(context, targetId)
  membership.twoFactorEnabled = false
  membership.twoFactorSecret = undefined
  await membership.save()
  return { enabled: false }
}

export async function listStaffActivityLogs(context: RequestContext, input: { staffId?: string; limit: number }) {
  requireManagerRole(context)
  const query: Record<string, unknown> = { businessAccountId: context.businessAccountId }
  if (input.staffId) query.staffMembershipId = objectId(input.staffId)
  const logs = await StaffActivityLogModel.find(query).sort({ createdAt: -1 }).limit(input.limit)
  return logs.map((log) => normalizeMongo(log.toObject({ versionKey: false })))
}

export async function writeStaffActivity(context: RequestContext, input: CreateActivityLogInput) {
  if (!context.businessAccountId) throw new ApiError(403, 'business_required', 'Business context required')
  const log = await StaffActivityLogModel.create({
    businessAccountId: context.businessAccountId,
    staffMembershipId: input.staffId ? objectId(input.staffId) : undefined,
    actorUserId: context.userId,
    action: input.action,
    description: input.description,
    severity: input.severity,
    metadata: input.metadata
  })
  return normalizeMongo(log.toObject({ versionKey: false }))
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  if (context.role !== 'owner' && context.role !== 'manager') {
    throw new ApiError(403, 'manager_required', 'Only owners and managers can manage staff')
  }
}

async function membershipForTwoFactor(context: RequestContext, targetId: Types.ObjectId) {
  const membership = await BusinessMembershipModel.findOne({ _id: targetId, businessAccountId: context.businessAccountId }).select('+twoFactorSecret')
  if (!membership) throw notFound('Staff member not found')
  if (context.role !== 'owner' && context.membershipId?.toString() !== targetId.toString()) {
    throw new ApiError(403, 'staff_forbidden', 'You cannot manage two-factor settings for this staff member')
  }
  return membership
}

async function serializeMemberships(memberships: StaffMembershipDoc[]) {
  return Promise.all(memberships.map((membership) => serializeMembership(membership)))
}

async function serializeMembership(membership: StaffMembershipDoc) {
  const user = await UserModel.findById(membership.userId)
  const base = normalizeMongo(membership.toObject({ versionKey: false })) as Record<string, unknown>
  return {
    ...base,
    user: user ? normalizeMongo(user.toObject({ versionKey: false })) : null,
    fullName: user?.fullName,
    email: user?.email,
    phone: user?.phone
  }
}

function objectId(value: string) {
  if (!Types.ObjectId.isValid(value)) throw new ApiError(400, 'invalid_object_id', 'Invalid object id')
  return new Types.ObjectId(value)
}

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function randomBase32Secret() {
  const bytes = crypto.randomBytes(20)
  let output = ''
  for (const byte of bytes) output += base32Alphabet[byte % base32Alphabet.length]
  return output
}

function verifyTotp(secret: string, token: string) {
  const step = Math.floor(Date.now() / 30000)
  return [step - 1, step, step + 1].some((candidate) => totp(secret, candidate) === token)
}

function totp(secret: string, step: number) {
  const buffer = Buffer.alloc(8)
  buffer.writeBigInt64BE(BigInt(step))
  const hmac = crypto.createHmac('sha1', decodeBase32(secret)).update(buffer).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)
  return (code % 1000000).toString().padStart(6, '0')
}

function decodeBase32(value: string) {
  let bits = ''
  for (const char of value.replace(/=+$/, '').toUpperCase()) {
    const index = base32Alphabet.indexOf(char)
    if (index === -1) throw new ApiError(400, 'invalid_two_factor_secret', 'Invalid two-factor secret')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}
