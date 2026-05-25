import type { ClientSession, Types } from 'mongoose'
import { AlertModel } from '../models/alert.model.js'
import { InventoryItemModel } from '../models/inventory-item.model.js'
import { ProductModel } from '../models/product.model.js'
import { StockMovementModel } from '../models/stock-movement.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { withTransaction } from '../config/database.js'
import { getBranchForContext } from './branch.service.js'
import { writeAuditLog } from './audit.service.js'

export interface InventorySettingsInput {
  initialQuantity?: number
  initialStockReason?: string
  reorderLevel?: number
  costPrice?: number
  sellingPrice?: number
  supplierId?: Types.ObjectId | null
  expiryDate?: Date | null
  batchNumber?: string
  binLocation?: string
}

export interface InventoryAdjustmentInput {
  productId: Types.ObjectId
  adjustmentType: 'increase' | 'decrease' | 'set'
  quantity: number
  reason: string
  notes?: string
  unitCostPrice?: number
}

export async function createInventoryForProduct(
  context: RequestContext,
  branchId: Types.ObjectId,
  productId: Types.ObjectId,
  input: InventorySettingsInput = {},
  session?: ClientSession
) {
  requireManagerRole(context)
  const activeSession = session?.inTransaction() ? session : undefined
  const existing = await InventoryItemModel.findOne({
    businessAccountId: context.businessAccountId,
    branchId,
    productId
  }).session(activeSession ?? null)

  if (existing) {
    throw new ApiError(409, 'product_already_linked', 'Product is already linked to this branch')
  }

  const quantity = input.initialQuantity ?? 0
  const costPrice = input.costPrice ?? 0
  const [inventory] = await InventoryItemModel.create(
    [
      computeInventoryFields({
        businessAccountId: context.businessAccountId!,
        branchId,
        productId,
        quantity,
        reservedQuantity: 0,
        reorderLevel: input.reorderLevel ?? 0,
        averageCostPrice: costPrice,
        lastCostPrice: costPrice,
        costPrice,
        sellingPrice: input.sellingPrice ?? 0,
        supplierId: input.supplierId ?? null,
        expiryDate: input.expiryDate ?? null,
        batchNumber: input.batchNumber,
        binLocation: input.binLocation,
        lastMovementAt: quantity > 0 ? new Date() : null
      })
    ],
    activeSession ? { session: activeSession } : {}
  )

  if (quantity > 0) {
    await StockMovementModel.create(
      [
        {
          businessAccountId: context.businessAccountId,
          branchId,
          productId,
          movementType: 'initial',
          quantity,
          direction: 'in',
          previousQuantity: 0,
          newQuantity: quantity,
          unitCostPrice: costPrice,
          totalValue: quantity * costPrice,
          reason: input.initialStockReason ?? 'Initial stock setup',
          createdBy: context.userId
        }
      ],
      activeSession ? { session: activeSession } : {}
    )
  }

  await updateLowStockAlert(context.businessAccountId!, branchId, productId, inventory, activeSession)
  return inventory
}

export async function updateInventorySettings(
  context: RequestContext,
  branchId: Types.ObjectId,
  productId: Types.ObjectId,
  input: InventorySettingsInput,
  session?: ClientSession
) {
  requireManagerRole(context)
  const activeSession = session?.inTransaction() ? session : undefined
  const inventory = await InventoryItemModel.findOne({
    businessAccountId: context.businessAccountId,
    branchId,
    productId,
    status: { $ne: 'discontinued' }
  }).session(activeSession ?? null)
  if (!inventory) throw notFound('Inventory item not found')

  if (input.reorderLevel !== undefined) inventory.reorderLevel = input.reorderLevel
  if (input.costPrice !== undefined) {
    inventory.costPrice = input.costPrice
    inventory.lastCostPrice = input.costPrice
    if (!inventory.averageCostPrice) inventory.averageCostPrice = input.costPrice
  }
  if (input.sellingPrice !== undefined) inventory.sellingPrice = input.sellingPrice
  if (input.supplierId !== undefined) inventory.supplierId = input.supplierId
  if (input.expiryDate !== undefined) inventory.expiryDate = input.expiryDate
  if (input.batchNumber !== undefined) inventory.batchNumber = input.batchNumber
  if (input.binLocation !== undefined) inventory.binLocation = input.binLocation

  applyComputedInventoryFields(inventory)
  inventory.version += 1
  await inventory.save(activeSession ? { session: activeSession } : undefined)
  await updateLowStockAlert(context.businessAccountId!, branchId, productId, inventory, activeSession)
  return inventory
}

export async function listInventory(context: RequestContext, branchId: Types.ObjectId, search?: string) {
  await getBranchForContext(context, branchId)
  const inventoryItems = await InventoryItemModel.find({
    businessAccountId: context.businessAccountId,
    branchId,
    status: { $ne: 'discontinued' }
  }).sort({ updatedAt: -1 })

  const productIds = inventoryItems.map((item) => item.productId)
  const productQuery: Record<string, unknown> = {
    _id: { $in: productIds },
    businessAccountId: context.businessAccountId,
    isActive: true
  }

  if (search) {
    const searchRegex = new RegExp(escapeRegex(search), 'i')
    productQuery.$or = [{ name: searchRegex }, { barcode: searchRegex }, { sku: searchRegex }, { category: searchRegex }]
  }

  const products = await ProductModel.find(productQuery)
  const productById = new Map(products.map((product) => [product._id.toString(), product]))

  const results: Record<string, unknown>[] = []
  for (const item of inventoryItems) {
    const product = productById.get(item.productId.toString())
    if (product) results.push(serializeInventoryProduct(item, product, context))
  }
  return results
}

export async function adjustInventory(
  context: RequestContext,
  branchId: Types.ObjectId,
  input: InventoryAdjustmentInput,
  requestMeta?: { ipAddress?: string; userAgent?: string }
) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const product = await ProductModel.findOne({
      _id: input.productId,
      businessAccountId: context.businessAccountId,
      isActive: true
    }).session(activeSession ?? null)
    if (!product) throw notFound('Product not found')

    const inventory = await InventoryItemModel.findOne({
      businessAccountId: context.businessAccountId,
      branchId,
      productId: input.productId,
      status: { $ne: 'discontinued' }
    }).session(activeSession ?? null)
    if (!inventory) throw notFound('Inventory item not found for product in this branch')

    const previousQuantity = inventory.quantity
    const newQuantity = getAdjustedQuantity(previousQuantity, input.adjustmentType, input.quantity)
    const movementQuantity = Math.abs(newQuantity - previousQuantity)

    if (movementQuantity === 0) {
      throw new ApiError(422, 'no_stock_change', 'Adjustment does not change stock quantity')
    }

    const direction = newQuantity > previousQuantity ? 'in' : 'out'
    const unitCostPrice = input.unitCostPrice ?? inventory.costPrice ?? 0

    inventory.quantity = newQuantity
    inventory.lastMovementAt = new Date()
    if (input.unitCostPrice !== undefined && direction === 'in') {
      inventory.lastCostPrice = input.unitCostPrice
      inventory.costPrice = input.unitCostPrice
      inventory.averageCostPrice = getWeightedAverageCost(previousQuantity, inventory.averageCostPrice, movementQuantity, input.unitCostPrice)
    }
    applyComputedInventoryFields(inventory)
    inventory.version += 1
    await inventory.save(activeSession ? { session: activeSession } : undefined)

    const [movement] = await StockMovementModel.create(
      [
        {
          businessAccountId: context.businessAccountId,
          branchId,
          productId: input.productId,
          movementType: 'adjustment',
          quantity: movementQuantity,
          direction,
          previousQuantity,
          newQuantity,
          unitCostPrice,
          totalValue: movementQuantity * unitCostPrice,
          reason: input.reason,
          notes: input.notes,
          createdBy: context.userId
        }
      ],
      activeSession ? { session: activeSession } : {}
    )

    await updateLowStockAlert(context.businessAccountId!, branchId, input.productId, inventory, activeSession)
    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId: context.businessAccountId,
        actorUserId: context.userId,
        actorRole: context.role,
        action: 'inventory.adjusted',
        targetType: 'inventory_item',
        targetId: inventory._id,
        branchId,
        metadata: {
          productId: input.productId.toString(),
          adjustmentType: input.adjustmentType,
          previousQuantity,
          newQuantity,
          reason: input.reason
        },
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent
      },
      activeSession
    )

    return {
      product: normalizeMongo(product.toObject({ versionKey: false })),
      inventory: serializeInventoryItem(inventory, context),
      movement: serializeStockMovement(movement, context)
    }
  })
}

export async function listStockMovements(context: RequestContext, branchId: Types.ObjectId, productId?: Types.ObjectId) {
  await getBranchForContext(context, branchId)
  const query: Record<string, unknown> = {
    businessAccountId: context.businessAccountId,
    branchId
  }
  if (productId) query.productId = productId

  const movements = await StockMovementModel.find(query).sort({ createdAt: -1 }).limit(100)
  return movements.map((movement) => serializeStockMovement(movement, context))
}

export async function listAlerts(context: RequestContext, branchId: Types.ObjectId) {
  await getBranchForContext(context, branchId)
  const alerts = await AlertModel.find({
    businessAccountId: context.businessAccountId,
    branchId,
    status: 'active'
  }).sort({ updatedAt: -1 })
  return alerts.map((alert) => normalizeMongo(alert.toObject({ versionKey: false })))
}

export function serializeInventoryProduct(inventory: { toObject(options?: unknown): unknown }, product: { toObject(options?: unknown): unknown }, context: RequestContext) {
  const serializedProduct = normalizeMongo(product.toObject({ versionKey: false })) as Record<string, unknown>
  const serializedInventory = serializeInventoryItem(inventory, context)
  return {
    ...serializedProduct,
    inventory: serializedInventory
  }
}

export function serializeInventoryItem(inventory: { toObject(options?: unknown): unknown }, context: RequestContext) {
  const value = normalizeMongo(inventory.toObject({ versionKey: false })) as Record<string, unknown>
  if (context.role === 'cashier') {
    delete value.averageCostPrice
    delete value.lastCostPrice
    delete value.costPrice
    delete value.stockValue
    delete value.supplierId
  } else {
    const costPrice = Number(value.costPrice ?? 0)
    const sellingPrice = Number(value.sellingPrice ?? 0)
    value.profitMargin = sellingPrice - costPrice
  }
  return value
}

export function serializeStockMovement(movement: { toObject(options?: unknown): unknown }, context: RequestContext) {
  const value = normalizeMongo(movement.toObject({ versionKey: false })) as Record<string, unknown>
  if (context.role === 'cashier') {
    delete value.unitCostPrice
    delete value.totalValue
  }
  return value
}

export async function updateLowStockAlert(
  businessAccountId: Types.ObjectId,
  branchId: Types.ObjectId,
  productId: Types.ObjectId,
  inventory: { quantity: number; reorderLevel: number },
  session?: ClientSession
) {
  const activeSession = session?.inTransaction() ? session : undefined
  const isLowStock = inventory.reorderLevel > 0 && inventory.quantity <= inventory.reorderLevel
  if (isLowStock) {
    await AlertModel.findOneAndUpdate(
      {
        businessAccountId,
        branchId,
        productId,
        alertType: 'low_stock',
        status: 'active'
      },
      {
        $set: {
          severity: inventory.quantity === 0 ? 'high' : 'medium',
          message: inventory.quantity === 0 ? 'Product is out of stock' : 'Product is below reorder level',
          metadata: {
            quantity: inventory.quantity,
            reorderLevel: inventory.reorderLevel
          }
        },
        $setOnInsert: {
          businessAccountId,
          branchId,
          productId,
          alertType: 'low_stock',
          status: 'active'
        }
      },
      activeSession ? { upsert: true, new: true, session: activeSession } : { upsert: true, new: true }
    )
    return
  }

  await AlertModel.updateMany(
    {
      businessAccountId,
      branchId,
      productId,
      alertType: 'low_stock',
      status: 'active'
    },
    { $set: { status: 'resolved', resolvedAt: new Date() } },
    activeSession ? { session: activeSession } : {}
  )
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) {
    throw new ApiError(403, 'business_required', 'Business context required')
  }
  if (context.role !== 'owner' && context.role !== 'manager') {
    throw new ApiError(403, 'manager_required', 'Only owners and managers can manage inventory')
  }
}

function getAdjustedQuantity(previousQuantity: number, adjustmentType: InventoryAdjustmentInput['adjustmentType'], quantity: number) {
  if (adjustmentType === 'increase') return previousQuantity + quantity
  if (adjustmentType === 'decrease') {
    if (quantity > previousQuantity) {
      throw new ApiError(409, 'insufficient_stock', 'Adjustment would make stock quantity negative')
    }
    return previousQuantity - quantity
  }
  return quantity
}

function computeInventoryFields<T extends Record<string, unknown>>(input: T & { quantity: number; reservedQuantity: number; reorderLevel: number; costPrice: number }) {
  return {
    ...input,
    availableQuantity: Math.max(input.quantity - input.reservedQuantity, 0),
    stockValue: input.quantity * input.costPrice,
    status: getInventoryStatus(input.quantity, input.reorderLevel)
  }
}

function applyComputedInventoryFields(inventory: { quantity: number; reservedQuantity: number; reorderLevel: number; costPrice: number; availableQuantity: number; stockValue: number; status: string }) {
  inventory.availableQuantity = Math.max(inventory.quantity - inventory.reservedQuantity, 0)
  inventory.stockValue = inventory.quantity * inventory.costPrice
  inventory.status = getInventoryStatus(inventory.quantity, inventory.reorderLevel)
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
