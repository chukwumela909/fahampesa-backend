import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { createSaleSchema, updateSaleSchema } from '../validators/sale.validator.js'
import { createSale, deleteSale, getSale, listSales, updateSale } from '../services/sale.service.js'

export const list = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const sales = await listSales(req.context!, branchId)
  res.json({ data: sales })
})

export const create = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const body = createSaleSchema.parse(req.body)
  const sale = await createSale(
    req.context!,
    branchId,
    {
      ...body,
      items: body.items.map((item) => ({ ...item, productId: toObjectId(item.productId) })),
      customer: body.customer
        ? {
            ...body.customer,
            debtorId: body.customer.debtorId ? toObjectId(body.customer.debtorId) : undefined
          }
        : undefined
    },
    {
      ipAddress: req.ip,
      userAgent: req.header('user-agent')
    }
  )
  res.status(201).json({ data: sale })
})

export const get = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const saleId = toObjectId(objectIdSchema.parse(req.params.saleId))
  const sale = await getSale(req.context!, branchId, saleId)
  res.json({ data: sale })
})

export const update = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const saleId = toObjectId(objectIdSchema.parse(req.params.saleId))
  const body = updateSaleSchema.parse(req.body)
  const sale = await updateSale(req.context!, branchId, saleId, {
    ...body,
    customer: body.customer
      ? {
          ...body.customer,
          debtorId: body.customer.debtorId ? toObjectId(body.customer.debtorId) : undefined
        }
      : undefined
  })
  res.json({ data: sale })
})

export const remove = asyncHandler(async (req: AppRequest, res: Response) => {
  const branchId = toObjectId(objectIdSchema.parse(req.params.branchId))
  const saleId = toObjectId(objectIdSchema.parse(req.params.saleId))
  const result = await deleteSale(req.context!, branchId, saleId)
  res.json({ data: result })
})
