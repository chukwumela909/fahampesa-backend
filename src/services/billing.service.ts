import { Types } from 'mongoose'
import type Stripe from 'stripe'
import { BusinessAccountModel } from '../models/business-account.model.js'
import { PaymentEventModel } from '../models/payment-event.model.js'
import { SubscriptionModel } from '../models/subscription.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { withTransaction } from '../config/database.js'
import { writeAuditLog } from './audit.service.js'
import {
  DarajaMpesaProvider,
  LiveStripeProvider,
  normalizeKenyaPhoneNumber,
  type MpesaProvider,
  type StripeProvider
} from './billing-provider.service.js'
import type { MpesaCallbackInput, PlanType } from '../validators/billing.validator.js'

const PLAN_PRICES = {
  monthly: {
    KENYA: { amount: 2000, currency: 'KSH' as const },
    // TEST: reduced to Stripe's USD minimum ($0.50) to verify card payments end-to-end.
    // Revert to `amount: 10` before production.
    OTHER: { amount: 0.5, currency: 'USD' as const }
  },
  yearly: {
    KENYA: { amount: 20000, currency: 'KSH' as const },
    // TEST: reduced to Stripe's USD minimum ($0.50) to verify card payments end-to-end.
    // Revert to `amount: 100` before production.
    OTHER: { amount: 0.5, currency: 'USD' as const }
  }
}

let mpesaProvider: MpesaProvider = new DarajaMpesaProvider()
let stripeProvider: StripeProvider = new LiveStripeProvider()

export function setBillingProvidersForTest(providers: { mpesa?: MpesaProvider; stripe?: StripeProvider }) {
  const previous = { mpesa: mpesaProvider, stripe: stripeProvider }
  if (providers.mpesa) mpesaProvider = providers.mpesa
  if (providers.stripe) stripeProvider = providers.stripe
  return () => {
    mpesaProvider = previous.mpesa
    stripeProvider = previous.stripe
  }
}

// Plans are priced and gated on the user's CURRENT location (IP-detected on the
// client), so the "Get Pro" screen only ever shows one currency and one provider.
// Kenya → KSH via M-Pesa; everywhere else (and unknown location) → USD via card.
export function getPlans(country?: string | null) {
  const region = regionForCountry(country)
  return {
    region,
    currency: PLAN_PRICES.monthly[region].currency,
    provider: providerForRegion(region),
    monthly: PLAN_PRICES.monthly[region],
    yearly: PLAN_PRICES.yearly[region]
  }
}

export async function getCurrentSubscription(context: RequestContext) {
  requireBusinessContext(context)
  const subscription = await SubscriptionModel.findOne({ businessAccountId: context.businessAccountId }).sort({ createdAt: -1 })
  return {
    account: {
      planTier: context.planTier,
      subscriptionStatus: context.subscriptionStatus,
      subscriptionEndsAt: context.subscriptionEndsAt?.toISOString() ?? null,
      billingRegion: await getBillingRegion(context.businessAccountId!)
    },
    subscription: subscription ? serializeSubscription(subscription) : null
  }
}

export async function getBillingHistory(context: RequestContext) {
  requireBusinessContext(context)
  const subscriptions = await SubscriptionModel.find({ businessAccountId: context.businessAccountId }).sort({ createdAt: -1 })
  return subscriptions.map(serializeSubscription)
}

export async function activateMonthlySubscription(context: RequestContext, requestMeta?: { ipAddress?: string; userAgent?: string }) {
  requireOwner(context)
  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const account = await BusinessAccountModel.findById(context.businessAccountId).session(activeSession ?? null)
    if (!account) throw notFound('Business account not found')

    const startDate = new Date()
    const baseDate = hasActivePaidAccess(account) && account.subscriptionEndsAt ? account.subscriptionEndsAt : startDate
    const endDate = addPlanDuration(baseDate, 'monthly')
    const subscriptionId = new Types.ObjectId()
    const [subscription] = await SubscriptionModel.create(
      [
        {
          _id: subscriptionId,
          businessAccountId: account._id,
          userId: context.userId,
          provider: 'manual',
          planType: 'monthly',
          status: 'active',
          amount: 0,
          currency: currencyForAccount(account.currency),
          transactionId: `AUTO-${Date.now()}`,
          startDate,
          endDate,
          receiptNumber: `AUTO-${subscriptionId.toString().slice(-8).toUpperCase()}`
        }
      ],
      activeSession ? { session: activeSession } : {}
    )

    account.planTier = 'paid'
    account.planType = 'monthly'
    account.subscriptionStatus = 'active'
    account.subscriptionStartsAt = startDate
    account.subscriptionEndsAt = endDate
    await account.save(activeSession ? { session: activeSession } : undefined)

    await writeAuditLog(
      {
        scope: 'business',
        businessAccountId: account._id,
        actorUserId: context.userId,
        actorRole: context.role,
        action: 'business.subscription_auto_activated',
        targetType: 'subscription',
        targetId: subscription._id,
        metadata: { planType: 'monthly', endDate },
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent
      },
      activeSession
    )

    return {
      account: normalizeMongo(account.toObject({ versionKey: false })),
      subscription: serializeSubscription(subscription)
    }
  })
}

export async function startMpesaCheckout(context: RequestContext, input: { planType: PlanType; phoneNumber: string; country?: string }) {
  requireOwner(context)
  const account = await BusinessAccountModel.findById(context.businessAccountId)
  if (!account) throw notFound('Business account not found')
  // Provider is gated on the user's CURRENT location (IP-detected on the client),
  // not the onboarding region — M-Pesa is only available while in Kenya.
  if (regionForCountry(input.country) !== 'KENYA') throw new ApiError(422, 'mpesa_not_available', 'M-Pesa is only available when you are in Kenya')

  const price = PLAN_PRICES[input.planType].KENYA
  const normalizedPhoneNumber = normalizeKenyaPhoneNumber(input.phoneNumber)
  const subscription = await SubscriptionModel.create({
    businessAccountId: account._id,
    userId: context.userId,
    provider: 'mpesa',
    planType: input.planType,
    status: 'pending',
    amount: price.amount,
    currency: price.currency,
    phoneNumber: normalizedPhoneNumber
  })

  let providerResult
  try {
    providerResult = await mpesaProvider.createStkPush({
      businessAccountId: account._id.toString(),
      subscriptionId: subscription._id.toString(),
      planType: input.planType,
      amount: price.amount,
      phoneNumber: normalizedPhoneNumber
    })
  } catch (error) {
    subscription.status = 'failed'
    await subscription.save()
    await markAccountFailedIfNoActiveAccess(account._id)
    throw error
  }

  subscription.checkoutRequestId = providerResult.checkoutRequestId
  subscription.merchantRequestId = providerResult.merchantRequestId
  await subscription.save()
  await markAccountPendingIfNoActiveAccess(account)

  return {
    provider: 'mpesa',
    subscription: serializeSubscription(subscription),
    checkout: providerResult
  }
}

export async function startStripeCheckout(context: RequestContext, input: { planType: PlanType; successUrl?: string; cancelUrl?: string; country?: string }) {
  requireOwner(context)
  const account = await BusinessAccountModel.findById(context.businessAccountId)
  if (!account) throw notFound('Business account not found')
  // Users currently in Kenya pay via M-Pesa, not card. Gate on current location.
  if (regionForCountry(input.country) === 'KENYA') throw new ApiError(422, 'stripe_not_available', 'Card checkout is not available while you are in Kenya — use M-Pesa')

  const price = PLAN_PRICES[input.planType].OTHER
  const subscription = await SubscriptionModel.create({
    businessAccountId: account._id,
    userId: context.userId,
    provider: 'stripe',
    planType: input.planType,
    status: 'pending',
    amount: price.amount,
    currency: price.currency
  })

  let providerResult
  try {
    providerResult = await stripeProvider.createCheckoutSession({
      businessAccountId: account._id.toString(),
      subscriptionId: subscription._id.toString(),
      userId: context.userId.toString(),
      email: context.auth.email,
      planType: input.planType,
      amount: price.amount,
      currency: price.currency,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl
    })
  } catch (error) {
    subscription.status = 'failed'
    await subscription.save()
    await markAccountFailedIfNoActiveAccess(account._id)
    throw error
  }

  subscription.stripeCheckoutSessionId = providerResult.sessionId
  await subscription.save()
  await markAccountPendingIfNoActiveAccess(account)

  return {
    provider: 'stripe',
    subscription: serializeSubscription(subscription),
    checkout: providerResult
  }
}

export async function getCheckoutStatus(context: RequestContext, subscriptionId: Types.ObjectId) {
  requireBusinessContext(context)
  const subscription = await SubscriptionModel.findOne({ _id: subscriptionId, businessAccountId: context.businessAccountId })
  if (!subscription) throw notFound('Subscription not found')

  return {
    subscriptionId: subscription._id.toString(),
    status: subscription.status,
    transactionId: subscription.transactionId ?? null,
    planType: subscription.planType,
    amount: subscription.amount,
    currency: subscription.currency
  }
}

export async function getSubscriptionReceipt(context: RequestContext, subscriptionId: Types.ObjectId) {
  requireBusinessContext(context)
  const subscription = await SubscriptionModel.findOne({ _id: subscriptionId, businessAccountId: context.businessAccountId })
  if (!subscription) throw notFound('Subscription not found')
  return toReceipt(subscription)
}

export async function processMpesaCallback(input: MpesaCallbackInput) {
  const eventId = input.eventId ?? `mpesa-${input.checkoutRequestId}`
  const existing = await PaymentEventModel.findOne({ provider: 'mpesa', eventId })
  if (existing && existing.processingStatus !== 'received') return serializePaymentEvent(existing)

  const subscription = await SubscriptionModel.findOne({ checkoutRequestId: input.checkoutRequestId, provider: 'mpesa' })
  const event = existing ?? (await PaymentEventModel.create({
    provider: 'mpesa',
    eventId,
    eventType: 'mpesa.callback',
    rawPayload: input.rawPayload ?? input,
    subscriptionId: subscription?._id,
    businessAccountId: subscription?.businessAccountId
  }))

  if (!subscription) {
    event.processingStatus = 'failed'
    event.errorMessage = 'Pending subscription not found'
    event.processedAt = new Date()
    await event.save()
    return serializePaymentEvent(event)
  }

  if (input.resultCode === 0) {
    await activateSubscription(subscription._id, input.transactionId ?? `MPESA-${input.checkoutRequestId}`)
    event.processingStatus = 'processed'
  } else {
    subscription.status = 'failed'
    await subscription.save()
    await markAccountFailedIfNoActiveAccess(subscription.businessAccountId)
    event.processingStatus = 'failed'
    event.errorMessage = input.resultDesc ?? `M-Pesa result code ${input.resultCode}`
  }

  event.subscriptionId = subscription._id
  event.businessAccountId = subscription.businessAccountId
  event.processedAt = new Date()
  await event.save()
  return serializePaymentEvent(event)
}

export async function processStripeWebhookRaw(rawBody: Buffer, signature?: string) {
  if (!signature) throw new ApiError(400, 'missing_stripe_signature', 'Missing stripe-signature header')

  let event: Stripe.Event
  try {
    event = stripeProvider.constructWebhookEvent(rawBody, signature)
  } catch {
    throw new ApiError(400, 'invalid_stripe_signature', 'Webhook signature verification failed')
  }

  return processStripeWebhook(event)
}

export async function processStripeWebhook(input: Stripe.Event) {
  const existing = await PaymentEventModel.findOne({ provider: 'stripe', eventId: input.id })
  if (existing && existing.processingStatus !== 'received') return serializePaymentEvent(existing)

  const event = existing ?? (await PaymentEventModel.create({ provider: 'stripe', eventId: input.id, eventType: input.type, rawPayload: input }))

  if (input.type === 'checkout.session.completed') {
    const session = input.data.object as Stripe.Checkout.Session
    const subscription = await findStripeSubscription(session)
    if (!subscription) {
      event.processingStatus = 'failed'
      event.errorMessage = 'Pending subscription not found'
    } else {
      await activateSubscription(subscription._id, getStripeTransactionId(session))
      event.subscriptionId = subscription._id
      event.businessAccountId = subscription.businessAccountId
      event.processingStatus = 'processed'
    }
  } else if (input.type === 'checkout.session.expired') {
    const session = input.data.object as Stripe.Checkout.Session
    const subscription = await findStripeSubscription(session)
    if (!subscription) {
      event.processingStatus = 'failed'
      event.errorMessage = 'Pending subscription not found'
    } else {
      subscription.status = 'failed'
      await subscription.save()
      await markAccountFailedIfNoActiveAccess(subscription.businessAccountId)
      event.subscriptionId = subscription._id
      event.businessAccountId = subscription.businessAccountId
      event.processingStatus = 'processed'
      event.errorMessage = 'Stripe checkout session expired'
    }
  } else {
    event.processingStatus = 'ignored'
  }

  event.processedAt = new Date()
  await event.save()
  return serializePaymentEvent(event)
}

async function activateSubscription(subscriptionId: Types.ObjectId, transactionId: string) {
  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const subscription = await SubscriptionModel.findById(subscriptionId).session(activeSession ?? null)
    if (!subscription) throw notFound('Subscription not found')
    if (subscription.status === 'active') return subscription

    const account = await BusinessAccountModel.findById(subscription.businessAccountId).session(activeSession ?? null)
    if (!account) throw notFound('Business account not found')

    const startDate = new Date()
    const baseDate = hasActivePaidAccess(account) && account.subscriptionEndsAt ? account.subscriptionEndsAt : startDate
    const endDate = addPlanDuration(baseDate, subscription.planType)
    subscription.status = 'active'
    subscription.transactionId = transactionId
    subscription.startDate = startDate
    subscription.endDate = endDate
    subscription.receiptNumber = `RCPT-${subscription._id.toString().slice(-8).toUpperCase()}`
    await subscription.save(activeSession ? { session: activeSession } : undefined)

    await BusinessAccountModel.updateOne(
      { _id: subscription.businessAccountId },
      {
        $set: {
          planTier: 'paid',
          planType: subscription.planType,
          subscriptionStatus: 'active',
          subscriptionStartsAt: startDate,
          subscriptionEndsAt: endDate
        }
      },
      activeSession ? { session: activeSession } : {}
    )

    return subscription
  })
}

function addPlanDuration(startDate: Date, planType: PlanType) {
  const endDate = new Date(startDate)
  if (planType === 'monthly') endDate.setMonth(endDate.getMonth() + 1)
  else endDate.setFullYear(endDate.getFullYear() + 1)
  return endDate
}

async function findStripeSubscription(session: Stripe.Checkout.Session) {
  const subscriptionId = session.metadata?.subscriptionId
  if (subscriptionId && Types.ObjectId.isValid(subscriptionId)) {
    const subscription = await SubscriptionModel.findOne({ _id: subscriptionId, provider: 'stripe' })
    if (subscription) return subscription
  }
  return SubscriptionModel.findOne({ stripeCheckoutSessionId: session.id, provider: 'stripe' })
}

function getStripeTransactionId(session: Stripe.Checkout.Session) {
  const paymentIntent = session.payment_intent
  const paymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id
  return `STRIPE-${paymentIntentId ?? session.id}`
}

function currencyForAccount(currency?: string | null) {
  return currency === 'KES' || currency === 'KSH' ? 'KSH' : 'USD'
}

/** Normalize a client-supplied country to an ISO alpha-2 code, or '' when unknown. */
function normalizeCountry(value?: string | null) {
  const code = (value ?? '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : ''
}

/**
 * Resolve the billing region from the user's CURRENT location (IP-detected on the
 * client). Kenya pays in KSH via M-Pesa; everywhere else pays in USD via card.
 * An unknown/unresolvable location falls back to OTHER (USD).
 */
function regionForCountry(country?: string | null): 'KENYA' | 'OTHER' {
  return normalizeCountry(country) === 'KE' ? 'KENYA' : 'OTHER'
}

/** The only payment provider offered in each region. M-Pesa is Kenya-only. */
function providerForRegion(region: 'KENYA' | 'OTHER') {
  return region === 'KENYA' ? 'mpesa' : 'stripe'
}

async function markAccountPendingIfNoActiveAccess(account: { _id: Types.ObjectId; planTier?: string | null; subscriptionStatus?: string | null; subscriptionEndsAt?: Date | null }) {
  if (hasActivePaidAccess(account)) return
  await BusinessAccountModel.updateOne({ _id: account._id }, { $set: { subscriptionStatus: 'pending' } })
}

async function markAccountFailedIfNoActiveAccess(businessAccountId: Types.ObjectId) {
  const account = await BusinessAccountModel.findById(businessAccountId).select('planTier subscriptionStatus subscriptionEndsAt')
  if (!account || hasActivePaidAccess(account)) return
  await BusinessAccountModel.updateOne({ _id: businessAccountId }, { $set: { subscriptionStatus: 'failed' } })
}

function hasActivePaidAccess(account: { planTier?: string | null; subscriptionStatus?: string | null; subscriptionEndsAt?: Date | null }) {
  return account.planTier === 'paid' && account.subscriptionStatus === 'active' && !!account.subscriptionEndsAt && account.subscriptionEndsAt.getTime() > Date.now()
}

async function getBillingRegion(businessAccountId: Types.ObjectId) {
  const account = await BusinessAccountModel.findById(businessAccountId).select('billingRegion')
  return account?.billingRegion ?? null
}

function toReceipt(subscription: { toObject(options?: unknown): unknown }) {
  const value = serializeSubscription(subscription)
  return {
    receiptNumber: value.receiptNumber,
    subscriptionId: value.id,
    provider: value.provider,
    planType: value.planType,
    amount: value.amount,
    currency: value.currency,
    transactionId: value.transactionId,
    startDate: value.startDate,
    endDate: value.endDate,
    status: value.status
  }
}

function serializeSubscription(subscription: { toObject(options?: unknown): unknown }) {
  return normalizeMongo(subscription.toObject({ versionKey: false })) as Record<string, unknown>
}

function serializePaymentEvent(event: { toObject(options?: unknown): unknown }) {
  return normalizeMongo(event.toObject({ versionKey: false })) as Record<string, unknown>
}

function requireBusinessContext(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
}

function requireOwner(context: RequestContext) {
  requireBusinessContext(context)
  if (context.role !== 'owner') throw new ApiError(403, 'owner_required', 'Only owners can manage subscriptions')
}
