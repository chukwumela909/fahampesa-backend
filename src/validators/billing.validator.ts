import { z } from 'zod'

export const planTypeSchema = z.enum(['monthly', 'yearly'])

export const mpesaCheckoutSchema = z.object({
  planType: planTypeSchema,
  phoneNumber: z.string().trim().min(7)
})

export const stripeCheckoutSchema = z.object({
  planType: planTypeSchema,
  successUrl: z.string().trim().url().optional(),
  cancelUrl: z.string().trim().url().optional()
})

export const mpesaCallbackSchema = z.object({
  eventId: z.string().trim().optional(),
  checkoutRequestId: z.string().trim().min(1),
  resultCode: z.number(),
  transactionId: z.string().trim().optional()
})

export const stripeWebhookSchema = z.object({
  id: z.string().trim().min(1),
  type: z.string().trim().min(1),
  data: z.object({
    object: z.object({
      id: z.string().trim().min(1),
      payment_intent: z.string().trim().optional()
    })
  })
})

export type PlanType = z.infer<typeof planTypeSchema>
