import { Router } from 'express'
import { approve, cancel, create, get, list, receive, reject, ship } from '../controllers/transfer.controller.js'
import { requireBusinessContext, requireWriteAccess } from '../middleware/auth.js'

export const transferRouter = Router()

transferRouter.use(requireBusinessContext)
transferRouter.get('/', list)
transferRouter.post('/', requireWriteAccess, create)
transferRouter.get('/:transferId', get)
transferRouter.post('/:transferId/approve', requireWriteAccess, approve)
transferRouter.post('/:transferId/ship', requireWriteAccess, ship)
transferRouter.post('/:transferId/receive', requireWriteAccess, receive)
transferRouter.post('/:transferId/cancel', requireWriteAccess, cancel)
transferRouter.post('/:transferId/reject', requireWriteAccess, reject)
