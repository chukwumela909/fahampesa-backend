import { Router } from 'express'
import { create, get, list, refund, refunds, remove, update } from '../controllers/sale.controller.js'
import { requireWriteAccess } from '../middleware/auth.js'
import { idempotency } from '../middleware/idempotency.js'

export const saleRouter = Router({ mergeParams: true })

saleRouter.get('/', list)
// `idempotency` collapses retried POSTs (offline outbox drains, double-taps) so a dropped response
// after commit can't create a duplicate sale + double stock deduction.
saleRouter.post('/', requireWriteAccess, idempotency, create)
// `/refunds` must be registered before `/:saleId` so it is not matched as a sale id
saleRouter.get('/refunds', refunds)
saleRouter.get('/:saleId', get)
saleRouter.patch('/:saleId', requireWriteAccess, update)
saleRouter.delete('/:saleId', requireWriteAccess, remove)
saleRouter.post('/:saleId/refund', requireWriteAccess, refund)
