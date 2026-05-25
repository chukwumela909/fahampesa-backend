import { Router } from 'express'
import { approve, cancel, create, get, list, receive } from '../controllers/purchase-order.controller.js'
import { requireWriteAccess } from '../middleware/auth.js'

export const purchaseOrderRouter = Router({ mergeParams: true })

purchaseOrderRouter.get('/', list)
purchaseOrderRouter.post('/', requireWriteAccess, create)
purchaseOrderRouter.get('/:purchaseOrderId', get)
purchaseOrderRouter.post('/:purchaseOrderId/approve', requireWriteAccess, approve)
purchaseOrderRouter.post('/:purchaseOrderId/receive', requireWriteAccess, receive)
purchaseOrderRouter.post('/:purchaseOrderId/cancel', requireWriteAccess, cancel)
