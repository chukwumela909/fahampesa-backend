import { z } from 'zod'
import { objectIdSchema } from './common.js'

const transferItemSchema = z.object({
  productId: objectIdSchema,
  quantity: z.number().positive()
})

export const createTransferSchema = z.object({
  fromBranchId: objectIdSchema,
  toBranchId: objectIdSchema,
  items: z.array(transferItemSchema).min(1),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  notes: z.string().trim().optional()
})

export type CreateTransferBody = z.infer<typeof createTransferSchema>
