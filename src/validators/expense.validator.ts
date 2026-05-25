import { z } from 'zod'

const expensePaymentMethodSchema = z.enum(['cash', 'mpesa', 'bank_transfer', 'card', 'cheque', 'other'])

export const createExpenseSchema = z.object({
  amount: z.number().positive(),
  category: z.string().trim().min(1),
  description: z.string().trim().optional(),
  paymentMethod: expensePaymentMethodSchema,
  vendor: z.string().trim().optional(),
  receiptNumber: z.string().trim().optional(),
  attachmentUrl: z.string().trim().url().optional(),
  date: z.coerce.date().optional()
})

export const updateExpenseSchema = createExpenseSchema.partial()

export type CreateExpenseBody = z.infer<typeof createExpenseSchema>
