import { z } from 'zod'

const debtorPaymentMethodSchema = z.enum(['cash', 'mpesa', 'bank_transfer', 'card', 'cheque', 'other'])

export const createDebtorSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  creditLimit: z.number().min(0).optional(),
  dueDate: z.coerce.date().nullable().optional()
})

export const updateDebtorSchema = createDebtorSchema.partial().extend({
  isActive: z.boolean().optional()
})

export const createDebtorPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: debtorPaymentMethodSchema,
  reference: z.string().trim().optional()
})

export type CreateDebtorBody = z.infer<typeof createDebtorSchema>
export type CreateDebtorPaymentBody = z.infer<typeof createDebtorPaymentSchema>
