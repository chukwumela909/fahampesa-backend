import { z } from 'zod'
import { objectIdSchema } from './common.js'

export const reportQuerySchema = z.object({
  branchId: z.union([objectIdSchema, z.literal('all')]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
})

export type ReportQuery = z.infer<typeof reportQuerySchema>
