import { Router } from 'express'
import { acceptInvitation, activate, cancelInvitation, create, createInvitation, createLog, disableTwoFactor, get, list, listInvitations, listMyInvitations, logs, lookupInvitation, remove, resendMyPendingInvitation, setupTwoFactor, update, verifyTwoFactor } from '../controllers/staff.controller.js'
import { requireBusinessContext, requireWriteAccess } from '../middleware/auth.js'

// Public, token-gated lookup so an invitee can see what they were invited to
// (and we can pre-fill their email) BEFORE they have an account or are signed in.
// Mounted ahead of the auth middleware in app.ts.
export const publicStaffRouter = Router()
publicStaffRouter.get('/invitations/lookup', lookupInvitation)

export const staffRouter = Router()

// Accept needs an authenticated user but no business context yet (they aren't a member until accept).
staffRouter.post('/invitations/accept', acceptInvitation)
// Same for an invitee checking / re-sending their own pending invitations (e.g. after they
// signed up through the normal flow instead of the invite link).
staffRouter.get('/invitations/pending', listMyInvitations)
staffRouter.post('/invitations/pending/:invitationId/resend', resendMyPendingInvitation)
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
