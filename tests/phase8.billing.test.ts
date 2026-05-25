import path from 'node:path'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../src/app.js'
import type { AuthUser } from '../src/types/http.js'
import type { FirebaseTokenVerifier } from '../src/config/firebase.js'
import { BusinessAccountModel } from '../src/models/business-account.model.js'
import { PaymentEventModel } from '../src/models/payment-event.model.js'
import { SubscriptionModel } from '../src/models/subscription.model.js'

class FakeVerifier implements FirebaseTokenVerifier {
  constructor(private readonly users: Record<string, AuthUser>) {}

  async verifyIdToken(token: string): Promise<AuthUser> {
    const user = this.users[token]
    if (!user) throw new Error('invalid token')
    return { ...user, authTime: new Date() }
  }
}

const fakeUsers: Record<string, AuthUser> = {
  owner: { firebaseUid: 'owner_uid', email: 'owner@example.com', name: 'Owner User' },
  ownerOther: { firebaseUid: 'owner_other_uid', email: 'owner.other@example.com', name: 'Owner Other' }
}

const app = createApp({ tokenVerifier: new FakeVerifier(fakeUsers) })
let replSet: MongoMemoryReplSet

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.MONGOMS_DOWNLOAD_DIR = path.join(process.cwd(), '.cache', 'mongodb-binaries')
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  await mongoose.connect(replSet.getUri())
})

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})))
})

afterAll(async () => {
  await mongoose.disconnect()
  await replSet?.stop()
})

describe('Phase 8 subscription billing placeholders', () => {
  it('creates Kenya M-Pesa placeholder checkout and activates idempotently from callback', async () => {
    await onboardOwner('owner', 'Kenya')

    const plans = await request(app).get('/api/v1/billing/plans').set('Authorization', 'Bearer owner')
    expect(plans.status).toBe(200)
    expect(plans.body.data.monthly.kenya.amount).toBe(2000)

    const checkout = await request(app)
      .post('/api/v1/billing/mpesa/stk-push')
      .set('Authorization', 'Bearer owner')
      .send({ planType: 'monthly', phoneNumber: '+254700000000' })
    expect(checkout.status).toBe(201)
    expect(checkout.body.data.provider).toBe('mpesa')
    expect(checkout.body.data.subscription.currency).toBe('KSH')
    expect(checkout.body.data.checkout.checkoutRequestId).toContain('placeholder-mpesa')

    const callbackBody = {
      eventId: 'mpesa-event-1',
      checkoutRequestId: checkout.body.data.subscription.checkoutRequestId,
      resultCode: 0,
      transactionId: 'MPESA-TXN-1'
    }
    const callback = await request(app).post('/api/v1/webhooks/mpesa/callback').send(callbackBody)
    expect(callback.status).toBe(200)
    expect(callback.body.data.processingStatus).toBe('processed')

    const duplicate = await request(app).post('/api/v1/webhooks/mpesa/callback').send(callbackBody)
    expect(duplicate.status).toBe(200)
    expect(await PaymentEventModel.countDocuments({ provider: 'mpesa', eventId: 'mpesa-event-1' })).toBe(1)

    const account = await BusinessAccountModel.findOne({}).orFail()
    expect(account.planTier).toBe('paid')
    expect(account.subscriptionStatus).toBe('active')
    expect(account.subscriptionEndsAt).toBeTruthy()

    const history = await request(app).get('/api/v1/billing/history').set('Authorization', 'Bearer owner')
    expect(history.status).toBe(200)
    expect(history.body.data).toHaveLength(1)
    expect(history.body.data[0].status).toBe('active')

    const receipt = await request(app).get(`/api/v1/billing/receipts/${history.body.data[0].id}`).set('Authorization', 'Bearer owner')
    expect(receipt.status).toBe(200)
    expect(receipt.body.data.transactionId).toBe('MPESA-TXN-1')
    expect(receipt.body.data.receiptNumber).toContain('RCPT-')
  })

  it('creates non-Kenya Stripe placeholder checkout and activates from webhook', async () => {
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
      .send({ planType: 'yearly', successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel' })
    expect(checkout.status).toBe(201)
    expect(checkout.body.data.provider).toBe('stripe')
    expect(checkout.body.data.subscription.currency).toBe('USD')
    expect(checkout.body.data.subscription.amount).toBe(100)

    const webhook = await request(app)
      .post('/api/v1/webhooks/stripe')
      .send({
        id: 'stripe-event-1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: checkout.body.data.subscription.stripeCheckoutSessionId,
            payment_intent: 'pi_123'
          }
        }
      })
    expect(webhook.status).toBe(200)
    expect(webhook.body.data.processingStatus).toBe('processed')

    const account = await BusinessAccountModel.findOne({}).orFail()
    expect(account.planTier).toBe('paid')
    expect(account.planType).toBe('yearly')
    expect(account.subscriptionStatus).toBe('active')
  })

  it('logs failed M-Pesa callbacks for manual retry visibility', async () => {
    await onboardOwner('owner', 'Kenya')
    const checkout = await request(app)
      .post('/api/v1/billing/mpesa/stk-push')
      .set('Authorization', 'Bearer owner')
      .send({ planType: 'monthly', phoneNumber: '+254700000000' })
    expect(checkout.status).toBe(201)

    const callback = await request(app).post('/api/v1/webhooks/mpesa/callback').send({
      eventId: 'mpesa-failed-1',
      checkoutRequestId: checkout.body.data.subscription.checkoutRequestId,
      resultCode: 1032
    })
    expect(callback.status).toBe(200)
    expect(callback.body.data.processingStatus).toBe('failed')

    const failed = await PaymentEventModel.findOne({ eventId: 'mpesa-failed-1' }).orFail()
    expect(failed.errorMessage).toContain('1032')
    const subscription = await SubscriptionModel.findById(failed.subscriptionId).orFail()
    expect(subscription.status).toBe('failed')
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
