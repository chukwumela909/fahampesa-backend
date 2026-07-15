import type { ClientSession, Types } from 'mongoose'
import { BranchModel } from '../models/branch.model.js'
import { BusinessAccountModel } from '../models/business-account.model.js'
import { BusinessMembershipModel } from '../models/business-membership.model.js'
import { StaffInvitationModel } from '../models/staff-invitation.model.js'
import { InventoryItemModel } from '../models/inventory-item.model.js'
import { StockMovementModel } from '../models/stock-movement.model.js'
import { SaleModel } from '../models/sale.model.js'
import { RefundModel } from '../models/refund.model.js'
import { ExpenseModel } from '../models/expense.model.js'
import { DebtorModel } from '../models/debtor.model.js'
import { DebtorPaymentModel } from '../models/debtor-payment.model.js'
import { SupplierModel } from '../models/supplier.model.js'
import { SupplierPaymentModel } from '../models/supplier-payment.model.js'
import { SupplierLedgerEntryModel } from '../models/supplier-ledger-entry.model.js'
import { PurchaseOrderModel } from '../models/purchase-order.model.js'
import { AlertModel } from '../models/alert.model.js'
import { StockTransferModel } from '../models/stock-transfer.model.js'
import { withTransaction } from '../config/database.js'
import { UserModel } from '../models/user.model.js'
import { serializeDocument } from '../utils/serialize.js'
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
  const query = context.role === 'owner' ? base : { ...base, _id: { $in: context.assignedBranchIds } }
  const branches = await BranchModel.find(query).sort({ createdAt: 1 })

  // Enrich with the metrics and manager name the clients render on branch cards
  // (previously always blank/0 because only the separate performance report computed them).
  const branchIds = branches.map((branch) => branch._id)
  const metrics = branchIds.length
    ? await InventoryItemModel.aggregate([
        {
          $match: {
            businessAccountId: context.businessAccountId,
            branchId: { $in: branchIds },
            status: { $ne: 'discontinued' }
          }
        },
        {
          $group: {
            _id: '$branchId',
            productCount: { $sum: 1 },
            inventoryValue: { $sum: '$stockValue' },
            lowStockItemsCount: { $sum: { $cond: [{ $eq: ['$status', 'low_stock'] }, 1, 0] } }
          }
        }
      ])
    : []
  const metricsByBranch = new Map(metrics.map((m) => [String(m._id), m]))

  const managerIds = [...new Set(branches.map((b) => b.managerUserId).filter(Boolean).map(String))]
  const managers = managerIds.length ? await UserModel.find({ _id: { $in: managerIds } }).select('fullName email') : []
  const managerById = new Map(managers.map((u) => [String(u._id), u.fullName || u.email || null]))

  return branches.map((branch) => {
    const m = metricsByBranch.get(String(branch._id))
    return {
      ...(serializeDocument(branch) as Record<string, unknown>),
      productCount: m?.productCount ?? 0,
      inventoryValue: m?.inventoryValue ?? 0,
      lowStockItemsCount: m?.lowStockItemsCount ?? 0,
      managerName: branch.managerUserId ? managerById.get(String(branch.managerUserId)) ?? null : null
    }
  })
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

export async function deleteBranch(context: RequestContext, branchId: Types.ObjectId, requestMeta?: { ipAddress?: string; userAgent?: string }) {
  requireBusinessContext(context)
  if (context.role !== 'owner') throw new ApiError(403, 'owner_required', 'Only owners can delete branches')

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const sessionArg = activeSession ?? null
    const opts = activeSession ? { session: activeSession } : {}

    // Delete regardless of status (an already-disabled branch can be purged too).
    const branch = await BranchModel.findOne({ _id: branchId, businessAccountId: context.businessAccountId }).session(sessionArg)
    if (!branch) throw notFound('Branch not found')

    // A business must always keep at least one active branch. Deleting a disabled
    // branch never removes an active one, so only enforce the guard for active ones.
    if (branch.status !== 'disabled') {
      const otherActiveBranches = await BranchModel.countDocuments({
        businessAccountId: context.businessAccountId,
        status: { $ne: 'disabled' },
        _id: { $ne: branchId }
      }).session(sessionArg)
      if (otherActiveBranches === 0) {
        throw new ApiError(409, 'last_active_branch', 'Cannot permanently delete the only active branch; a business must have at least one active branch')
      }
    }

    // Cascade-delete every branch-scoped record. Run sequentially: a single
    // ClientSession cannot service concurrent operations inside a transaction.
    const branchScope = { businessAccountId: context.businessAccountId, branchId }
    const inventoryItems = await InventoryItemModel.deleteMany(branchScope, opts)
    const stockMovements = await StockMovementModel.deleteMany(branchScope, opts)
    const sales = await SaleModel.deleteMany(branchScope, opts)
    const refunds = await RefundModel.deleteMany(branchScope, opts)
    const expenses = await ExpenseModel.deleteMany(branchScope, opts)
    const debtors = await DebtorModel.deleteMany(branchScope, opts)
    const debtorPayments = await DebtorPaymentModel.deleteMany(branchScope, opts)
    const suppliers = await SupplierModel.deleteMany(branchScope, opts)
    const supplierPayments = await SupplierPaymentModel.deleteMany(branchScope, opts)
    const supplierLedgerEntries = await SupplierLedgerEntryModel.deleteMany(branchScope, opts)
    const purchaseOrders = await PurchaseOrderModel.deleteMany(branchScope, opts)
    const alerts = await AlertModel.deleteMany(branchScope, opts)
    const stockTransfers = await StockTransferModel.deleteMany(
      { businessAccountId: context.businessAccountId, $or: [{ fromBranchId: branchId }, { toBranchId: branchId }] },
      opts
    )

    // Strip the branch from staff assignments and pending invitations.
    await BusinessMembershipModel.updateMany(
      { businessAccountId: context.businessAccountId, assignedBranchIds: branchId },
      { $pull: { assignedBranchIds: branchId } },
      opts
    )
    await StaffInvitationModel.updateMany(
      { businessAccountId: context.businessAccountId, assignedBranchIds: branchId },
      { $pull: { assignedBranchIds: branchId } },
      opts
    )

    await BranchModel.deleteOne({ _id: branchId, businessAccountId: context.businessAccountId }, opts)

    const deletedCounts = {
      inventoryItems: inventoryItems.deletedCount,
      stockMovements: stockMovements.deletedCount,
      sales: sales.deletedCount,
      refunds: refunds.deletedCount,
      expenses: expenses.deletedCount,
      debtors: debtors.deletedCount,
      debtorPayments: debtorPayments.deletedCount,
      suppliers: suppliers.deletedCount,
      supplierPayments: supplierPayments.deletedCount,
      supplierLedgerEntries: supplierLedgerEntries.deletedCount,
      purchaseOrders: purchaseOrders.deletedCount,
      alerts: alerts.deletedCount,
      stockTransfers: stockTransfers.deletedCount
    }

    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId: context.businessAccountId,
        actorUserId: context.userId,
        actorRole: context.role,
        action: 'branch.deleted',
        targetType: 'branch',
        targetId: branch._id,
        branchId: branch._id,
        metadata: { branchName: branch.name, branchType: branch.branchType, deletedCounts },
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent
      },
      activeSession
    )

    return { id: branch._id.toString(), name: branch.name, deletedCounts }
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
