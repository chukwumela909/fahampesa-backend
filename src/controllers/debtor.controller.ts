import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { createDebtorPaymentSchema, createDebtorSchema, updateDebtorSchema } from '../validators/debtor.validator.js'
import { createDebtor, getDebtor, listDebtors, recordDebtorPayment, updateDebtor } from '../services/debtor.service.js'

export const list = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const debtors = await listDebtors(req.context!, branchId)
  res.json({ data: debtors })
})

export const create = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const body = createDebtorSchema.parse(req.body)
  const debtor = await createDebtor(req.context!, branchId, body)
  res.status(201).json({ data: debtor })
})

export const get = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const debtorId = toObjectId(objectIdSchema.parse(req.params.debtorId))
  const debtor = await getDebtor(req.context!, branchId, debtorId)
  res.json({ data: debtor })
})

export const update = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const debtorId = toObjectId(objectIdSchema.parse(req.params.debtorId))
  const body = updateDebtorSchema.parse(req.body)
  const debtor = await updateDebtor(req.context!, branchId, debtorId, body)
  res.json({ data: debtor })
})

export const payment = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const debtorId = toObjectId(objectIdSchema.parse(req.params.debtorId))
  const body = createDebtorPaymentSchema.parse(req.body)
  const result = await recordDebtorPayment(req.context!, branchId, debtorId, body)
  res.status(201).json({ data: result })
})
