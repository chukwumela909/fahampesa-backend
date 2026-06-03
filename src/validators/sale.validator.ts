import { z } from 'zod'
import { objectIdSchema } from './common.js'

export const paymentMethodSchema = z.enum(['cash', 'mpesa', 'bank_transfer', 'card', 'credit', 'cheque', 'other'])
const discountTypeSchema = z.enum(['fixed', 'percentage'])

const saleItemSchema = z
  .object({
    productId: objectIdSchema,
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    discount: z.number().min(0).optional(),
    discountType: discountTypeSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.discountType === 'percentage' && (value.discount ?? 0) > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discount'],
        message: 'percentage discount cannot exceed 100'
      })
    }
  })

const customerSchema = z.object({
  name: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  debtorId: objectIdSchema.optional()
})

export const createSaleSchema = z
  .object({
    items: z.array(saleItemSchema).min(1),
    customer: customerSchema.optional(),
    paymentMethod: paymentMethodSchema,
    tax: z.number().min(0).optional(),
    discount: z.number().min(0).optional(),
    discountType: discountTypeSchema.optional(),
    notes: z.string().trim().optional()
  })
  .superRefine((value, ctx) => {
    if (value.discountType === 'percentage' && (value.discount ?? 0) > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discount'],
        message: 'percentage discount cannot exceed 100'
      })
    }

    if (value.paymentMethod === 'credit' && !value.customer?.debtorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customer', 'debtorId'],
        message: 'debtorId is required for credit sales'
      })
    }
  })

export const updateSaleSchema = z.object({
  customer: customerSchema.optional(),
  notes: z.string().trim().optional()
})

export type CreateSaleBody = z.infer<typeof createSaleSchema>
