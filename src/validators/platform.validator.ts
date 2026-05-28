import { z } from 'zod'

export const authUserQuerySchema = z.object({
  email: z.string().trim().optional(),
  includeFirestore: z.coerce.boolean().default(false)
})

export const disableUserSchema = z.object({
  disabled: z.boolean()
})

export const createSuperAdminSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6).optional(),
  displayName: z.string().trim().min(1)
})

export const platformSettingsSchema = z.object({
  platformName: z.string().trim().min(1),
  timezone: z.string().trim().min(1),
  defaultLanguage: z.string().trim().min(1),
  dataRetentionDays: z.number().int().min(1).max(3650),
  backupFrequency: z.enum(['Hourly', 'Daily', 'Weekly', 'Monthly']),
  updatedBy: z.string().trim().optional()
})

export const notificationSettingsSchema = z.object({
  emailEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  slackEnabled: z.boolean(),
  webhookUrl: z.string().url().or(z.literal('')).default(''),
  alertThresholds: z.object({
    userDropPercentage: z.number().min(1).max(100),
    errorRatePercentage: z.number().min(0.1).max(50),
    crashRatePercentage: z.number().min(0.1).max(20)
  }),
  updatedBy: z.string().trim().optional()
})

export const integrationSettingsSchema = z.object({
  firebase: z.object({
    enabled: z.boolean(),
    projectId: z.string().trim(),
    status: z.enum(['connected', 'disconnected', 'error']).optional()
  }),
  mixpanel: z.object({
    enabled: z.boolean(),
    projectToken: z.string().trim(),
    status: z.enum(['connected', 'disconnected', 'error']).optional()
  }),
  posthog: z.object({
    enabled: z.boolean(),
    apiKey: z.string().trim(),
    hostUrl: z.string().url(),
    status: z.enum(['connected', 'disconnected', 'error']).optional()
  }),
  updatedBy: z.string().trim().optional()
})

export const adminUserActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    name: z.string().trim().min(1),
    email: z.string().trim().email(),
    role: z.enum(['super_admin', 'admin', 'viewer']),
    createdBy: z.string().trim().optional()
  }),
  z.object({
    action: z.literal('update'),
    id: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    role: z.enum(['super_admin', 'admin', 'viewer']).optional(),
    status: z.enum(['active', 'inactive']).optional()
  }),
  z.object({
    action: z.literal('delete'),
    id: z.string().trim().min(1)
  })
])

export const sendNotificationSchema = z.object({
  announcementId: z.string().trim().min(1),
  announcement: z.object({
    title: z.string().trim().min(1),
    message: z.string().trim().min(1),
    type: z.string().trim().min(1),
    channel: z.string().trim().min(1),
    targetAudience: z.string().trim().min(1)
  }).passthrough()
})
