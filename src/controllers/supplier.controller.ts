import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { createSupplierPaymentSchema, createSupplierSchema, updateSupplierSchema } from '../validators/supplier.validator.js'
import { createSupplier, deleteSupplier, getSupplier, listSupplierLedger, listSupplierPayments, listSuppliers, recordSupplierPayment, updateSupplier } from '../services/supplier.service.js'

export const list = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  res.json({ data: await listSuppliers(req.context!, branchId) })
})

export const create = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const body = createSupplierSchema.parse(req.body)
  res.status(201).json({ data: await createSupplier(req.context!, branchId, body) })
})

export const get = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const supplierId = toObjectId(objectIdSchema.parse(req.params.supplierId))
  res.json({ data: await getSupplier(req.context!, branchId, supplierId) })
})

export const update = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const supplierId = toObjectId(objectIdSchema.parse(req.params.supplierId))
  const body = updateSupplierSchema.parse(req.body)
  res.json({ data: await updateSupplier(req.context!, branchId, supplierId, body) })
})

export const remove = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const supplierId = toObjectId(objectIdSchema.parse(req.params.supplierId))
  res.json({ data: await deleteSupplier(req.context!, branchId, supplierId) })
})

export const ledger = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const supplierId = toObjectId(objectIdSchema.parse(req.params.supplierId))
  res.json({ data: await listSupplierLedger(req.context!, branchId, supplierId) })
})

export const payments = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const supplierId = toObjectId(objectIdSchema.parse(req.params.supplierId))
  res.json({ data: await listSupplierPayments(req.context!, branchId, supplierId) })
})

export const payment = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const supplierId = toObjectId(objectIdSchema.parse(req.params.supplierId))
  const body = createSupplierPaymentSchema.parse(req.body)
  res.status(201).json({
    data: await recordSupplierPayment(req.context!, branchId, supplierId, {
      ...body,
      purchaseOrderId: body.purchaseOrderId ? toObjectId(body.purchaseOrderId) : undefined
    })
  })
})
