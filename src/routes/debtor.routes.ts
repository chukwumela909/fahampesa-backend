import { Router } from 'express'
import { create, get, list, payment, purchase, remove, update } from '../controllers/debtor.controller.js'
import { requireWriteAccess } from '../middleware/auth.js'

export const debtorRouter = Router({ mergeParams: true })

debtorRouter.get('/', list)
debtorRouter.post('/', requireWriteAccess, create)
debtorRouter.get('/:debtorId', get)
debtorRouter.patch('/:debtorId', requireWriteAccess, update)
debtorRouter.delete('/:debtorId', requireWriteAccess, remove)
debtorRouter.post('/:debtorId/payments', requireWriteAccess, payment)
debtorRouter.post('/:debtorId/purchases', requireWriteAccess, purchase)
