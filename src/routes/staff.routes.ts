import { Router } from 'express'
import { activate, create, createLog, disableTwoFactor, get, list, logs, remove, setupTwoFactor, update, verifyTwoFactor } from '../controllers/staff.controller.js'
import { requireBusinessContext, requireWriteAccess } from '../middleware/auth.js'

export const staffRouter = Router()

staffRouter.use(requireBusinessContext)
staffRouter.get('/', list)
staffRouter.post('/', requireWriteAccess, create)
staffRouter.get('/logs', logs)
staffRouter.post('/logs', requireWriteAccess, createLog)
staffRouter.post('/2fa/setup', setupTwoFactor)
staffRouter.post('/2fa/verify', verifyTwoFactor)
staffRouter.put('/2fa/verify', verifyTwoFactor)
staffRouter.post('/2fa/disable', disableTwoFactor)
staffRouter.get('/:staffId', get)
staffRouter.put('/:staffId', requireWriteAccess, update)
staffRouter.patch('/:staffId', requireWriteAccess, update)
staffRouter.delete('/:staffId', requireWriteAccess, remove)
staffRouter.post('/:staffId/activate', requireWriteAccess, activate)
