import { z } from 'zod'

const debtorPaymentMethodSchema = z.enum(['cash', 'mpesa', 'bank_transfer', 'card', 'cheque', 'other'])

export const createDebtorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional(),
  address: z.string().trim().max(300).optional(),
  creditLimit: z.number().min(0).optional(),
  // When the debt was taken (backdatable); defaults to creation time.
  debtDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  note: z.string().trim().max(1000).optional(),
  // Pre-existing debt carried in at creation time; applied once to currentDebt.
  openingDebt: z.number().min(0).optional()
})

// openingDebt is create-only: editing a debtor must not silently rewrite their balance.
export const updateDebtorSchema = createDebtorSchema.omit({ openingDebt: true }).partial().extend({
  isActive: z.boolean().optional()
})

export const createDebtorPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: debtorPaymentMethodSchema,
  reference: z.string().trim().optional()
})

export const addDebtorPurchaseSchema = z.object({
  amount: z.number().positive(),
  dueDate: z.coerce.date().nullable().optional()
})

export type CreateDebtorBody = z.infer<typeof createDebtorSchema>
export type CreateDebtorPaymentBody = z.infer<typeof createDebtorPaymentSchema>
