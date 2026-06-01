import type { ClientSession, Types } from 'mongoose'
import { BranchModel } from '../models/branch.model.js'
import { BusinessAccountModel } from '../models/business-account.model.js'
import { BusinessMembershipModel } from '../models/business-membership.model.js'
import { withTransaction } from '../config/database.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { getEffectiveBranchLimit } from './account.service.js'
import { writeAuditLog } from './audit.service.js'
import type { RequestContext } from '../types/http.js'

export interface BranchInput {
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
  openingHours?: unknown[]
  managerUserId?: Types.ObjectId | null
  branchCode?: string
  branchType?: 'MAIN' | 'BRANCH' | 'OUTLET' | 'WAREHOUSE' | 'KIOSK'
  description?: string
  currency?: string
  taxSettings?: {
    chargeTax?: boolean
    taxRate?: number
    taxNumber?: string
  }
}

export async function listBranches(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')

  const base = { businessAccountId: context.businessAccountId, status: { $ne: 'disabled' } }
  if (context.role === 'owner') {
    return BranchModel.find(base).sort({ createdAt: 1 })
  }

  return BranchModel.find({
    ...base,
    _id: { $in: context.assignedBranchIds }
  }).sort({ createdAt: 1 })
}

export async function getBranchForContext(context: RequestContext, branchId: Types.ObjectId, includeDisabled = false) {
  ensureBranchAccess(context, branchId)
  const query: Record<string, unknown> = {
    _id: branchId,
    businessAccountId: context.businessAccountId
  }
  if (!includeDisabled) query.status = { $ne: 'disabled' }
  const branch = await BranchModel.findOne(query)
  if (!branch) throw notFound('Branch not found')
  return branch
}

export async function createBranch(context: RequestContext, input: BranchInput, requestMeta?: { ipAddress?: string; userAgent?: string }) {
  requireBusinessContext(context)
  if (context.role !== 'owner') throw new ApiError(403, 'owner_required', 'Only owners can create branches')

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const account = await BusinessAccountModel.findById(context.businessAccountId).session(activeSession ?? null)
    if (!account) throw notFound('Business account not found')

    const activeBranchCount = await BranchModel.countDocuments({
      businessAccountId: context.businessAccountId,
      status: { $ne: 'disabled' }
    }).session(activeSession ?? null)

    const limit = getEffectiveBranchLimit({
      planTier: account.planTier,
      branchLimitOverride: account.branchLimitOverride
    })

    if (activeBranchCount >= limit) {
      throw new ApiError(403, 'branch_limit_reached', `Branch limit reached for current plan (${limit})`)
    }

    const branchInput = omitUndefined(input)
    const [branch] = await BranchModel.create(
      [
        {
          businessAccountId: context.businessAccountId,
          ...branchInput,
          contact: input.contact || {},
          openingHours: input.openingHours || [],
          createdBy: context.userId
        }
      ],
      activeSession ? { session: activeSession } : {}
    )

    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId: context.businessAccountId,
        actorUserId: context.userId,
        actorRole: context.role,
        action: 'branch.created',
        targetType: 'branch',
        targetId: branch._id,
        branchId: branch._id,
        metadata: { branchName: branch.name },
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent
      },
      activeSession
    )

    return branch
  })
}

export async function updateBranch(
  context: RequestContext,
  branchId: Types.ObjectId,
  input: Partial<BranchInput & { status: 'active' | 'inactive' | 'under_maintenance' | 'temporarily_closed' }>,
  requestMeta?: { ipAddress?: string; userAgent?: string }
) {
  requireBusinessContext(context)
  if (context.role !== 'owner' && context.role !== 'manager') {
    throw new ApiError(403, 'manager_required', 'Only owners and managers can update branches')
  }
  ensureBranchAccess(context, branchId)

  const branch = await BranchModel.findOneAndUpdate(
    { _id: branchId, businessAccountId: context.businessAccountId, status: { $ne: 'disabled' } },
    { $set: sanitizeBranchUpdate(input) },
    { new: true }
  )
  if (!branch) throw notFound('Branch not found')

  await writeAuditLog({
    scope: 'business',
    businessAccountId: context.businessAccountId,
    actorUserId: context.userId,
    actorRole: context.role,
    action: 'branch.updated',
    targetType: 'branch',
    targetId: branch._id,
    branchId: branch._id,
    metadata: { fields: Object.keys(input) },
    ipAddress: requestMeta?.ipAddress,
    userAgent: requestMeta?.userAgent
  })

  return branch
}

export async function disableBranch(context: RequestContext, branchId: Types.ObjectId, requestMeta?: { ipAddress?: string; userAgent?: string }) {
  requireBusinessContext(context)
  if (context.role !== 'owner') throw new ApiError(403, 'owner_required', 'Only owners can disable branches')

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const branch = await BranchModel.findOneAndUpdate(
      { _id: branchId, businessAccountId: context.businessAccountId, status: { $ne: 'disabled' } },
      { $set: { status: 'disabled', disabledAt: new Date(), disabledBy: context.userId } },
      activeSession ? { new: true, session: activeSession } : { new: true }
    )
    if (!branch) throw notFound('Branch not found')

    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId: context.businessAccountId,
        actorUserId: context.userId,
        actorRole: context.role,
        action: 'branch.disabled',
        targetType: 'branch',
        targetId: branch._id,
        branchId: branch._id,
        metadata: { branchName: branch.name },
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent
      },
      activeSession
    )

    return branch
  })
}

export async function enableBranch(context: RequestContext, branchId: Types.ObjectId, requestMeta?: { ipAddress?: string; userAgent?: string }) {
  requireBusinessContext(context)
  if (context.role !== 'owner') throw new ApiError(403, 'owner_required', 'Only owners can enable branches')

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const account = await BusinessAccountModel.findById(context.businessAccountId).session(activeSession ?? null)
    if (!account) throw notFound('Business account not found')

    const activeBranchCount = await BranchModel.countDocuments({
      businessAccountId: context.businessAccountId,
      status: { $ne: 'disabled' }
    }).session(activeSession ?? null)
    const limit = getEffectiveBranchLimit({
      planTier: account.planTier,
      branchLimitOverride: account.branchLimitOverride
    })
    if (activeBranchCount >= limit) {
      throw new ApiError(403, 'branch_limit_reached', `Branch limit reached for current plan (${limit})`)
    }

    const branch = await BranchModel.findOneAndUpdate(
      { _id: branchId, businessAccountId: context.businessAccountId, status: 'disabled' },
      { $set: { status: 'active', disabledAt: null, disabledBy: null } },
      activeSession ? { new: true, session: activeSession } : { new: true }
    )
    if (!branch) throw notFound('Branch not found')

    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId: context.businessAccountId,
        actorUserId: context.userId,
        actorRole: context.role,
        action: 'branch.enabled',
        targetType: 'branch',
        targetId: branch._id,
        branchId: branch._id,
        metadata: { branchName: branch.name },
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent
      },
      activeSession
    )

    return branch
  })
}

export function ensureBranchAccess(context: RequestContext, branchId: Types.ObjectId) {
  requireBusinessContext(context)
  if (context.role === 'owner') return

  const allowed = context.assignedBranchIds.some((assigned) => assigned.equals(branchId))
  if (!allowed) {
    throw new ApiError(403, 'branch_forbidden', 'You do not have access to this branch')
  }
}

function requireBusinessContext(context: RequestContext) {
  if (!context.businessAccountId || !context.role) {
    throw new ApiError(403, 'business_required', 'Business context required')
  }
}

function sanitizeBranchUpdate(input: Partial<BranchInput & { status: string }>) {
  const forbidden = new Set(['businessAccountId', 'createdBy', 'disabledAt', 'disabledBy'])
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => !forbidden.has(key) && value !== undefined))
}

function omitUndefined<T extends object>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}
