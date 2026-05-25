import { Router } from 'express'
import { auditLogs, branchLimit, businesses, businessDetail, extend, manualActivate, pause, payments, resume, retryPayment, revoke } from '../controllers/admin.controller.js'
import { requirePlatformAdmin } from '../middleware/auth.js'

export const adminRouter = Router()

adminRouter.use(requirePlatformAdmin)
adminRouter.get('/businesses', businesses)
adminRouter.get('/businesses/:businessAccountId', businessDetail)
adminRouter.post('/businesses/:businessAccountId/pause', pause)
adminRouter.post('/businesses/:businessAccountId/resume', resume)
adminRouter.post('/businesses/:businessAccountId/revoke', revoke)
adminRouter.post('/businesses/:businessAccountId/branch-limit', branchLimit)
adminRouter.post('/businesses/:businessAccountId/subscriptions/extend', extend)
adminRouter.post('/businesses/:businessAccountId/subscriptions/manual-activate', manualActivate)
adminRouter.post('/payment-events/:eventId/retry', retryPayment)
adminRouter.get('/audit-logs', auditLogs)
adminRouter.get('/payments', payments)
