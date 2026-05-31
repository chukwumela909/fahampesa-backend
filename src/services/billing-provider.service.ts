import Stripe from 'stripe'
import { env } from '../config/env.js'
import { ApiError } from '../utils/api-error.js'
import type { PlanType } from '../validators/billing.validator.js'

export interface MpesaStkPushInput {
  businessAccountId: string
  subscriptionId: string
  planType: PlanType
  amount: number
  phoneNumber: string
}

export interface MpesaStkPushResult {
  checkoutRequestId: string
  merchantRequestId: string
  responseCode: string
  responseDescription: string
  customerMessage?: string
}

export interface MpesaProvider {
  createStkPush(input: MpesaStkPushInput): Promise<MpesaStkPushResult>
}

export interface StripeCheckoutInput {
  businessAccountId: string
  subscriptionId: string
  userId: string
  email?: string
  planType: PlanType
  amount: number
  currency: 'USD'
  successUrl?: string
  cancelUrl?: string
}

export interface StripeCheckoutResult {
  sessionId: string
  url: string | null
}

export interface StripeProvider {
  createCheckoutSession(input: StripeCheckoutInput): Promise<StripeCheckoutResult>
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event
}

type FetchLike = typeof fetch

interface DarajaTokenResponse {
  access_token?: string
  expires_in?: string | number
  error?: string
  error_description?: string
}

interface DarajaStkPushResponse {
  MerchantRequestID?: string
  CheckoutRequestID?: string
  ResponseCode?: string
  ResponseDescription?: string
  CustomerMessage?: string
  errorCode?: string
  errorMessage?: string
}

export class DarajaMpesaProvider implements MpesaProvider {
  private tokenCache?: { token: string; expiresAt: number }

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async createStkPush(input: MpesaStkPushInput): Promise<MpesaStkPushResult> {
    const shortcode = requireConfig('MPESA_SHORTCODE', env.MPESA_SHORTCODE)
    const passkey = requireConfig('MPESA_PASSKEY', env.MPESA_PASSKEY)
    const accessToken = await this.getAccessToken()
    const timestamp = formatDarajaTimestamp(new Date())
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64')
    const formattedPhone = normalizeKenyaPhoneNumber(input.phoneNumber)
    const amount = Math.round(input.amount)

    if (amount < 1) {
      throw new ApiError(422, 'invalid_payment_amount', 'Payment amount must be at least 1')
    }

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: getMpesaCallbackUrl(),
      AccountReference: getMpesaAccountReference(input.subscriptionId),
      TransactionDesc: getMpesaTransactionDescription(input.planType)
    }

    const response = await this.fetchImpl(`${getDarajaBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const data = (await safeJson(response)) as DarajaStkPushResponse
    if (!response.ok || data.ResponseCode !== '0' || !data.CheckoutRequestID || !data.MerchantRequestID) {
      throw new ApiError(502, 'mpesa_stk_push_failed', data.errorMessage || data.ResponseDescription || 'Failed to initiate M-Pesa STK push', {
        status: response.status,
        responseCode: data.ResponseCode,
        errorCode: data.errorCode
      })
    }

    return {
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: data.MerchantRequestID,
      responseCode: data.ResponseCode,
      responseDescription: data.ResponseDescription ?? 'STK push initiated',
      customerMessage: data.CustomerMessage
    }
  }

  private async getAccessToken() {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.token
    }

    const consumerKey = requireConfig('MPESA_CONSUMER_KEY', env.MPESA_CONSUMER_KEY)
    const consumerSecret = requireConfig('MPESA_CONSUMER_SECRET', env.MPESA_CONSUMER_SECRET)
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')
    const response = await this.fetchImpl(`${getDarajaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`
      }
    })

    const data = (await safeJson(response)) as DarajaTokenResponse
    if (!response.ok || !data.access_token) {
      throw new ApiError(502, 'mpesa_token_failed', data.error_description || data.error || 'Failed to authenticate with M-Pesa')
    }

    const expiresInSeconds = Number(data.expires_in ?? 3600)
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(expiresInSeconds - 60, 60) * 1000
    }
    return data.access_token
  }
}

export class LiveStripeProvider implements StripeProvider {
  private stripe?: Stripe

  async createCheckoutSession(input: StripeCheckoutInput): Promise<StripeCheckoutResult> {
    const stripe = this.getStripe()
    const planName = input.planType === 'yearly' ? '1 Year Pro Plan' : '1 Month Pro Plan'
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: input.email,
      line_items: [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            product_data: {
              name: `FahamPesa Pro - ${planName}`,
              description: input.planType === 'yearly' ? 'Annual subscription with 2 months free' : 'Monthly subscription'
            },
            unit_amount: Math.round(input.amount * 100)
          },
          quantity: 1
        }
      ],
      metadata: {
        subscriptionId: input.subscriptionId,
        businessAccountId: input.businessAccountId,
        userId: input.userId,
        planType: input.planType,
        amount: input.amount.toString(),
        currency: input.currency
      },
      success_url: input.successUrl ?? getStripeDefaultSuccessUrl(input),
      cancel_url: input.cancelUrl ?? getStripeDefaultCancelUrl(input)
    })

    return {
      sessionId: session.id,
      url: session.url
    }
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.getStripe().webhooks.constructEvent(rawBody, signature, requireConfig('STRIPE_WEBHOOK_SECRET', env.STRIPE_WEBHOOK_SECRET))
  }

  private getStripe() {
    if (!this.stripe) {
      this.stripe = new Stripe(requireConfig('STRIPE_SECRET_KEY', env.STRIPE_SECRET_KEY), {
        apiVersion: '2025-11-17.clover'
      })
    }
    return this.stripe
  }
}

export function normalizeKenyaPhoneNumber(phoneNumber: string) {
  const digits = phoneNumber.replace(/\D/g, '')
  let normalized = digits
  if (/^0[17]\d{8}$/.test(digits)) normalized = `254${digits.slice(1)}`
  else if (/^[17]\d{8}$/.test(digits)) normalized = `254${digits}`

  if (!/^254[17]\d{8}$/.test(normalized)) {
    throw new ApiError(422, 'invalid_mpesa_phone', 'M-Pesa phone number must be a valid Kenya Safaricom number')
  }

  return normalized
}

function getDarajaBaseUrl() {
  const environment = (readConfig('MPESA_ENVIRONMENT') ?? env.MPESA_ENVIRONMENT) as 'sandbox' | 'production'
  return environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
}

function getMpesaCallbackUrl() {
  const configured = readConfig('MPESA_CALLBACK_URL') ?? env.MPESA_CALLBACK_URL
  if (configured) return configured
  return new URL('/api/v1/webhooks/mpesa/callback', readConfig('APP_BASE_URL') ?? env.APP_BASE_URL).toString()
}

function getMpesaAccountReference(subscriptionId: string) {
  return `FP-${subscriptionId.slice(-8).toUpperCase()}`
}

function getMpesaTransactionDescription(planType: PlanType) {
  return planType === 'yearly' ? 'Yearly Plan' : 'Monthly Plan'
}

function getStripeDefaultSuccessUrl(input: StripeCheckoutInput) {
  const baseUrl = getFrontendBaseUrl()
  return new URL(`/dashboard/subscription/success?plan=${input.planType}&amount=${input.amount}&currency=${input.currency}&subscriptionId=${input.subscriptionId}&session_id={CHECKOUT_SESSION_ID}`, baseUrl).toString()
}

function getStripeDefaultCancelUrl(input: StripeCheckoutInput) {
  const baseUrl = getFrontendBaseUrl()
  return new URL(`/dashboard/subscription/checkout?plan=${input.planType}&currency=${input.currency}&cancelled=true`, baseUrl).toString()
}

function getFrontendBaseUrl() {
  return readConfig('NEXT_PUBLIC_BASE_URL') ?? env.NEXT_PUBLIC_BASE_URL ?? readConfig('APP_BASE_URL') ?? env.APP_BASE_URL
}

function requireConfig(key: string, parsedValue?: string) {
  const value = readConfig(key) ?? parsedValue
  if (!value) throw new ApiError(503, 'payment_provider_not_configured', `${key} is not configured`)
  return value
}

function readConfig(key: string) {
  const value = process.env[key]
  return value && value.trim() ? value.trim() : undefined
}

function formatDarajaTimestamp(date: Date) {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  ]
  return `${parts[0]}${parts.slice(1).map((part) => String(part).padStart(2, '0')).join('')}`
}

async function safeJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}
