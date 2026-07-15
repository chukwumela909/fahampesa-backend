import { Router } from 'express'
import { create, get, list, payment, purchase, remove, update } from '../controllers/debtor.controller.js'
import { requireWriteAccess } from '../middleware/auth.js'
import { idempotency } from '../middleware/idempotency.js'

export const debtorRouter = Router({ mergeParams: true })

debtorRouter.get('/', list)
debtorRouter.post('/', requireWriteAccess, idempotency, create)
debtorRouter.get('/:debtorId', get)
debtorRouter.patch('/:debtorId', requireWriteAccess, update)
debtorRouter.delete('/:debtorId', requireWriteAccess, remove)
// Money mutations: idempotency collapses double-taps and offline-outbox retries so a
// payment/purchase can never be applied to the balance twice.
debtorRouter.post('/:debtorId/payments', requireWriteAccess, idempotency, payment)
debtorRouter.post('/:debtorId/purchases', requireWriteAccess, idempotency, purchase)
