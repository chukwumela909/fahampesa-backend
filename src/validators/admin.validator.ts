import { z } from 'zod'

export const branchLimitOverrideSchema = z.object({
  branchLimitOverride: z.number().int().min(1).nullable()
})

export const subscriptionExtendSchema = z.object({
  days: z.number().int().positive(),
  reason: z.string().trim().optional()
})

export const manualActivateSchema = z.object({
  planType: z.enum(['monthly', 'yearly']),
  days: z.number().int().positive().optional(),
  reason: z.string().trim().optional()
})

export const adminBusinessQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['active', 'paused', 'revoked']).optional()
})

