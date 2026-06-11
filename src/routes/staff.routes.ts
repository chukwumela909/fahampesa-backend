import { Router } from 'express'
import { acceptInvitation, activate, cancelInvitation, create, createInvitation, createLog, disableTwoFactor, get, list, listInvitations, logs, lookupInvitation, remove, setupTwoFactor, update, verifyTwoFactor } from '../controllers/staff.controller.js'
import { requireBusinessContext, requireWriteAccess } from '../middleware/auth.js'

export const staffRouter = Router()

// Invitation accept/lookup only need an authenticated user (no business context yet)
staffRouter.post('/invitations/accept', acceptInvitation)
staffRouter.get('/invitations/lookup', lookupInvitation)
staffRouter.use(requireBusinessContext)
staffRouter.get('/invitations', listInvitations)
staffRouter.post('/invitations', requireWriteAccess, createInvitation)
staffRouter.post('/invitations/:staffId/cancel', requireWriteAccess, cancelInvitation)
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
