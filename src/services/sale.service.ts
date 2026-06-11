import type { ClientSession, Types } from 'mongoose'
import { InventoryItemModel } from '../models/inventory-item.model.js'
import { ProductModel } from '../models/product.model.js'
import { SaleModel } from '../models/sale.model.js'
import { RefundModel } from '../models/refund.model.js'
import { StockMovementModel } from '../models/stock-movement.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { withTransaction } from '../config/database.js'
import { getBranchForContext } from './branch.service.js'
import { addDebtorPurchase, reverseDebtorPurchase } from './debtor.service.js'
import { updateLowStockAlert } from './inventory.service.js'
import { writeAuditLog } from './audit.service.js'

type DiscountType = 'fixed' | 'percentage'

export interface SaleItemInput {
  productId: Types.ObjectId
  quantity: number
  unitPrice: number
  discount?: number
  discountType?: DiscountType
}

export interface CreateSaleInput {
  items: SaleItemInput[]
  customer?: {
    name?: string
    phone?: string
    email?: string
    debtorId?: Types.ObjectId
  }
  paymentMethod: 'cash' | 'mpesa' | 'bank_transfer' | 'card' | 'credit' | 'cheque' | 'other'
  tax?: number
  discount?: number
  discountType?: DiscountType
  notes?: string
}

export async function listSales(context: RequestContext, branchId: Types.ObjectId) {
  await getBranchForContext(context, branchId)
  const sales = await SaleModel.find({
    businessAccountId: context.businessAccountId,
    branchId,
    isDeleted: false
  }).sort({ createdAt: -1 })
  return sales.map((sale) => serializeSale(sale, context))
}

export async function createSale(
  context: RequestContext,
  branchId: Types.ObjectId,
  input: CreateSaleInput,
  requestMeta?: { ipAddress?: string; userAgent?: string }
) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  const businessAccountId = context.businessAccountId
  await getBranchForContext(context, branchId)

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    if (input.paymentMethod === 'credit' && !input.customer?.debtorId) {
      throw new ApiError(422, 'debtor_required', 'A debtor is required for credit sales')
    }

    const saleItems = []
    let subtotal = 0
    let totalCost = 0

    for (const item of input.items) {
      const product = await ProductModel.findOne({
        _id: item.productId,
        businessAccountId: context.businessAccountId,
        isActive: true
      }).session(activeSession ?? null)
      if (!product) throw notFound('Product not found')

      const inventory = await InventoryItemModel.findOne({
        businessAccountId: context.businessAccountId,
        branchId,
        productId: item.productId,
        status: { $ne: 'discontinued' }
      }).session(activeSession ?? null)
      if (!inventory) throw notFound('Inventory item not found for sale item')
      if (inventory.availableQuantity < item.quantity) {
        throw new ApiError(409, 'insufficient_stock', `Insufficient stock for ${product.name}`)
      }

      const lineGross = item.quantity * item.unitPrice
      const itemDiscountType = item.discountType ?? 'fixed'
      const itemDiscountAmount = calculateDiscountAmount(lineGross, item.discount ?? 0, itemDiscountType)
      if (itemDiscountAmount > lineGross) {
        throw new ApiError(422, 'invalid_item_discount', `Discount cannot exceed line total for ${product.name}`)
      }

      const lineSubtotal = lineGross - itemDiscountAmount
      const lineCost = item.quantity * inventory.costPrice
      subtotal += lineSubtotal
      totalCost += lineCost
      saleItems.push({
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount ?? 0,
        discountType: itemDiscountType,
        discountAmount: itemDiscountAmount,
        lineSubtotal,
        lineCost,
        lineProfit: lineSubtotal - lineCost
      })
    }

    const discount = input.discount ?? 0
    const discountType = input.discountType ?? 'fixed'
    const tax = input.tax ?? 0
    const cartDiscountBase = subtotal + tax
    const discountAmount = calculateDiscountAmount(cartDiscountBase, discount, discountType)
    const totalAmount = cartDiscountBase - discountAmount
    if (totalAmount < 0) throw new ApiError(422, 'invalid_sale_total', 'Sale total cannot be negative')

    const [sale] = await SaleModel.create(
      [
        {
          businessAccountId,
          branchId,
          saleNumber: await nextSaleNumber(businessAccountId, activeSession),
          items: saleItems,
          customer: input.customer ?? {},
          paymentMethod: input.paymentMethod,
          subtotal,
          tax,
          discount,
          discountType,
          discountAmount,
          totalAmount,
          totalCost,
          profit: totalAmount - totalCost,
          notes: input.notes,
          createdBy: context.userId
        }
      ],
      activeSession ? { session: activeSession } : {}
    )

    for (const item of input.items) {
      const inventory = await InventoryItemModel.findOne({
        businessAccountId,
        branchId,
        productId: item.productId,
        status: { $ne: 'discontinued' }
      }).session(activeSession ?? null)
      if (!inventory) throw notFound('Inventory item not found for sale item')

      const previousQuantity = inventory.quantity
      inventory.quantity -= item.quantity
      inventory.availableQuantity = Math.max(inventory.quantity - inventory.reservedQuantity, 0)
      inventory.stockValue = inventory.quantity * inventory.costPrice
      inventory.status = getInventoryStatus(inventory.quantity, inventory.reorderLevel)
      inventory.lastMovementAt = new Date()
      inventory.version += 1
      await inventory.save(activeSession ? { session: activeSession } : undefined)

      await StockMovementModel.create(
        [
          {
            businessAccountId,
            branchId,
            productId: item.productId,
            movementType: 'sale',
            quantity: item.quantity,
            direction: 'out',
            previousQuantity,
            newQuantity: inventory.quantity,
            unitCostPrice: inventory.costPrice,
            totalValue: item.quantity * inventory.costPrice,
            referenceType: 'sale',
            referenceId: sale._id,
            reason: `Sale ${sale.saleNumber}`,
            createdBy: context.userId
          }
        ],
        activeSession ? { session: activeSession } : {}
      )

      await updateLowStockAlert(businessAccountId, branchId, item.productId, inventory, activeSession)
    }

    if (input.paymentMethod === 'credit' && input.customer?.debtorId) {
      await addDebtorPurchase(context, branchId, input.customer.debtorId, totalAmount, activeSession)
    }

    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId,
        actorUserId: context.userId,
        actorRole: context.role,
        action: 'sale.created',
        targetType: 'sale',
        targetId: sale._id,
        branchId,
        metadata: { saleNumber: sale.saleNumber, paymentMethod: input.paymentMethod, totalAmount },
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent
      },
      activeSession
    )

    return serializeSale(sale, context)
  })
}

export async function getSale(context: RequestContext, branchId: Types.ObjectId, saleId: Types.ObjectId) {
  await getBranchForContext(context, branchId)
  const sale = await SaleModel.findOne({
    _id: saleId,
    businessAccountId: context.businessAccountId,
    branchId,
    isDeleted: false
  })
  if (!sale) throw notFound('Sale not found')
  return serializeSale(sale, context)
}

export async function updateSale(
  context: RequestContext,
  branchId: Types.ObjectId,
  saleId: Types.ObjectId,
  input: { customer?: CreateSaleInput['customer']; notes?: string }
) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  const sale = await SaleModel.findOneAndUpdate(
    { _id: saleId, businessAccountId: context.businessAccountId, branchId, isDeleted: false },
    { $set: { ...input }, $inc: { version: 1 } },
    { new: true }
  )
  if (!sale) throw notFound('Sale not found')
  return serializeSale(sale, context)
}

export async function deleteSale(context: RequestContext, branchId: Types.ObjectId, saleId: Types.ObjectId) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)
  if (!context.businessAccountId) throw new ApiError(403, 'business_required', 'Business context required')
  const businessAccountId = context.businessAccountId

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const sale = await SaleModel.findOne({
      _id: saleId,
      businessAccountId,
      branchId,
      isDeleted: false
    }).session(activeSession ?? null)
    if (!sale) throw notFound('Sale not found')

    sale.isDeleted = true
    sale.deletedAt = new Date()
    sale.deletedBy = context.userId
    sale.version += 1
    await sale.save(activeSession ? { session: activeSession } : undefined)

    // Restore stock that was deducted at sale time and record compensating movements
    await restoreSaleStock(context, businessAccountId, branchId, sale, `Sale ${sale.saleNumber} deleted`, activeSession)

    // Reverse the receivable created for credit sales
    if (sale.paymentMethod === 'credit' && sale.customer?.debtorId) {
      await reverseDebtorPurchase(context, branchId, sale.customer.debtorId, sale.totalAmount, activeSession)
    }

    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId,
        actorUserId: context.userId,
        actorRole: context.role,
        action: 'sale.deleted',
        targetType: 'sale',
        targetId: sale._id,
        branchId,
        metadata: { saleNumber: sale.saleNumber, totalAmount: sale.totalAmount }
      },
      activeSession
    )

    return { deleted: true }
  })
}

/**
 * Refund a full sale: mark it refunded (kept in history), restock all items to the
 * branch, reverse the debtor balance for credit sales, and write a durable Refund
 * record for reporting/audit. Allowed for any branch user (cashiers included) on
 * their assigned branch; branch access is enforced by getBranchForContext.
 */
export async function refundSale(
  context: RequestContext,
  branchId: Types.ObjectId,
  saleId: Types.ObjectId,
  input: { reason?: string }
) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  await getBranchForContext(context, branchId)
  const businessAccountId = context.businessAccountId

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const sale = await SaleModel.findOne({
      _id: saleId,
      businessAccountId,
      branchId,
      isDeleted: false
    }).session(activeSession ?? null)
    if (!sale) throw notFound('Sale not found')
    if (sale.isRefunded) throw new ApiError(409, 'sale_already_refunded', 'Sale has already been refunded')

    sale.isRefunded = true
    sale.refundedAt = new Date()
    sale.refundedBy = context.userId
    sale.refundReason = input.reason
    sale.version += 1
    await sale.save(activeSession ? { session: activeSession } : undefined)

    const restockedUnits = await restoreSaleStock(
      context,
      businessAccountId,
      branchId,
      sale,
      `Sale ${sale.saleNumber} refunded`,
      activeSession
    )

    // Reverse the receivable created for credit sales
    if (sale.paymentMethod === 'credit' && sale.customer?.debtorId) {
      await reverseDebtorPurchase(context, branchId, sale.customer.debtorId, sale.totalAmount, activeSession)
    }

    const [refund] = await RefundModel.create(
      [
        {
          businessAccountId,
          branchId,
          saleId: sale._id,
          saleNumber: sale.saleNumber,
          refundNumber: await nextRefundNumber(businessAccountId, activeSession),
          amount: sale.totalAmount,
          paymentMethod: sale.paymentMethod,
          reason: input.reason,
          itemCount: restockedUnits,
          restocked: true,
          createdBy: context.userId
        }
      ],
      activeSession ? { session: activeSession } : {}
    )

    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId,
        actorUserId: context.userId,
        actorRole: context.role,
        action: 'sale.refunded',
        targetType: 'sale',
        targetId: sale._id,
        branchId,
        metadata: { saleNumber: sale.saleNumber, refundNumber: refund.refundNumber, totalAmount: sale.totalAmount }
      },
      activeSession
    )

    return {
      sale: serializeSale(sale, context),
      refund: normalizeMongo(refund.toObject({ versionKey: false }))
    }
  })
}

export async function listRefunds(context: RequestContext, branchId: Types.ObjectId) {
  await getBranchForContext(context, branchId)
  const refunds = await RefundModel.find({ businessAccountId: context.businessAccountId, branchId }).sort({ createdAt: -1 })
  return refunds.map((refund) => normalizeMongo(refund.toObject({ versionKey: false })))
}

/**
 * Restore the units from a sale back into branch inventory and write a 'return'
 * stock movement per line. Returns the total number of units restocked. Inventory
 * items that have since been removed/discontinued are skipped gracefully.
 */
async function restoreSaleStock(
  context: RequestContext,
  businessAccountId: Types.ObjectId,
  branchId: Types.ObjectId,
  sale: { items: { productId: Types.ObjectId; quantity: number }[]; _id: Types.ObjectId; saleNumber: string },
  reason: string,
  session?: ClientSession
) {
  let restockedUnits = 0
  for (const item of sale.items) {
    const inventory = await InventoryItemModel.findOne({
      businessAccountId,
      branchId,
      productId: item.productId
    }).session(session ?? null)
    if (!inventory) continue

    const previousQuantity = inventory.quantity
    inventory.quantity += item.quantity
    inventory.availableQuantity = Math.max(inventory.quantity - inventory.reservedQuantity, 0)
    inventory.stockValue = inventory.quantity * inventory.costPrice
    inventory.status = getInventoryStatus(inventory.quantity, inventory.reorderLevel)
    inventory.lastMovementAt = new Date()
    inventory.version += 1
    await inventory.save(session ? { session } : undefined)

    await StockMovementModel.create(
      [
        {
          businessAccountId,
          branchId,
          productId: item.productId,
          movementType: 'return',
          quantity: item.quantity,
          direction: 'in',
          previousQuantity,
          newQuantity: inventory.quantity,
          unitCostPrice: inventory.costPrice,
          totalValue: item.quantity * inventory.costPrice,
          referenceType: 'sale',
          referenceId: sale._id,
          reason,
          createdBy: context.userId
        }
      ],
      session ? { session } : {}
    )

    await updateLowStockAlert(businessAccountId, branchId, item.productId, inventory, session)
    restockedUnits += item.quantity
  }
  return restockedUnits
}

async function nextRefundNumber(businessAccountId: Types.ObjectId, session?: ClientSession) {
  const count = await RefundModel.countDocuments({ businessAccountId }).session(session ?? null)
  return `REF-${String(count + 1).padStart(6, '0')}`
}

export function serializeSale(sale: { toObject(options?: unknown): unknown }, context: RequestContext) {
  const value = normalizeMongo(sale.toObject({ versionKey: false })) as Record<string, unknown>
  if (context.role === 'cashier') {
    delete value.totalCost
    delete value.profit
    value.items = ((value.items ?? []) as Record<string, unknown>[]).map((item) => {
      delete item.lineCost
      delete item.lineProfit
      return item
    })
  }
  return value
}

async function nextSaleNumber(businessAccountId: Types.ObjectId, session?: ClientSession) {
  const count = await SaleModel.countDocuments({ businessAccountId }).session(session ?? null)
  return `SALE-${String(count + 1).padStart(6, '0')}`
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  if (context.role !== 'owner' && context.role !== 'manager') {
    throw new ApiError(403, 'manager_required', 'Only owners and managers can update or delete sales')
  }
}

function calculateDiscountAmount(baseAmount: number, discount: number, discountType: DiscountType) {
  if (discountType === 'percentage') return (baseAmount * discount) / 100
  return discount
}

function getInventoryStatus(quantity: number, reorderLevel: number) {
  if (quantity <= 0) return 'out_of_stock'
  if (reorderLevel > 0 && quantity <= reorderLevel) return 'low_stock'
  return 'in_stock'
}
