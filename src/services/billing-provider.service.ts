import { env } from '../config/env.js'
import type { PlanType } from '../validators/billing.validator.js'

export interface MpesaStkPushInput {
  businessAccountId: string
  planType: PlanType
  amount: number
  phoneNumber: string
}

export interface StripeCheckoutInput {
  businessAccountId: string
  planType: PlanType
  amount: number
  successUrl?: string
  cancelUrl?: string
}

export class PlaceholderMpesaProvider {
  async createStkPush(input: MpesaStkPushInput) {
    const suffix = `${input.businessAccountId}-${input.planType}-${Date.now()}`
    return {
      checkoutRequestId: `placeholder-mpesa-${suffix}`,
      merchantRequestId: `placeholder-merchant-${suffix}`,
      responseDescription: 'Placeholder M-Pesa STK push created'
    }
  }
}

export class PlaceholderStripeProvider {
  async createCheckoutSession(input: StripeCheckoutInput) {
    const suffix = `${input.businessAccountId}-${input.planType}-${Date.now()}`
    return {
      sessionId: `placeholder-stripe-${suffix}`,
      url: `${env.APP_BASE_URL}/placeholder/stripe-checkout?session_id=placeholder-stripe-${suffix}`,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl
    }
  }
}
