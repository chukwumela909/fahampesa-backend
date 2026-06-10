import type { ClientSession, Types } from 'mongoose'
import { InventoryItemModel } from '../models/inventory-item.model.js'
import { ProductModel } from '../models/product.model.js'
import { PurchaseOrderModel } from '../models/purchase-order.model.js'
import { StockMovementModel } from '../models/stock-movement.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { withTransaction } from '../config/database.js'
import { getBranchForContext } from './branch.service.js'
import { addSupplierPurchaseBalance } from './supplier.service.js'
import { updateLowStockAlert } from './inventory.service.js'

export interface CreatePurchaseOrderInput {
  supplierId: Types.ObjectId
  items: { productId: Types.ObjectId; quantityOrdered: number; unitCostPrice: number }[]
  taxAmount?: number
  shippingCost?: number
  amountPaid?: number
  paymentTerms?: string
  expectedDeliveryDate?: Date | null
}

export async function listPurchaseOrders(context: RequestContext, branchId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const orders = await PurchaseOrderModel.find({ businessAccountId: context.businessAccountId, branchId }).sort({ createdAt: -1 })
  return orders.map(serializePurchaseOrder)
}

export async function createPurchaseOrder(context: RequestContext, branchId: Types.ObjectId, input: CreatePurchaseOrderInput) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const items = []
    let subtotal = 0
    for (const item of input.items) {
      const product = await ProductModel.findOne({ _id: item.productId, businessAccountId: context.businessAccountId, isActive: true }).session(activeSession ?? null)
      if (!product) throw notFound('Product not found')
      const inventory = await InventoryItemModel.findOne({ businessAccountId: context.businessAccountId, branchId, productId: item.productId, status: { $ne: 'discontinued' } }).session(activeSession ?? null)
      if (!inventory) throw notFound('Product must exist in branch inventory before purchase')
      const lineTotal = item.quantityOrdered * item.unitCostPrice
      subtotal += lineTotal
      items.push({ productId: item.productId, productName: product.name, quantityOrdered: item.quantityOrdered, quantityReceived: 0, unitCostPrice: item.unitCostPrice, lineTotal })
    }
    const taxAmount = input.taxAmount ?? 0
    const shippingCost = input.shippingCost ?? 0
    const amountPaid = input.amountPaid ?? 0
    const totalAmount = subtotal + taxAmount + shippingCost
    if (amountPaid > totalAmount) throw new ApiError(422, 'payment_exceeds_total', 'Amount paid cannot exceed purchase total')

    const [order] = await PurchaseOrderModel.create(
      [
        {
          businessAccountId: context.businessAccountId,
          branchId,
          supplierId: input.supplierId,
          poNumber: await nextPoNumber(context.businessAccountId!, activeSession),
          items,
          subtotal,
          taxAmount,
          shippingCost,
          totalAmount,
          amountPaid,
          outstandingAmount: totalAmount - amountPaid,
          paymentTerms: input.paymentTerms,
          expectedDeliveryDate: input.expectedDeliveryDate ?? null,
          createdBy: context.userId
        }
      ],
      activeSession ? { session: activeSession } : {}
    )
    return serializePurchaseOrder(order)
  })
}

/**
 * Simple "Record Purchase" flow: create a purchase order and immediately receive all
 * ordered quantities in a single transaction. Stock increases right away, the supplier
 * balance/payable is updated, and a ledger + stock-movement trail is written — matching
 * the spec's "when a purchase is created, inventory increases in the selected branch".
 */
export async function createAndReceivePurchaseOrder(context: RequestContext, branchId: Types.ObjectId, input: CreatePurchaseOrderInput) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const businessAccountId = context.businessAccountId!

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const items = []
    let subtotal = 0
    for (const item of input.items) {
      const product = await ProductModel.findOne({ _id: item.productId, businessAccountId, isActive: true }).session(activeSession ?? null)
      if (!product) throw notFound('Product not found')
      const inventory = await InventoryItemModel.findOne({ businessAccountId, branchId, productId: item.productId, status: { $ne: 'discontinued' } }).session(activeSession ?? null)
      if (!inventory) throw notFound('Product must exist in branch inventory before purchase')
      const lineTotal = item.quantityOrdered * item.unitCostPrice
      subtotal += lineTotal
      items.push({ productId: item.productId, productName: product.name, quantityOrdered: item.quantityOrdered, quantityReceived: item.quantityOrdered, unitCostPrice: item.unitCostPrice, lineTotal })
    }
    const taxAmount = input.taxAmount ?? 0
    const shippingCost = input.shippingCost ?? 0
    const amountPaid = input.amountPaid ?? 0
    const totalAmount = subtotal + taxAmount + shippingCost
    if (amountPaid > totalAmount) throw new ApiError(422, 'payment_exceeds_total', 'Amount paid cannot exceed purchase total')

    const now = new Date()
    const [order] = await PurchaseOrderModel.create(
      [
        {
          businessAccountId,
          branchId,
          supplierId: input.supplierId,
          poNumber: await nextPoNumber(businessAccountId, activeSession),
          items,
          subtotal,
          taxAmount,
          shippingCost,
          totalAmount,
          amountPaid,
          outstandingAmount: totalAmount - amountPaid,
          paymentTerms: input.paymentTerms,
          expectedDeliveryDate: input.expectedDeliveryDate ?? null,
          status: 'received',
          approvedBy: context.userId,
          approvedAt: now,
          receivedBy: context.userId,
          receivedAt: now,
          createdBy: context.userId
        }
      ],
      activeSession ? { session: activeSession } : {}
    )

    for (const item of input.items) {
      const inventory = await InventoryItemModel.findOne({ businessAccountId, branchId, productId: item.productId, status: { $ne: 'discontinued' } }).session(activeSession ?? null)
      if (!inventory) throw notFound('Product must exist in branch inventory before receiving purchase')
      const previousQuantity = inventory.quantity
      inventory.quantity += item.quantityOrdered
      inventory.availableQuantity = Math.max(inventory.quantity - inventory.reservedQuantity, 0)
      inventory.lastCostPrice = item.unitCostPrice
      inventory.costPrice = item.unitCostPrice
      inventory.averageCostPrice = getWeightedAverageCost(previousQuantity, inventory.averageCostPrice, item.quantityOrdered, item.unitCostPrice)
      inventory.stockValue = inventory.quantity * inventory.costPrice
      inventory.status = getInventoryStatus(inventory.quantity, inventory.reorderLevel)
      inventory.lastMovementAt = now
      inventory.version += 1
      await inventory.save(activeSession ? { session: activeSession } : undefined)

      await StockMovementModel.create(
        [
          {
            businessAccountId,
            branchId,
            productId: item.productId,
            movementType: 'purchase',
            quantity: item.quantityOrdered,
            direction: 'in',
            previousQuantity,
            newQuantity: inventory.quantity,
            unitCostPrice: item.unitCostPrice,
            totalValue: item.quantityOrdered * item.unitCostPrice,
            referenceType: 'purchase_order',
            referenceId: order._id,
            reason: `Purchase ${order.poNumber}`,
            createdBy: context.userId
          }
        ],
        activeSession ? { session: activeSession } : {}
      )

      await updateLowStockAlert(businessAccountId, branchId, item.productId, inventory, activeSession)
    }

    const payableIncrease = Math.max(subtotal - amountPaid, 0)
    if (payableIncrease > 0) await addSupplierPurchaseBalance(context, branchId, order.supplierId, payableIncrease, order._id, activeSession)
    return serializePurchaseOrder(order)
  })
}

export async function getPurchaseOrder(context: RequestContext, branchId: Types.ObjectId, purchaseOrderId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const order = await PurchaseOrderModel.findOne({ _id: purchaseOrderId, businessAccountId: context.businessAccountId, branchId })
  if (!order) throw notFound('Purchase order not found')
  return serializePurchaseOrder(order)
}

export async function approvePurchaseOrder(context: RequestContext, branchId: Types.ObjectId, purchaseOrderId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const order = await PurchaseOrderModel.findOneAndUpdate(
    { _id: purchaseOrderId, businessAccountId: context.businessAccountId, branchId, status: { $in: ['draft', 'pending'] } },
    { $set: { status: 'approved', approvedBy: context.userId, approvedAt: new Date() }, $inc: { version: 1 } },
    { new: true }
  )
  if (!order) throw notFound('Purchase order not found or cannot be approved')
  return serializePurchaseOrder(order)
}

export async function receivePurchaseOrder(
  context: RequestContext,
  branchId: Types.ObjectId,
  purchaseOrderId: Types.ObjectId,
  input: { items: { productId: Types.ObjectId; quantityReceived: number }[] }
) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const order = await PurchaseOrderModel.findOne({ _id: purchaseOrderId, businessAccountId: context.businessAccountId, branchId }).session(activeSession ?? null)
    if (!order) throw notFound('Purchase order not found')
    if (!['approved', 'sent', 'partially_received'].includes(order.status)) throw new ApiError(409, 'purchase_not_receivable', 'Purchase order is not ready to receive')

    let receivedValue = 0
    for (const received of input.items) {
      const orderItem = order.items.find((item) => item.productId.equals(received.productId))
      if (!orderItem) throw notFound('Purchase order item not found')
      const remaining = orderItem.quantityOrdered - orderItem.quantityReceived
      if (received.quantityReceived > remaining) throw new ApiError(422, 'receive_quantity_exceeds_remaining', 'Receive quantity exceeds remaining order quantity')

      const inventory = await InventoryItemModel.findOne({ businessAccountId: context.businessAccountId, branchId, productId: received.productId, status: { $ne: 'discontinued' } }).session(activeSession ?? null)
      if (!inventory) throw notFound('Product must exist in branch inventory before receiving purchase')
      const previousQuantity = inventory.quantity
      inventory.quantity += received.quantityReceived
      inventory.availableQuantity = Math.max(inventory.quantity - inventory.reservedQuantity, 0)
      inventory.lastCostPrice = orderItem.unitCostPrice
      inventory.costPrice = orderItem.unitCostPrice
      inventory.averageCostPrice = getWeightedAverageCost(previousQuantity, inventory.averageCostPrice, received.quantityReceived, orderItem.unitCostPrice)
      inventory.stockValue = inventory.quantity * inventory.costPrice
      inventory.status = getInventoryStatus(inventory.quantity, inventory.reorderLevel)
      inventory.lastMovementAt = new Date()
      inventory.version += 1
      await inventory.save(activeSession ? { session: activeSession } : undefined)

      orderItem.quantityReceived += received.quantityReceived
      receivedValue += received.quantityReceived * orderItem.unitCostPrice

      await StockMovementModel.create(
        [
          {
            businessAccountId: context.businessAccountId,
            branchId,
            productId: received.productId,
            movementType: 'purchase',
            quantity: received.quantityReceived,
            direction: 'in',
            previousQuantity,
            newQuantity: inventory.quantity,
            unitCostPrice: orderItem.unitCostPrice,
            totalValue: received.quantityReceived * orderItem.unitCostPrice,
            referenceType: 'purchase_order',
            referenceId: order._id,
            reason: `Purchase ${order.poNumber}`,
            createdBy: context.userId
          }
        ],
        activeSession ? { session: activeSession } : {}
      )

      await updateLowStockAlert(context.businessAccountId!, branchId, received.productId, inventory, activeSession)
    }

    order.status = order.items.every((item) => item.quantityReceived >= item.quantityOrdered) ? 'received' : 'partially_received'
    order.receivedBy = context.userId
    order.receivedAt = new Date()
    order.version += 1
    await order.save(activeSession ? { session: activeSession } : undefined)

    const payableIncrease = Math.max(receivedValue - order.amountPaid, 0)
    if (payableIncrease > 0) await addSupplierPurchaseBalance(context, branchId, order.supplierId, payableIncrease, order._id, activeSession)
    return serializePurchaseOrder(order)
  })
}

export async function cancelPurchaseOrder(context: RequestContext, branchId: Types.ObjectId, purchaseOrderId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const order = await PurchaseOrderModel.findOneAndUpdate(
    { _id: purchaseOrderId, businessAccountId: context.businessAccountId, branchId, status: { $nin: ['received', 'cancelled'] } },
    { $set: { status: 'cancelled', cancelledBy: context.userId, cancelledAt: new Date() }, $inc: { version: 1 } },
    { new: true }
  )
  if (!order) throw notFound('Purchase order not found or cannot be cancelled')
  return serializePurchaseOrder(order)
}

function serializePurchaseOrder(order: { toObject(options?: unknown): unknown }) {
  return normalizeMongo(order.toObject({ versionKey: false })) as Record<string, unknown>
}

async function nextPoNumber(businessAccountId: Types.ObjectId, session?: ClientSession) {
  const count = await PurchaseOrderModel.countDocuments({ businessAccountId }).session(session ?? null)
  return `PO-${String(count + 1).padStart(6, '0')}`
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  if (context.role !== 'owner' && context.role !== 'manager') throw new ApiError(403, 'manager_required', 'Only owners and managers can manage purchases')
}

function getInventoryStatus(quantity: number, reorderLevel: number) {
  if (quantity <= 0) return 'out_of_stock'
  if (reorderLevel > 0 && quantity <= reorderLevel) return 'low_stock'
  return 'in_stock'
}

function getWeightedAverageCost(previousQuantity: number, previousAverage: number, addedQuantity: number, addedCost: number) {
  const totalQuantity = previousQuantity + addedQuantity
  if (totalQuantity <= 0) return addedCost
  return (previousQuantity * previousAverage + addedQuantity * addedCost) / totalQuantity
}
