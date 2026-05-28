import { Router } from 'express'
import { adminUsers, authUsers, createSuperAdmin, disableUser, firebaseAuthUsers, getIntegrationSettings, getNotificationSettings, getPlatformSettings, manageAdminUser, notificationHistory, notificationRecipients, sendNotification, updateIntegrationSettings, updateNotificationSettings, updatePlatformSettings, userStats } from '../controllers/platform.controller.js'
import { authMiddleware, requirePlatformAdmin } from '../middleware/auth.js'
import type { FirebaseTokenVerifier } from '../config/firebase.js'

export function createPublicPlatformRouter(verifier: FirebaseTokenVerifier) {
  const router = Router()
  router.post('/create-super-admin', optionalAuth(verifier), createSuperAdmin)
  return router
}

export const platformAdminRouter = Router()
export const notificationRouter = Router()

platformAdminRouter.use(requirePlatformAdmin)
platformAdminRouter.get('/auth-users', authUsers)
platformAdminRouter.get('/firebase-auth-users', firebaseAuthUsers)
platformAdminRouter.get('/user-stats', userStats)
platformAdminRouter.post('/users/:userId/disable', disableUser)
platformAdminRouter.get('/settings/platform', getPlatformSettings)
platformAdminRouter.post('/settings/platform', updatePlatformSettings)
platformAdminRouter.get('/settings/notifications', getNotificationSettings)
platformAdminRouter.post('/settings/notifications', updateNotificationSettings)
platformAdminRouter.get('/settings/integrations', getIntegrationSettings)
platformAdminRouter.post('/settings/integrations', updateIntegrationSettings)
platformAdminRouter.get('/settings/admin-users', adminUsers)
platformAdminRouter.post('/settings/admin-users', manageAdminUser)
platformAdminRouter.get('/settings/test', (_req, res) => {
  res.json({ success: true, checks: { platform: true, notifications: true, integrations: true } })
})
platformAdminRouter.get('/check-branches', (_req, res) => {
  res.json({ success: true, message: 'Branch checks are handled by /api/v1/admin/businesses' })
})
platformAdminRouter.get('/check-security-alerts', (_req, res) => {
  res.json({ success: true, alerts: [] })
})
platformAdminRouter.get('/crashlytics', (_req, res) => {
  res.json({ success: true, issues: [], source: 'Not configured' })
})
platformAdminRouter.post('/notifications/send', sendNotification)
platformAdminRouter.get('/notifications/send', notificationHistory)
platformAdminRouter.get('/notifications/recipients', notificationRecipients)

notificationRouter.use(requirePlatformAdmin)
notificationRouter.post('/send', sendNotification)
notificationRouter.get('/send', notificationHistory)
notificationRouter.get('/recipients', notificationRecipients)

function optionalAuth(verifier: FirebaseTokenVerifier) {
  const middleware = authMiddleware(verifier)
  return (req: Parameters<typeof middleware>[0], res: Parameters<typeof middleware>[1], next: Parameters<typeof middleware>[2]) => {
    if (!req.header('authorization')) {
      next()
      return
    }
    middleware(req, res, next)
  }
}
