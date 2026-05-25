import type { Types } from 'mongoose'
import { BusinessAccountModel } from '../models/business-account.model.js'
import { PaymentEventModel } from '../models/payment-event.model.js'
import { SubscriptionModel } from '../models/subscription.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { withTransaction } from '../config/database.js'
import { PlaceholderMpesaProvider, PlaceholderStripeProvider } from './billing-provider.service.js'
import type { PlanType } from '../validators/billing.validator.js'

const PLAN_PRICES = {
  monthly: {
    KENYA: { amount: 2000, currency: 'KSH' as const },
    OTHER: { amount: 10, currency: 'USD' as const }
  },
  yearly: {
    KENYA: { amount: 20000, currency: 'KSH' as const },
    OTHER: { amount: 100, currency: 'USD' as const }
  }
}

const mpesaProvider = new PlaceholderMpesaProvider()
const stripeProvider = new PlaceholderStripeProvider()

export function getPlans() {
  return {
    monthly: {
      kenya: PLAN_PRICES.monthly.KENYA,
      other: PLAN_PRICES.monthly.OTHER
    },
    yearly: {
      kenya: PLAN_PRICES.yearly.KENYA,
      other: PLAN_PRICES.yearly.OTHER
    }
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

export async function startMpesaCheckout(context: RequestContext, input: { planType: PlanType; phoneNumber: string }) {
  requireOwner(context)
  const account = await BusinessAccountModel.findById(context.businessAccountId)
  if (!account) throw notFound('Business account not found')
  if (account.billingRegion !== 'KENYA') throw new ApiError(422, 'mpesa_not_available', 'M-Pesa checkout is only available for Kenya accounts')

  const price = PLAN_PRICES[input.planType].KENYA
  const providerResult = await mpesaProvider.createStkPush({
    businessAccountId: account._id.toString(),
    planType: input.planType,
    amount: price.amount,
    phoneNumber: input.phoneNumber
  })

  const subscription = await SubscriptionModel.create({
    businessAccountId: account._id,
    userId: context.userId,
    provider: 'mpesa',
    planType: input.planType,
    status: 'pending',
    amount: price.amount,
    currency: price.currency,
    checkoutRequestId: providerResult.checkoutRequestId,
    phoneNumber: input.phoneNumber
  })

  await BusinessAccountModel.updateOne({ _id: account._id }, { $set: { subscriptionStatus: 'pending' } })

  return {
    provider: 'mpesa',
    subscription: serializeSubscription(subscription),
    checkout: providerResult
  }
}

export async function startStripeCheckout(context: RequestContext, input: { planType: PlanType; successUrl?: string; cancelUrl?: string }) {
  requireOwner(context)
  const account = await BusinessAccountModel.findById(context.businessAccountId)
  if (!account) throw notFound('Business account not found')
  if (account.billingRegion === 'KENYA') throw new ApiError(422, 'stripe_not_available', 'Stripe checkout is only available for non-Kenya accounts')

  const price = PLAN_PRICES[input.planType].OTHER
  const providerResult = await stripeProvider.createCheckoutSession({
    businessAccountId: account._id.toString(),
    planType: input.planType,
    amount: price.amount,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl
  })

  const subscription = await SubscriptionModel.create({
    businessAccountId: account._id,
    userId: context.userId,
    provider: 'stripe',
    planType: input.planType,
    status: 'pending',
    amount: price.amount,
    currency: price.currency,
    stripeCheckoutSessionId: providerResult.sessionId
  })

  await BusinessAccountModel.updateOne({ _id: account._id }, { $set: { subscriptionStatus: 'pending' } })

  return {
    provider: 'stripe',
    subscription: serializeSubscription(subscription),
    checkout: providerResult
  }
}

export async function getSubscriptionReceipt(context: RequestContext, subscriptionId: Types.ObjectId) {
  requireBusinessContext(context)
  const subscription = await SubscriptionModel.findOne({ _id: subscriptionId, businessAccountId: context.businessAccountId })
  if (!subscription) throw notFound('Subscription not found')
  return toReceipt(subscription)
}

export async function processMpesaCallback(input: { eventId?: string; checkoutRequestId: string; resultCode: number; transactionId?: string }) {
  const eventId = input.eventId ?? `mpesa-${input.checkoutRequestId}-${input.resultCode}`
  const existing = await PaymentEventModel.findOne({ provider: 'mpesa', eventId })
  if (existing?.processingStatus === 'processed') return serializePaymentEvent(existing)

  const subscription = await SubscriptionModel.findOne({ checkoutRequestId: input.checkoutRequestId, provider: 'mpesa' })
  const event = existing ?? (await PaymentEventModel.create({ provider: 'mpesa', eventId, eventType: 'mpesa.callback', rawPayload: input, subscriptionId: subscription?._id, businessAccountId: subscription?.businessAccountId }))

  if (!subscription) {
    event.processingStatus = 'failed'
    event.errorMessage = 'Pending subscription not found'
    event.processedAt = new Date()
    await event.save()
    return serializePaymentEvent(event)
  }

  if (input.resultCode === 0) {
    await activateSubscription(subscription._id, input.transactionId ?? eventId)
    event.processingStatus = 'processed'
  } else {
    subscription.status = 'failed'
    await subscription.save()
    await BusinessAccountModel.updateOne({ _id: subscription.businessAccountId }, { $set: { subscriptionStatus: 'failed' } })
    event.processingStatus = 'failed'
    event.errorMessage = `M-Pesa result code ${input.resultCode}`
  }

  event.subscriptionId = subscription._id
  event.businessAccountId = subscription.businessAccountId
  event.processedAt = new Date()
  await event.save()
  return serializePaymentEvent(event)
}

export async function processStripeWebhook(input: { id: string; type: string; data: { object: { id: string; payment_intent?: string } } }) {
  const existing = await PaymentEventModel.findOne({ provider: 'stripe', eventId: input.id })
  if (existing?.processingStatus === 'processed') return serializePaymentEvent(existing)

  const sessionId = input.data.object.id
  const subscription = await SubscriptionModel.findOne({ stripeCheckoutSessionId: sessionId, provider: 'stripe' })
  const event = existing ?? (await PaymentEventModel.create({ provider: 'stripe', eventId: input.id, eventType: input.type, rawPayload: input, subscriptionId: subscription?._id, businessAccountId: subscription?.businessAccountId }))

  if (input.type !== 'checkout.session.completed') {
    event.processingStatus = 'ignored'
  } else if (!subscription) {
    event.processingStatus = 'failed'
    event.errorMessage = 'Pending subscription not found'
  } else {
    await activateSubscription(subscription._id, input.data.object.payment_intent ?? input.id)
    event.subscriptionId = subscription._id
    event.businessAccountId = subscription.businessAccountId
    event.processingStatus = 'processed'
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

    const startDate = new Date()
    const endDate = addPlanDuration(startDate, subscription.planType)
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
