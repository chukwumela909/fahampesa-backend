import { Router } from 'express'
import { create, get, list, payment, update } from '../controllers/debtor.controller.js'
import { requireWriteAccess } from '../middleware/auth.js'

export const debtorRouter = Router({ mergeParams: true })

debtorRouter.get('/', list)
debtorRouter.post('/', requireWriteAccess, create)
debtorRouter.get('/:debtorId', get)
debtorRouter.patch('/:debtorId', requireWriteAccess, update)
debtorRouter.post('/:debtorId/payments', requireWriteAccess, payment)
