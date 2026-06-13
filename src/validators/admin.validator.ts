import { z } from 'zod'

export const branchLimitOverrideSchema = z.object({
  branchLimitOverride: z.number().int().min(1).nullable()
})

export const subscriptionExtendSchema = z.object({
  days: z.number().int().positive(),
  reason: z.string().trim().optional()
})

// Downgrade a business back to the free tier and cancel its active subscription.
export const subscriptionDeactivateSchema = z.object({
  reason: z.string().trim().optional()
})

// One-click Pro grant: an empty body activates a monthly plan. planType/days/reason
// are all optional overrides so the admin can grant a year or a custom window.
export const manualActivateSchema = z.object({
  planType: z.enum(['monthly', 'yearly']).default('monthly'),
  days: z.number().int().positive().optional(),
  reason: z.string().trim().optional()
})

export const adminBusinessQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['active', 'paused', 'revoked']).optional()
})

