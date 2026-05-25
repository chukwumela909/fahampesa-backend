import type { ClientSession, Types } from 'mongoose'
import { BranchModel } from '../models/branch.model.js'
import { InventoryItemModel } from '../models/inventory-item.model.js'
import { ProductModel } from '../models/product.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { withTransaction } from '../config/database.js'
import { getBranchForContext } from './branch.service.js'
import { writeAuditLog } from './audit.service.js'
import {
  createInventoryForProduct,
  serializeInventoryItem,
  serializeInventoryProduct,
  updateInventorySettings,
  type InventorySettingsInput
} from './inventory.service.js'

export interface ProductIdentityInput {
  productId?: Types.ObjectId
  name?: string
  description?: string
  images?: string[]
  barcode?: string | null
  sku?: string | null
  category?: string | null
  unitOfMeasure?: string
  isPerishable?: boolean
  inventory?: InventorySettingsInput
}

export async function listBranchProducts(context: RequestContext, branchId: Types.ObjectId, search?: string) {
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

export async function createBranchProduct(
  context: RequestContext,
  branchId: Types.ObjectId,
  input: ProductIdentityInput,
  requestMeta?: { ipAddress?: string; userAgent?: string }
) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    let product = input.productId
      ? await ProductModel.findOne({
          _id: input.productId,
          businessAccountId: context.businessAccountId,
          isActive: true
        }).session(activeSession ?? null)
      : null

    if (input.productId && !product) throw notFound('Product not found')

    if (!product) {
      await ensureUniqueProductIdentity(context, input, undefined, activeSession)
      const [created] = await ProductModel.create(
        [
          {
            businessAccountId: context.businessAccountId,
            name: input.name,
            description: input.description,
            images: input.images ?? [],
            barcode: input.barcode ?? undefined,
            sku: input.sku ?? undefined,
            category: input.category ?? undefined,
            unitOfMeasure: input.unitOfMeasure ?? 'unit',
            isPerishable: input.isPerishable ?? false,
            createdBy: context.userId
          }
        ],
        activeSession ? { session: activeSession } : {}
      )
      product = created
    }

    const inventory = await createInventoryForProduct(context, branchId, product._id, input.inventory ?? {}, activeSession)
    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId: context.businessAccountId,
        actorUserId: context.userId,
        actorRole: context.role,
        action: input.productId ? 'product.linked_to_branch' : 'product.created',
        targetType: 'product',
        targetId: product._id,
        branchId,
        metadata: { productName: product.name },
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent
      },
      activeSession
    )

    return serializeInventoryProduct(inventory, product, context)
  })
}

export async function getBranchProduct(context: RequestContext, branchId: Types.ObjectId, productId: Types.ObjectId) {
  await getBranchForContext(context, branchId)
  const product = await ProductModel.findOne({
    _id: productId,
    businessAccountId: context.businessAccountId,
    isActive: true
  })
  if (!product) throw notFound('Product not found')

  const inventory = await InventoryItemModel.findOne({
    businessAccountId: context.businessAccountId,
    branchId,
    productId,
    status: { $ne: 'discontinued' }
  })
  if (!inventory) throw notFound('Product is not linked to this branch')

  const accessibleBranchIds = await listAccessibleBranchIds(context)
  const inventoryByBranch = await InventoryItemModel.find({
    businessAccountId: context.businessAccountId,
    productId,
    branchId: { $in: accessibleBranchIds },
    status: { $ne: 'discontinued' }
  }).sort({ branchId: 1 })

  const value = normalizeMongo(product.toObject({ versionKey: false })) as Record<string, unknown>
  value.inventory = serializeInventoryItem(inventory, context)
  value.inventoryByBranch = inventoryByBranch.map((item) => serializeInventoryItem(item, context))
  return value
}

export async function updateBranchProduct(
  context: RequestContext,
  branchId: Types.ObjectId,
  productId: Types.ObjectId,
  input: ProductIdentityInput,
  requestMeta?: { ipAddress?: string; userAgent?: string }
) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const product = await ProductModel.findOne({
      _id: productId,
      businessAccountId: context.businessAccountId,
      isActive: true
    }).session(activeSession ?? null)
    if (!product) throw notFound('Product not found')

    const inventory = await InventoryItemModel.findOne({
      businessAccountId: context.businessAccountId,
      branchId,
      productId,
      status: { $ne: 'discontinued' }
    }).session(activeSession ?? null)
    if (!inventory) throw notFound('Product is not linked to this branch')

    await ensureUniqueProductIdentity(context, input, productId, activeSession)
    applyProductUpdate(product, input)
    product.version += 1
    await product.save(activeSession ? { session: activeSession } : undefined)

    const updatedInventory = input.inventory
      ? await updateInventorySettings(context, branchId, productId, input.inventory, activeSession)
      : inventory

    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId: context.businessAccountId,
        actorUserId: context.userId,
        actorRole: context.role,
        action: 'product.updated',
        targetType: 'product',
        targetId: product._id,
        branchId,
        metadata: { fields: Object.keys(input) },
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent
      },
      activeSession
    )

    return serializeInventoryProduct(updatedInventory, product, context)
  })
}

export async function removeBranchProduct(
  context: RequestContext,
  branchId: Types.ObjectId,
  productId: Types.ObjectId,
  requestMeta?: { ipAddress?: string; userAgent?: string }
) {
  requireManagerRole(context)
  await getBranchForContext(context, branchId)

  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const product = await ProductModel.findOne({
      _id: productId,
      businessAccountId: context.businessAccountId,
      isActive: true
    }).session(activeSession ?? null)
    if (!product) throw notFound('Product not found')

    const inventory = await InventoryItemModel.findOne({
      businessAccountId: context.businessAccountId,
      branchId,
      productId,
      status: { $ne: 'discontinued' }
    }).session(activeSession ?? null)
    if (!inventory) throw notFound('Product is not linked to this branch')

    inventory.status = 'discontinued'
    inventory.version += 1
    await inventory.save(activeSession ? { session: activeSession } : undefined)

    const remainingLinks = await InventoryItemModel.countDocuments({
      businessAccountId: context.businessAccountId,
      productId,
      status: { $ne: 'discontinued' }
    }).session(activeSession ?? null)
    if (remainingLinks === 0) {
      product.isActive = false
      product.version += 1
      await product.save(activeSession ? { session: activeSession } : undefined)
    }

    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId: context.businessAccountId,
        actorUserId: context.userId,
        actorRole: context.role,
        action: 'product.removed_from_branch',
        targetType: 'product',
        targetId: product._id,
        branchId,
        metadata: { productName: product.name },
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent
      },
      activeSession
    )

    return { removed: true }
  })
}

async function ensureUniqueProductIdentity(
  context: RequestContext,
  input: Pick<ProductIdentityInput, 'barcode' | 'sku'>,
  excludeProductId?: Types.ObjectId,
  session?: ClientSession
) {
  const clauses: Record<string, unknown>[] = []
  if (input.barcode) clauses.push({ barcode: input.barcode })
  if (input.sku) clauses.push({ sku: input.sku })
  if (clauses.length === 0) return

  const query: Record<string, unknown> = {
    businessAccountId: context.businessAccountId,
    isActive: true,
    $or: clauses
  }
  if (excludeProductId) query._id = { $ne: excludeProductId }
  const duplicate = await ProductModel.findOne(query).session(session ?? null)
  if (duplicate) {
    throw new ApiError(409, 'duplicate_product_identity', 'A product with this barcode or SKU already exists')
  }
}

async function listAccessibleBranchIds(context: RequestContext) {
  if (context.role === 'owner') {
    const branches = await BranchModel.find({
      businessAccountId: context.businessAccountId,
      status: { $ne: 'disabled' }
    }).select('_id')
    return branches.map((branch) => branch._id)
  }
  return context.assignedBranchIds
}

function applyProductUpdate(
  product: {
    name: string
    description?: string | null
    images: string[]
    barcode?: string | null
    sku?: string | null
    category?: string | null
    unitOfMeasure: string
    isPerishable: boolean
  },
  input: ProductIdentityInput
) {
  if (input.name !== undefined) product.name = input.name
  if (input.description !== undefined) product.description = input.description
  if (input.images !== undefined) product.images = input.images
  if (input.barcode !== undefined) product.barcode = input.barcode ?? undefined
  if (input.sku !== undefined) product.sku = input.sku ?? undefined
  if (input.category !== undefined) product.category = input.category ?? undefined
  if (input.unitOfMeasure !== undefined) product.unitOfMeasure = input.unitOfMeasure
  if (input.isPerishable !== undefined) product.isPerishable = input.isPerishable
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) {
    throw new ApiError(403, 'business_required', 'Business context required')
  }
  if (context.role !== 'owner' && context.role !== 'manager') {
    throw new ApiError(403, 'manager_required', 'Only owners and managers can manage products')
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
