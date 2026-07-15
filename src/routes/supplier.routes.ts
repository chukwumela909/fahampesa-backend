import { Router } from 'express'
import { create, get, ledger, list, payment, payments, remove, update } from '../controllers/supplier.controller.js'
import { requireWriteAccess } from '../middleware/auth.js'
import { idempotency } from '../middleware/idempotency.js'

export const supplierRouter = Router({ mergeParams: true })

supplierRouter.get('/', list)
supplierRouter.post('/', requireWriteAccess, create)
supplierRouter.get('/:supplierId', get)
supplierRouter.patch('/:supplierId', requireWriteAccess, update)
supplierRouter.delete('/:supplierId', requireWriteAccess, remove)
supplierRouter.get('/:supplierId/ledger', ledger)
supplierRouter.get('/:supplierId/payments', payments)
supplierRouter.post('/:supplierId/payments', requireWriteAccess, idempotency, payment)
