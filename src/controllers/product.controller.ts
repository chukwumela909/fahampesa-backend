import type { Response } from 'express'
import type { Types } from 'mongoose'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { ApiError } from '../utils/api-error.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { createBranchProductSchema, productListQuerySchema, updateBranchProductSchema } from '../validators/product.validator.js'
import {
  createBranchProduct,
  getBranchProduct,
  listBranchProducts,
  removeBranchProduct,
  updateBranchProduct,
  type ProductIdentityInput
} from '../services/product.service.js'

export const list = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const query = productListQuerySchema.parse(req.query)
  const products = await listBranchProducts(req.context!, branchId, query.search)
  res.json({ data: products })
})

export const create = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const body = createBranchProductSchema.parse(req.body)
  const product = await createBranchProduct(req.context!, branchId, mapProductBody(body), {
    ipAddress: req.ip,
    userAgent: req.header('user-agent')
  })
  res.status(201).json({ data: product })
})

export const get = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const productId = toObjectId(objectIdSchema.parse(req.params.productId))
  const product = await getBranchProduct(req.context!, branchId, productId)
  res.json({ data: product })
})

export const update = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const productId = toObjectId(objectIdSchema.parse(req.params.productId))
  const body = updateBranchProductSchema.parse(req.body)
  const product = await updateBranchProduct(req.context!, branchId, productId, mapProductBody(body), {
    ipAddress: req.ip,
    userAgent: req.header('user-agent')
  })
  res.json({ data: product })
})

export const remove = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const productId = toObjectId(objectIdSchema.parse(req.params.productId))
  const result = await removeBranchProduct(req.context!, branchId, productId, {
    ipAddress: req.ip,
    userAgent: req.header('user-agent')
  })
  res.json({ data: result })
})

export const bulkUpload = asyncHandler(async () => {
  throw new ApiError(501, 'bulk_upload_not_implemented', 'Bulk product upload endpoint is reserved for the import workflow')
})

export const exportProducts = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const query = productListQuerySchema.parse(req.query)
  const products = await listBranchProducts(req.context!, branchId, query.search)
  const csv = toProductsCsv(products, req.context?.role === 'cashier')

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="branch-${branchId.toString()}-products.csv"`)
  res.send(csv)
})

function mapProductBody(body: {
  productId?: string
  inventory?: {
    supplierId?: string | null
    expiryDate?: Date | null
    [key: string]: unknown
  }
  [key: string]: unknown
}): ProductIdentityInput {
  return {
    productId: body.productId ? toObjectId(body.productId) : undefined,
    name: body.name as string | undefined,
    description: body.description as string | undefined,
    images: body.images as string[] | undefined,
    barcode: body.barcode as string | null | undefined,
    sku: body.sku as string | null | undefined,
    category: body.category as string | null | undefined,
    unitOfMeasure: body.unitOfMeasure as string | undefined,
    isPerishable: body.isPerishable as boolean | undefined,
    inventory: body.inventory
      ? {
          ...body.inventory,
          supplierId: mapOptionalObjectId(body.inventory.supplierId)
        }
      : undefined
  }
}

function mapOptionalObjectId(value?: string | null): Types.ObjectId | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return toObjectId(value)
}

function toProductsCsv(products: Record<string, unknown>[], cashierSafe: boolean) {
  const columns = cashierSafe
    ? ['name', 'barcode', 'sku', 'category', 'quantity', 'reorderLevel', 'sellingPrice', 'status']
    : ['name', 'barcode', 'sku', 'category', 'quantity', 'reorderLevel', 'costPrice', 'sellingPrice', 'stockValue', 'status']

  const rows = products.map((product) => {
    const inventory = (product.inventory ?? {}) as Record<string, unknown>
    const row: Record<string, unknown> = { ...product, ...inventory }
    return columns.map((column) => csvCell(row[column])).join(',')
  })

  return [columns.join(','), ...rows].join('\n')
}

function csvCell(value: unknown) {
  if (value === undefined || value === null) return ''
  return `"${String(value).replace(/"/g, '""')}"`
}
