import type { ClientSession, Types } from 'mongoose'
import { InventoryItemModel } from '../models/inventory-item.model.js'
import { ProductModel } from '../models/product.model.js'
import { StockMovementModel } from '../models/stock-movement.model.js'
import { StockTransferModel } from '../models/stock-transfer.model.js'
import { nextDocumentNumber } from './sequence.service.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { withTransaction } from '../config/database.js'
import { getBranchForContext } from './branch.service.js'
import { updateLowStockAlert } from './inventory.service.js'

export interface CreateTransferInput {
  fromBranchId: Types.ObjectId
  toBranchId: Types.ObjectId
  items: { productId: Types.ObjectId; quantity: number }[]
  priority?: 'low' | 'normal' | 'high'
  notes?: string
}

export async function listTransfers(context: RequestContext) {
  requireManagerRole(context)
  const query: Record<string, unknown> = { businessAccountId: context.businessAccountId }
  if (context.role !== 'owner') {
    query.$or = [{ fromBranchId: { $in: context.assignedBranchIds } }, { toBranchId: { $in: context.assignedBranchIds } }]
  }
  const transfers = await StockTransferModel.find(query).sort({ createdAt: -1 })
  return transfers.map(serializeTransfer)
}

export async function createTransfer(context: RequestContext, input: CreateTransferInput) {
  requireManagerRole(context)
  if (input.fromBranchId.equals(input.toBranchId)) throw new ApiError(422, 'same_branch_transfer', 'Source and destination branches must be different')
  await getBranchForContext(context, input.fromBranchId)
  await getBranchForContext(context, input.toBranchId)

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const items = []
    for (const item of input.items) {
      const product = await ProductModel.findOne({ _id: item.productId, businessAccountId: context.businessAccountId, isActive: true }).session(activeSession ?? null)
      if (!product) throw notFound('Product not found')
      const source = await InventoryItemModel.findOne({ businessAccountId: context.businessAccountId, branchId: input.fromBranchId, productId: item.productId, status: { $ne: 'discontinued' } }).session(activeSession ?? null)
      if (!source) {
        throw transferInventoryMissingError(item.productId, product.name, input.fromBranchId, input.toBranchId)
      }
      if (source.availableQuantity < item.quantity) throw new ApiError(409, 'insufficient_stock', `Insufficient stock for ${product.name}`)
      // The destination branch doesn't need the product set up in advance: the
      // transfer creates its (zero-quantity) stock record, mirroring source pricing.
      await ensureDestinationInventory(context, input.toBranchId, item.productId, source, activeSession)
      items.push({ productId: item.productId, productName: product.name, quantity: item.quantity })
    }

    const [transfer] = await StockTransferModel.create(
      [
        {
          businessAccountId: context.businessAccountId,
          transferNumber: await nextTransferNumber(context.businessAccountId!, activeSession),
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          items,
          priority: input.priority ?? 'normal',
          notes: input.notes,
          requestedBy: context.userId
        }
      ],
      activeSession ? { session: activeSession } : {}
    )
    return serializeTransfer(transfer)
  })
}

export async function getTransfer(context: RequestContext, transferId: Types.ObjectId) {
  requireManagerRole(context)
  const transfer = await StockTransferModel.findOne({ _id: transferId, businessAccountId: context.businessAccountId })
  if (!transfer) throw notFound('Transfer not found')
  ensureTransferBranchAccess(context, transfer.fromBranchId, transfer.toBranchId)
  return serializeTransfer(transfer)
}

export async function approveTransfer(context: RequestContext, transferId: Types.ObjectId) {
  return transitionTransfer(context, transferId, 'requested', { status: 'approved', approvedBy: context.userId, approvedAt: new Date() })
}

export async function shipTransfer(context: RequestContext, transferId: Types.ObjectId) {
  return transitionTransfer(context, transferId, 'approved', { status: 'in_transit', shippedBy: context.userId, shippedAt: new Date() })
}

export async function receiveTransfer(context: RequestContext, transferId: Types.ObjectId) {
  requireManagerRole(context)
  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const transfer = await StockTransferModel.findOne({ _id: transferId, businessAccountId: context.businessAccountId, status: 'in_transit' }).session(activeSession ?? null)
    if (!transfer) throw notFound('Transfer not found or not ready to receive')
    ensureTransferBranchAccess(context, transfer.fromBranchId, transfer.toBranchId)

    for (const item of transfer.items) {
      const source = await InventoryItemModel.findOne({ businessAccountId: context.businessAccountId, branchId: transfer.fromBranchId, productId: item.productId, status: { $ne: 'discontinued' } }).session(activeSession ?? null)
      if (!source) {
        throw transferInventoryMissingError(item.productId, item.productName, transfer.fromBranchId, transfer.toBranchId)
      }
      if (source.availableQuantity < item.quantity) throw new ApiError(409, 'insufficient_stock', `Insufficient stock for ${item.productName}`)
      // Covers transfers created before destination auto-setup existed, or rows removed mid-flight.
      const destination = await ensureDestinationInventory(context, transfer.toBranchId, item.productId, source, activeSession)

      const sourcePrevious = source.quantity
      const destinationPrevious = destination.quantity
      source.quantity -= item.quantity
      source.availableQuantity = Math.max(source.quantity - source.reservedQuantity, 0)
      source.stockValue = source.quantity * source.costPrice
      source.status = getInventoryStatus(source.quantity, source.reorderLevel)
      source.lastMovementAt = new Date()
      source.version += 1
      await source.save(activeSession ? { session: activeSession } : undefined)

      destination.quantity += item.quantity
      destination.availableQuantity = Math.max(destination.quantity - destination.reservedQuantity, 0)
      destination.stockValue = destination.quantity * destination.costPrice
      destination.status = getInventoryStatus(destination.quantity, destination.reorderLevel)
      destination.lastMovementAt = new Date()
      destination.version += 1
      await destination.save(activeSession ? { session: activeSession } : undefined)

      await StockMovementModel.create(
        [
          {
            businessAccountId: context.businessAccountId,
            branchId: transfer.fromBranchId,
            productId: item.productId,
            movementType: 'transfer_out',
            quantity: item.quantity,
            direction: 'out',
            previousQuantity: sourcePrevious,
            newQuantity: source.quantity,
            unitCostPrice: source.costPrice,
            totalValue: item.quantity * source.costPrice,
            referenceType: 'stock_transfer',
            referenceId: transfer._id,
            reason: `Transfer ${transfer.transferNumber}`,
            createdBy: context.userId
          },
          {
            businessAccountId: context.businessAccountId,
            branchId: transfer.toBranchId,
            productId: item.productId,
            movementType: 'transfer_in',
            quantity: item.quantity,
            direction: 'in',
            previousQuantity: destinationPrevious,
            newQuantity: destination.quantity,
            unitCostPrice: destination.costPrice,
            totalValue: item.quantity * destination.costPrice,
            referenceType: 'stock_transfer',
            referenceId: transfer._id,
            reason: `Transfer ${transfer.transferNumber}`,
            createdBy: context.userId
          }
        ],
        activeSession ? { session: activeSession, ordered: true } : {}
      )

      await updateLowStockAlert(context.businessAccountId!, transfer.fromBranchId, item.productId, source, activeSession)
      await updateLowStockAlert(context.businessAccountId!, transfer.toBranchId, item.productId, destination, activeSession)
    }

    transfer.status = 'received'
    transfer.receivedBy = context.userId
    transfer.receivedAt = new Date()
    transfer.version += 1
    await transfer.save(activeSession ? { session: activeSession } : undefined)
    return serializeTransfer(transfer)
  })
}

export async function cancelTransfer(context: RequestContext, transferId: Types.ObjectId) {
  return transitionTransfer(context, transferId, 'requested', { status: 'cancelled', cancelledAt: new Date() })
}

export async function rejectTransfer(context: RequestContext, transferId: Types.ObjectId) {
  return transitionTransfer(context, transferId, 'requested', { status: 'rejected', rejectedAt: new Date() })
}

async function transitionTransfer(context: RequestContext, transferId: Types.ObjectId, fromStatus: string, update: Record<string, unknown>) {
  requireManagerRole(context)
  const transfer = await StockTransferModel.findOne({ _id: transferId, businessAccountId: context.businessAccountId, status: fromStatus })
  if (!transfer) throw notFound('Transfer not found or invalid status')
  ensureTransferBranchAccess(context, transfer.fromBranchId, transfer.toBranchId)
  Object.assign(transfer, update)
  transfer.version += 1
  await transfer.save()
  return serializeTransfer(transfer)
}

function ensureTransferBranchAccess(context: RequestContext, fromBranchId: Types.ObjectId, toBranchId: Types.ObjectId) {
  if (context.role === 'owner') return
  const hasAccess = context.assignedBranchIds.some((branchId) => branchId.equals(fromBranchId) || branchId.equals(toBranchId))
  if (!hasAccess) throw new ApiError(403, 'branch_forbidden', 'You do not have access to this transfer')
}

function serializeTransfer(transfer: { toObject(options?: unknown): unknown }) {
  return normalizeMongo(transfer.toObject({ versionKey: false })) as Record<string, unknown>
}

function transferInventoryMissingError(productId: Types.ObjectId, productName: string, fromBranchId: Types.ObjectId, toBranchId: Types.ObjectId) {
  return new ApiError(422, 'transfer_inventory_missing', 'Product has no stock record in the source branch', {
    productId: productId.toString(),
    productName,
    fromBranchId: fromBranchId.toString(),
    toBranchId: toBranchId.toString(),
    missing: 'source'
  })
}

/** Find the destination branch's stock record for a product, creating a
 *  zero-quantity one (mirroring the source's pricing/reorder level) when the
 *  product hasn't been set up there yet. */
async function ensureDestinationInventory(
  context: RequestContext,
  toBranchId: Types.ObjectId,
  productId: Types.ObjectId,
  source: InstanceType<typeof InventoryItemModel>,
  session?: ClientSession
) {
  const existing = await InventoryItemModel.findOne({
    businessAccountId: context.businessAccountId,
    branchId: toBranchId,
    productId,
    status: { $ne: 'discontinued' }
  }).session(session ?? null)
  if (existing) return existing

  const [created] = await InventoryItemModel.create(
    [
      {
        businessAccountId: context.businessAccountId,
        branchId: toBranchId,
        productId,
        quantity: 0,
        reservedQuantity: 0,
        availableQuantity: 0,
        reorderLevel: source.reorderLevel,
        averageCostPrice: source.averageCostPrice,
        lastCostPrice: source.lastCostPrice,
        costPrice: source.costPrice,
        sellingPrice: source.sellingPrice,
        stockValue: 0,
        status: 'out_of_stock'
      }
    ],
    session ? { session } : {}
  )
  return created
}

async function nextTransferNumber(businessAccountId: Types.ObjectId, session?: ClientSession) {
  return nextDocumentNumber(businessAccountId, 'transfer', 'TRF-', 'transferNumber', StockTransferModel as never, session)
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  if (context.role !== 'owner' && context.role !== 'manager') throw new ApiError(403, 'manager_required', 'Only owners and managers can manage transfers')
}

function getInventoryStatus(quantity: number, reorderLevel: number) {
  if (quantity <= 0) return 'out_of_stock'
  if (reorderLevel > 0 && quantity <= reorderLevel) return 'low_stock'
  return 'in_stock'
}
