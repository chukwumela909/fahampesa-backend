import path from 'node:path'
import mongoose from 'mongoose'
import request from 'supertest'
import Stripe from 'stripe'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../src/app.js'
import type { AuthUser } from '../src/types/http.js'
import type { FirebaseTokenVerifier } from '../src/config/firebase.js'
import { BusinessAccountModel } from '../src/models/business-account.model.js'
import { PaymentEventModel } from '../src/models/payment-event.model.js'
import { SubscriptionModel } from '../src/models/subscription.model.js'
import { setBillingProvidersForTest } from '../src/services/billing.service.js'
import type { MpesaProvider, MpesaStkPushInput, StripeCheckoutInput, StripeProvider } from '../src/services/billing-provider.service.js'

class FakeVerifier implements FirebaseTokenVerifier {
  constructor(private readonly users: Record<string, AuthUser>) {}

  async verifyIdToken(token: string): Promise<AuthUser> {
    const user = this.users[token]
    if (!user) throw new Error('invalid token')
    return { ...user, authTime: new Date() }
  }
}

class FakeMpesaProvider implements MpesaProvider {
  calls: MpesaStkPushInput[] = []

  async createStkPush(input: MpesaStkPushInput) {
    this.calls.push(input)
    const suffix = String(this.calls.length).padStart(3, '0')
    return {
      checkoutRequestId: `ws_CO_${suffix}`,
      merchantRequestId: `mr_${suffix}`,
      responseCode: '0',
      responseDescription: 'Success. Request accepted for processing',
      customerMessage: 'Success. Request accepted for processing'
    }
  }

  reset() {
    this.calls = []
  }
}

class FakeStripeProvider implements StripeProvider {
  calls: Array<StripeCheckoutInput & { sessionId: string }> = []
  private readonly stripe = new Stripe('sk_test_fake', { apiVersion: '2025-11-17.clover' })

  async createCheckoutSession(input: StripeCheckoutInput) {
    const sessionId = `cs_test_${String(this.calls.length + 1).padStart(3, '0')}`
    this.calls.push({ ...input, sessionId })
    return {
      sessionId,
      url: `https://checkout.stripe.test/${sessionId}`
    }
  }

  constructWebhookEvent(rawBody: Buffer, signature: string) {
    return this.stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)
  }

  sign(payload: object) {
    const body = JSON.stringify(payload)
    return {
      body,
      signature: this.stripe.webhooks.generateTestHeaderString({ payload: body, secret: STRIPE_WEBHOOK_SECRET })
    }
  }

  reset() {
    this.calls = []
  }
}

const fakeUsers: Record<string, AuthUser> = {
  owner: { firebaseUid: 'owner_uid', email: 'owner@example.com', name: 'Owner User' },
  ownerOther: { firebaseUid: 'owner_other_uid', email: 'owner.other@example.com', name: 'Owner Other' }
}

const STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
const fakeMpesaProvider = new FakeMpesaProvider()
const fakeStripeProvider = new FakeStripeProvider()
const app = createApp({ tokenVerifier: new FakeVerifier(fakeUsers) })
let replSet: MongoMemoryReplSet
let restoreProviders: () => void

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.MONGOMS_DOWNLOAD_DIR = path.join(process.cwd(), '.cache', 'mongodb-binaries')
  restoreProviders = setBillingProvidersForTest({ mpesa: fakeMpesaProvider, stripe: fakeStripeProvider })
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  await mongoose.connect(replSet.getUri())
})

afterEach(async () => {
  fakeMpesaProvider.reset()
  fakeStripeProvider.reset()
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})))
})

afterAll(async () => {
  restoreProviders?.()
  await mongoose.disconnect()
  await replSet?.stop()
})

describe('Phase 8 production subscription billing', () => {
  it('creates Kenya M-Pesa checkout, activates from real callback shape, and extends active renewals', async () => {
    await onboardOwner('owner', 'Kenya')

    const checkout = await request(app)
      .post('/api/v1/billing/mpesa/stk-push')
      .set('Authorization', 'Bearer owner')
      .send({ planType: 'monthly', phoneNumber: '+254 712 345 678', amount: 1 })
    expect(checkout.status).toBe(201)
    expect(checkout.body.data.provider).toBe('mpesa')
    expect(checkout.body.data.subscription.currency).toBe('KSH')
    expect(checkout.body.data.subscription.amount).toBe(2000)
    expect(checkout.body.data.subscription.checkoutRequestId).toBe('ws_CO_001')
    expect(fakeMpesaProvider.calls[0].amount).toBe(2000)
    expect(fakeMpesaProvider.calls[0].phoneNumber).toBe('254712345678')

    const callbackBody = mpesaCallbackBody({
      checkoutRequestId: checkout.body.data.subscription.checkoutRequestId,
      merchantRequestId: checkout.body.data.subscription.merchantRequestId,
      receipt: 'MPESA-TXN-1'
    })
    const callback = await request(app).post('/api/v1/webhooks/mpesa/callback').send(callbackBody)
    expect(callback.status).toBe(200)
    expect(callback.body.data.processingStatus).toBe('processed')

    const duplicate = await request(app).post('/api/mpesa/callback').send(callbackBody)
    expect(duplicate.status).toBe(200)
    expect(await PaymentEventModel.countDocuments({ provider: 'mpesa', eventId: 'mpesa-ws_CO_001' })).toBe(1)

    const accountAfterFirstPayment = await BusinessAccountModel.findOne({}).orFail()
    expect(accountAfterFirstPayment.planTier).toBe('paid')
    expect(accountAfterFirstPayment.subscriptionStatus).toBe('active')
    expect(accountAfterFirstPayment.subscriptionEndsAt).toBeTruthy()
    const firstEndDate = accountAfterFirstPayment.subscriptionEndsAt!

    const status = await request(app)
      .get(`/api/v1/billing/checkout-status/${checkout.body.data.subscription.id}`)
      .set('Authorization', 'Bearer owner')
    expect(status.status).toBe(200)
    expect(status.body.data.status).toBe('active')
    expect(status.body.data.transactionId).toBe('MPESA-TXN-1')

    const renewal = await request(app)
      .post('/api/v1/billing/mpesa/stk-push')
      .set('Authorization', 'Bearer owner')
      .send({ planType: 'monthly', phoneNumber: '0712345678' })
    expect(renewal.status).toBe(201)
    const accountWhileRenewalPending = await BusinessAccountModel.findOne({}).orFail()
    expect(accountWhileRenewalPending.subscriptionStatus).toBe('active')

    await request(app).post('/api/v1/webhooks/mpesa/callback').send(mpesaCallbackBody({
      checkoutRequestId: renewal.body.data.subscription.checkoutRequestId,
      merchantRequestId: renewal.body.data.subscription.merchantRequestId,
      receipt: 'MPESA-TXN-2'
    }))

    const renewedAccount = await BusinessAccountModel.findOne({}).orFail()
    expect(renewedAccount.subscriptionEndsAt!.getTime()).toBeGreaterThan(firstEndDate.getTime())
  })

  it('logs failed and unknown M-Pesa callbacks without revoking an active subscription', async () => {
    await onboardOwner('owner', 'Kenya')
    const activeCheckout = await request(app)
      .post('/api/v1/billing/mpesa/stk-push')
      .set('Authorization', 'Bearer owner')
      .send({ planType: 'monthly', phoneNumber: '+254712345678' })
    await request(app).post('/api/v1/webhooks/mpesa/callback').send(mpesaCallbackBody({
      checkoutRequestId: activeCheckout.body.data.subscription.checkoutRequestId,
      merchantRequestId: activeCheckout.body.data.subscription.merchantRequestId,
      receipt: 'MPESA-ACTIVE'
    }))

    const failedRenewal = await request(app)
      .post('/api/v1/billing/mpesa/stk-push')
      .set('Authorization', 'Bearer owner')
      .send({ planType: 'monthly', phoneNumber: '+254712345678' })
    const failedCallback = await request(app).post('/api/v1/webhooks/mpesa/callback').send(mpesaCallbackBody({
      checkoutRequestId: failedRenewal.body.data.subscription.checkoutRequestId,
      merchantRequestId: failedRenewal.body.data.subscription.merchantRequestId,
      resultCode: 1032,
      resultDesc: 'Request cancelled by user'
    }))
    expect(failedCallback.status).toBe(200)
    expect(failedCallback.body.data.processingStatus).toBe('failed')

    const account = await BusinessAccountModel.findOne({}).orFail()
    expect(account.subscriptionStatus).toBe('active')

    const unknown = await request(app).post('/api/v1/webhooks/mpesa/callback').send(mpesaCallbackBody({
      checkoutRequestId: 'unknown-checkout',
      merchantRequestId: 'unknown-merchant',
      receipt: 'MPESA-UNKNOWN'
    }))
    expect(unknown.status).toBe(200)
    expect(unknown.body.data.processingStatus).toBe('failed')
    expect(unknown.body.data.errorMessage).toBe('Pending subscription not found')
  })

  it('activates M-Pesa callbacks without receipt metadata using a fallback transaction id', async () => {
    await onboardOwner('owner', 'Kenya')
    const checkout = await request(app)
      .post('/api/v1/billing/mpesa/stk-push')
      .set('Authorization', 'Bearer owner')
      .send({ planType: 'monthly', phoneNumber: '+254712345678' })

    const callback = await request(app).post('/api/v1/webhooks/mpesa/callback').send(mpesaCallbackBody({
      checkoutRequestId: checkout.body.data.subscription.checkoutRequestId,
      merchantRequestId: checkout.body.data.subscription.merchantRequestId,
      includeMetadata: false
    }))
    expect(callback.status).toBe(200)

    const subscription = await SubscriptionModel.findById(checkout.body.data.subscription.id).orFail()
    expect(subscription.status).toBe('active')
    expect(subscription.transactionId).toBe(`MPESA-${checkout.body.data.subscription.checkoutRequestId}`)
  })

  it('creates Stripe checkout, verifies signed webhooks, expires sessions, and ignores unrelated events', async () => {
    await onboardOwner('ownerOther', 'Uganda')

    const mpesa = await request(app)
      .post('/api/v1/billing/mpesa/stk-push')
      .set('Authorization', 'Bearer ownerOther')
      .send({ planType: 'monthly', phoneNumber: '+256700000000' })
    expect(mpesa.status).toBe(422)
    expect(mpesa.body.error.code).toBe('mpesa_not_available')

    const checkout = await request(app)
      .post('/api/v1/billing/stripe/checkout-session')
      .set('Authorization', 'Bearer ownerOther')
      .send({ planType: 'yearly', amount: 1, successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel' })
    expect(checkout.status).toBe(201)
    expect(checkout.body.data.provider).toBe('stripe')
    expect(checkout.body.data.subscription.currency).toBe('USD')
    expect(checkout.body.data.subscription.amount).toBe(100)
    expect(checkout.body.data.checkout.url).toBe('https://checkout.stripe.test/cs_test_001')
    expect(fakeStripeProvider.calls[0].amount).toBe(100)
    expect(fakeStripeProvider.calls[0].businessAccountId).toBeTruthy()
    expect(fakeStripeProvider.calls[0].subscriptionId).toBe(checkout.body.data.subscription.id)

    const completedPayload = stripeEvent('evt_checkout_completed', 'checkout.session.completed', {
      id: checkout.body.data.subscription.stripeCheckoutSessionId,
      payment_intent: 'pi_123',
      metadata: { subscriptionId: checkout.body.data.subscription.id }
    })
    const invalid = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'bad-signature')
      .send(JSON.stringify(completedPayload))
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('invalid_stripe_signature')

    const signedCompleted = fakeStripeProvider.sign(completedPayload)
    const webhook = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signedCompleted.signature)
      .send(signedCompleted.body)
    expect(webhook.status).toBe(200)
    expect(webhook.body.data.processingStatus).toBe('processed')

    const duplicate = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signedCompleted.signature)
      .send(signedCompleted.body)
    expect(duplicate.status).toBe(200)
    expect(await PaymentEventModel.countDocuments({ provider: 'stripe', eventId: 'evt_checkout_completed' })).toBe(1)

    const account = await BusinessAccountModel.findOne({}).orFail()
    expect(account.planTier).toBe('paid')
    expect(account.planType).toBe('yearly')
    expect(account.subscriptionStatus).toBe('active')

    const expiredCheckout = await request(app)
      .post('/api/v1/billing/stripe/checkout-session')
      .set('Authorization', 'Bearer ownerOther')
      .send({ planType: 'monthly' })
    const expiredPayload = stripeEvent('evt_checkout_expired', 'checkout.session.expired', {
      id: expiredCheckout.body.data.subscription.stripeCheckoutSessionId,
      metadata: { subscriptionId: expiredCheckout.body.data.subscription.id }
    })
    const signedExpired = fakeStripeProvider.sign(expiredPayload)
    const expired = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signedExpired.signature)
      .send(signedExpired.body)
    expect(expired.status).toBe(200)
    expect(expired.body.data.processingStatus).toBe('processed')
    expect((await BusinessAccountModel.findOne({}).orFail()).subscriptionStatus).toBe('active')

    const ignoredPayload = stripeEvent('evt_payment_failed', 'payment_intent.payment_failed', { id: 'pi_failed' })
    const signedIgnored = fakeStripeProvider.sign(ignoredPayload)
    const ignored = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signedIgnored.signature)
      .send(signedIgnored.body)
    expect(ignored.status).toBe(200)
    expect(ignored.body.data.processingStatus).toBe('ignored')
  })

  it('keeps business sales payment methods record-only', async () => {
    const onboarded = await onboardOwner('owner', 'Kenya')
    const branchId = onboarded.body.data.branch.id
    const product = await request(app)
      .post(`/api/v1/branches/${branchId}/products`)
      .set('Authorization', 'Bearer owner')
      .send({ name: 'Juice', sku: 'JUICE', inventory: { initialQuantity: 4, costPrice: 50, sellingPrice: 80 } })
    expect(product.status).toBe(201)

    const sale = await request(app)
      .post(`/api/v1/branches/${branchId}/sales`)
      .set('Authorization', 'Bearer owner')
      .send({ items: [{ productId: product.body.data.id, quantity: 1, unitPrice: 80 }], paymentMethod: 'mpesa' })
    expect(sale.status).toBe(201)
    expect(sale.body.data.paymentMethod).toBe('mpesa')
    expect(await SubscriptionModel.countDocuments()).toBe(0)
    expect(await PaymentEventModel.countDocuments()).toBe(0)
    expect(fakeMpesaProvider.calls).toHaveLength(0)
    expect(fakeStripeProvider.calls).toHaveLength(0)
  })
})

function onboardOwner(token: 'owner' | 'ownerOther', country: string) {
  return request(app)
    .post('/api/v1/onboarding/business')
    .set('Authorization', `Bearer ${token}`)
    .send({
      business: { businessName: `${country} Test Shop`, businessType: 'retail', country, currency: country === 'Kenya' ? 'KES' : 'USD' },
      branch: { name: 'Main Branch', location: { address: '123 Test Street', city: 'Nairobi' }, contact: { phone: '+254700000000' } }
    })
}

function mpesaCallbackBody(input: {
  checkoutRequestId: string
  merchantRequestId: string
  resultCode?: number
  resultDesc?: string
  receipt?: string
  includeMetadata?: boolean
}) {
  const resultCode = input.resultCode ?? 0
  const includeMetadata = input.includeMetadata ?? resultCode === 0
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: input.merchantRequestId,
        CheckoutRequestID: input.checkoutRequestId,
        ResultCode: resultCode,
        ResultDesc: input.resultDesc ?? (resultCode === 0 ? 'The service request is processed successfully.' : 'Payment failed'),
        ...(includeMetadata
          ? {
              CallbackMetadata: {
                Item: [
                  { Name: 'Amount', Value: 2000 },
                  { Name: 'MpesaReceiptNumber', Value: input.receipt ?? 'MPESA-TEST' },
                  { Name: 'TransactionDate', Value: '20260529120000' },
                  { Name: 'PhoneNumber', Value: 254712345678 }
                ]
              }
            }
          : {})
      }
    }
  }
}

function stripeEvent(id: string, type: string, object: Record<string, unknown>) {
  return {
    id,
    object: 'event',
    api_version: '2025-05-28.basil',
    created: Math.floor(Date.now() / 1000),
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type
  }
}
