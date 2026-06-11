import { Router } from 'express'
import { create, get, list, refund, refunds, remove, update } from '../controllers/sale.controller.js'
import { requireWriteAccess } from '../middleware/auth.js'

export const saleRouter = Router({ mergeParams: true })

saleRouter.get('/', list)
saleRouter.post('/', requireWriteAccess, create)
// `/refunds` must be registered before `/:saleId` so it is not matched as a sale id
saleRouter.get('/refunds', refunds)
saleRouter.get('/:saleId', get)
saleRouter.patch('/:saleId', requireWriteAccess, update)
saleRouter.delete('/:saleId', requireWriteAccess, remove)
saleRouter.post('/:saleId/refund', requireWriteAccess, refund)
