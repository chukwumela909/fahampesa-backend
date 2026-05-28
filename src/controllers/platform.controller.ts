import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { env } from '../config/env.js'
import { ApiError } from '../utils/api-error.js'
import { adminUserActionSchema, authUserQuerySchema, createSuperAdminSchema, disableUserSchema, integrationSettingsSchema, notificationSettingsSchema, platformSettingsSchema, sendNotificationSchema } from '../validators/platform.validator.js'
import { createSuperAdminUser, disablePlatformUser, getPlatformSetting, getUserStatistics, listAnnouncements, listEnhancedAuthUsers, listNotificationRecipients, listPlatformAdminUsers, managePlatformAdminUser, sendAnnouncement, updatePlatformSetting } from '../services/platform.service.js'

export const firebaseAuthUsers = asyncHandler(async (req: AppRequest, res: Response) => {
  const query = authUserQuerySchema.parse(req.query)
  res.json(await listEnhancedAuthUsers(req.context!, query))
})

export const authUsers = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json(await listEnhancedAuthUsers(req.context!, { includeFirestore: true }))
})

export const userStats = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json(await getUserStatistics(req.context!))
})

export const disableUser = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = disableUserSchema.parse(req.body)
  res.json(await disablePlatformUser(req.context!, req.params.userId, body.disabled))
})

export const createSuperAdmin = asyncHandler(async (req: AppRequest, res: Response) => {
  if (req.context?.auth.platformRole !== 'admin') {
    const secret = typeof req.query.secret === 'string' ? req.query.secret : req.header('x-super-admin-secret')
    if (!env.SUPER_ADMIN_SECRET || secret !== env.SUPER_ADMIN_SECRET) {
      throw new ApiError(401, 'invalid_super_admin_secret', 'A valid super admin secret is required')
    }
  }
  const body = createSuperAdminSchema.parse(req.body)
  res.status(201).json(await createSuperAdminUser(req.context, body))
})

export const getPlatformSettings = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json(await getPlatformSetting(req.context!, 'platform'))
})

export const updatePlatformSettings = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = platformSettingsSchema.parse(req.body)
  res.json(await updatePlatformSetting(req.context!, 'platform', body))
})

export const getNotificationSettings = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json(await getPlatformSetting(req.context!, 'notifications'))
})

export const updateNotificationSettings = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = notificationSettingsSchema.parse(req.body)
  res.json(await updatePlatformSetting(req.context!, 'notifications', body))
})

export const getIntegrationSettings = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json(await getPlatformSetting(req.context!, 'integrations'))
})

export const updateIntegrationSettings = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = integrationSettingsSchema.parse(req.body)
  const settings = {
    ...body,
    firebase: { ...body.firebase, status: body.firebase.enabled ? 'connected' : 'disconnected' },
    mixpanel: { ...body.mixpanel, status: body.mixpanel.enabled && body.mixpanel.projectToken ? 'connected' : 'disconnected' },
    posthog: { ...body.posthog, status: body.posthog.enabled && body.posthog.apiKey ? 'connected' : 'disconnected' }
  }
  res.json(await updatePlatformSetting(req.context!, 'integrations', settings))
})

export const adminUsers = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json(await listPlatformAdminUsers(req.context!))
})

export const manageAdminUser = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = adminUserActionSchema.parse(req.body)
  const result = await managePlatformAdminUser(req.context!, body)
  res.status(body.action === 'create' ? 201 : 200).json(result)
})

export const sendNotification = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = sendNotificationSchema.parse(req.body)
  res.json(await sendAnnouncement(req.context!, body))
})

export const notificationHistory = asyncHandler(async (req: AppRequest, res: Response) => {
  const announcementId = typeof req.query.announcementId === 'string' ? req.query.announcementId : undefined
  res.json(await listAnnouncements(req.context!, announcementId))
})

export const notificationRecipients = asyncHandler(async (req: AppRequest, res: Response) => {
  const audience = typeof req.query.audience === 'string' ? req.query.audience : undefined
  res.json(await listNotificationRecipients(req.context!, audience))
})
