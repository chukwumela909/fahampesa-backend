import { z } from 'zod'
import { objectIdSchema } from './common.js'

export const supplierPaymentMethodSchema = z.enum(['cash', 'mpesa', 'bank_transfer', 'card', 'cheque', 'other'])

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1),
  contactPerson: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  address: z.string().trim().optional(),
  categories: z.array(z.string().trim().min(1)).optional(),
  productsSupplied: z.array(z.string().trim().min(1)).optional(),
  openingBalance: z.number().min(0).optional(),
  paymentTerms: z.string().trim().optional(),
  notes: z.string().trim().optional()
})

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional()
})

export const createSupplierPaymentSchema = z.object({
  purchaseOrderId: objectIdSchema.optional(),
  amount: z.number().positive(),
  paymentMethod: supplierPaymentMethodSchema,
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional()
})

export type CreateSupplierBody = z.infer<typeof createSupplierSchema>
