import { z } from 'zod'
import { objectIdSchema } from './common.js'

export const inventoryAdjustmentSchema = z
  .object({
    productId: objectIdSchema,
    adjustmentType: z.enum(['increase', 'decrease', 'set']),
    quantity: z.number().min(0),
    reason: z.string().trim().min(1),
    notes: z.string().trim().optional(),
    unitCostPrice: z.number().min(0).optional()
  })
  .superRefine((value, ctx) => {
    if (value.adjustmentType !== 'set' && value.quantity <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantity'],
        message: 'Quantity must be greater than 0 for increase and decrease adjustments'
      })
    }
  })

export const inventoryListQuerySchema = z.object({
  search: z.string().trim().optional()
})

export const movementListQuerySchema = z.object({
  productId: objectIdSchema.optional()
})

export type InventoryAdjustmentBody = z.infer<typeof inventoryAdjustmentSchema>
