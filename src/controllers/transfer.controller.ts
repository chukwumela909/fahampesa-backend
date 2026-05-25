import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { createTransferSchema } from '../validators/transfer.validator.js'
import { approveTransfer, cancelTransfer, createTransfer, getTransfer, listTransfers, receiveTransfer, rejectTransfer, shipTransfer } from '../services/transfer.service.js'

export const list = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await listTransfers(req.context!) })
})

export const create = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = createTransferSchema.parse(req.body)
  res.status(201).json({
    data: await createTransfer(req.context!, {
      ...body,
      fromBranchId: toObjectId(body.fromBranchId),
      toBranchId: toObjectId(body.toBranchId),
      items: body.items.map((item) => ({ ...item, productId: toObjectId(item.productId) }))
    })
  })
})

export const get = asyncHandler(async (req: AppRequest, res: Response) => {
  const transferId = toObjectId(objectIdSchema.parse(req.params.transferId))
  res.json({ data: await getTransfer(req.context!, transferId) })
})

export const approve = asyncHandler(async (req: AppRequest, res: Response) => {
  const transferId = toObjectId(objectIdSchema.parse(req.params.transferId))
  res.json({ data: await approveTransfer(req.context!, transferId) })
})

export const ship = asyncHandler(async (req: AppRequest, res: Response) => {
  const transferId = toObjectId(objectIdSchema.parse(req.params.transferId))
  res.json({ data: await shipTransfer(req.context!, transferId) })
})

export const receive = asyncHandler(async (req: AppRequest, res: Response) => {
  const transferId = toObjectId(objectIdSchema.parse(req.params.transferId))
  res.json({ data: await receiveTransfer(req.context!, transferId) })
})

export const cancel = asyncHandler(async (req: AppRequest, res: Response) => {
  const transferId = toObjectId(objectIdSchema.parse(req.params.transferId))
  res.json({ data: await cancelTransfer(req.context!, transferId) })
})

export const reject = asyncHandler(async (req: AppRequest, res: Response) => {
  const transferId = toObjectId(objectIdSchema.parse(req.params.transferId))
  res.json({ data: await rejectTransfer(req.context!, transferId) })
})
