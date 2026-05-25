import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { inventoryAdjustmentSchema, inventoryListQuerySchema, movementListQuerySchema } from '../validators/inventory.validator.js'
import { adjustInventory, listAlerts, listInventory, listStockMovements } from '../services/inventory.service.js'

export const list = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const query = inventoryListQuerySchema.parse(req.query)
  const inventory = await listInventory(req.context!, branchId, query.search)
  res.json({ data: inventory })
})

export const adjust = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const body = inventoryAdjustmentSchema.parse(req.body)
  const result = await adjustInventory(
    req.context!,
    branchId,
    {
      ...body,
      productId: toObjectId(body.productId)
    },
    {
      ipAddress: req.ip,
      userAgent: req.header('user-agent')
    }
  )
  res.status(201).json({ data: result })
})

export const movements = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const query = movementListQuerySchema.parse(req.query)
  const data = await listStockMovements(req.context!, branchId, query.productId ? toObjectId(query.productId) : undefined)
  res.json({ data })
})

export const alerts = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const data = await listAlerts(req.context!, branchId)
  res.json({ data })
})
