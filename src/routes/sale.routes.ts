import { Router } from 'express'
import { create, get, list, remove, update } from '../controllers/sale.controller.js'
import { requireWriteAccess } from '../middleware/auth.js'

export const saleRouter = Router({ mergeParams: true })

saleRouter.get('/', list)
saleRouter.post('/', requireWriteAccess, create)
saleRouter.get('/:saleId', get)
saleRouter.patch('/:saleId', requireWriteAccess, update)
saleRouter.delete('/:saleId', requireWriteAccess, remove)
