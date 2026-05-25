import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { createPurchaseOrderSchema, receivePurchaseOrderSchema } from '../validators/purchase-order.validator.js'
import { approvePurchaseOrder, cancelPurchaseOrder, createPurchaseOrder, getPurchaseOrder, listPurchaseOrders, receivePurchaseOrder } from '../services/purchase-order.service.js'

export const list = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  res.json({ data: await listPurchaseOrders(req.context!, branchId) })
})

export const create = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const body = createPurchaseOrderSchema.parse(req.body)
  res.status(201).json({
    data: await createPurchaseOrder(req.context!, branchId, {
      ...body,
      supplierId: toObjectId(body.supplierId),
      items: body.items.map((item) => ({ ...item, productId: toObjectId(item.productId) }))
    })
  })
})

export const get = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const purchaseOrderId = toObjectId(objectIdSchema.parse(req.params.purchaseOrderId))
  res.json({ data: await getPurchaseOrder(req.context!, branchId, purchaseOrderId) })
})

export const approve = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const purchaseOrderId = toObjectId(objectIdSchema.parse(req.params.purchaseOrderId))
  res.json({ data: await approvePurchaseOrder(req.context!, branchId, purchaseOrderId) })
})

export const receive = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const purchaseOrderId = toObjectId(objectIdSchema.parse(req.params.purchaseOrderId))
  const body = receivePurchaseOrderSchema.parse(req.body)
  res.json({
    data: await receivePurchaseOrder(req.context!, branchId, purchaseOrderId, {
      items: body.items.map((item) => ({ ...item, productId: toObjectId(item.productId) }))
    })
  })
})

export const cancel = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const purchaseOrderId = toObjectId(objectIdSchema.parse(req.params.purchaseOrderId))
  res.json({ data: await cancelPurchaseOrder(req.context!, branchId, purchaseOrderId) })
})
