import { z } from 'zod'
import { objectIdSchema } from './common.js'

const inventorySettingsSchema = z.object({
  reorderLevel: z.number().min(0).optional(),
  costPrice: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  supplierId: objectIdSchema.nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  batchNumber: z.string().trim().optional(),
  binLocation: z.string().trim().optional()
})

export const createBranchProductSchema = z
  .object({
    productId: objectIdSchema.optional(),
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    images: z.array(z.string().trim().url()).optional(),
    barcode: z.string().trim().min(1).optional(),
    sku: z.string().trim().min(1).optional(),
    category: z.string().trim().optional(),
    unitOfMeasure: z.string().trim().min(1).optional(),
    isPerishable: z.boolean().optional(),
    inventory: inventorySettingsSchema
      .extend({
        initialQuantity: z.number().min(0).optional(),
        initialStockReason: z.string().trim().min(1).optional()
      })
      .optional()
  })
  .superRefine((value, ctx) => {
    if (!value.productId && !value.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Product name is required when productId is not provided'
      })
    }
  })

export const updateBranchProductSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  images: z.array(z.string().trim().url()).optional(),
  barcode: z.string().trim().min(1).nullable().optional(),
  sku: z.string().trim().min(1).nullable().optional(),
  category: z.string().trim().nullable().optional(),
  unitOfMeasure: z.string().trim().min(1).optional(),
  isPerishable: z.boolean().optional(),
  inventory: inventorySettingsSchema.optional()
})

export const productListQuerySchema = z.object({
  search: z.string().trim().optional()
})

export type CreateBranchProductBody = z.infer<typeof createBranchProductSchema>
export type UpdateBranchProductBody = z.infer<typeof updateBranchProductSchema>
