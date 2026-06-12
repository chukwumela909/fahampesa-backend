import { z } from 'zod'

export const planTypeSchema = z.enum(['monthly', 'yearly'])

// ISO 3166-1 alpha-2 country detected on the client (IP geolocation). Used to gate
// which payment provider is allowed based on the user's CURRENT location.
const countrySchema = z.string().trim().optional()

export const mpesaCheckoutSchema = z.object({
  planType: planTypeSchema,
  phoneNumber: z.string().trim().min(7),
  country: countrySchema
})

export const stripeCheckoutSchema = z.object({
  planType: planTypeSchema,
  successUrl: z.string().trim().url().optional(),
  cancelUrl: z.string().trim().url().optional(),
  country: countrySchema
})

const normalizedMpesaCallbackSchema = z.object({
  eventId: z.string().trim().optional(),
  checkoutRequestId: z.string().trim().min(1),
  merchantRequestId: z.string().trim().optional(),
  resultCode: z.number(),
  resultDesc: z.string().trim().optional(),
  transactionId: z.string().trim().optional(),
  amount: z.number().optional(),
  phoneNumber: z.string().trim().optional(),
  transactionDate: z.string().trim().optional(),
  rawPayload: z.unknown().optional()
})

export const mpesaCallbackSchema = z.preprocess((value) => {
  const payload = value as {
    Body?: {
      stkCallback?: {
        MerchantRequestID?: string
        CheckoutRequestID?: string
        ResultCode?: number
        ResultDesc?: string
        CallbackMetadata?: { Item?: Array<{ Name?: string; Value?: string | number }> }
      }
    }
  }

  const callback = payload?.Body?.stkCallback
  if (!callback) return value

  const metadata = extractMpesaMetadata(callback.CallbackMetadata?.Item)
  return {
    eventId: `mpesa-${callback.CheckoutRequestID}`,
    merchantRequestId: callback.MerchantRequestID,
    checkoutRequestId: callback.CheckoutRequestID,
    resultCode: callback.ResultCode,
    resultDesc: callback.ResultDesc,
    transactionId: metadata.transactionId,
    amount: metadata.amount,
    phoneNumber: metadata.phoneNumber,
    transactionDate: metadata.transactionDate,
    rawPayload: value
  }
}, normalizedMpesaCallbackSchema)

export type PlanType = z.infer<typeof planTypeSchema>
export type MpesaCallbackInput = z.infer<typeof normalizedMpesaCallbackSchema>

function extractMpesaMetadata(items?: Array<{ Name?: string; Value?: string | number }>) {
  const metadata: { transactionId?: string; amount?: number; transactionDate?: string; phoneNumber?: string } = {}
  for (const item of items ?? []) {
    switch (item.Name) {
      case 'Amount':
        metadata.amount = Number(item.Value)
        break
      case 'MpesaReceiptNumber':
        metadata.transactionId = String(item.Value)
        break
      case 'TransactionDate':
        metadata.transactionDate = String(item.Value)
        break
      case 'PhoneNumber':
        metadata.phoneNumber = String(item.Value)
        break
    }
  }
  return metadata
}
