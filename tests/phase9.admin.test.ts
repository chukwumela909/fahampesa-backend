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
import { UserModel } from '../src/models/user.model.js'

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
  admin: { firebaseUid: 'admin_uid', email: 'admin@example.com', name: 'Admin User', platformRole: 'admin' }
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

describe('Phase 9 super admin APIs', () => {
  it('requires platform admin and exposes business search/detail', async () => {
    const onboarded = await onboardOwner()
    const businessAccountId = onboarded.body.data.businessAccount.id

    const blocked = await request(app).get('/api/v1/admin/businesses').set('Authorization', 'Bearer owner')
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('platform_admin_required')

    const search = await request(app).get('/api/v1/admin/businesses?q=Faham').set('Authorization', 'Bearer admin')
    expect(search.status).toBe(200)
    expect(search.body.data).toHaveLength(1)
    expect(search.body.data[0].id).toBe(businessAccountId)

    const detail = await request(app).get(`/api/v1/admin/businesses/${businessAccountId}`).set('Authorization', 'Bearer admin')
    expect(detail.status).toBe(200)
    expect(detail.body.data.account.id).toBe(businessAccountId)
    expect(detail.body.data.branches).toHaveLength(1)
  })

  it('does not grant platform admin from the local Mongo user record', async () => {
    await onboardOwner()
    await UserModel.findOneAndUpdate({ firebaseUid: 'owner_uid' }, { $set: { platformRole: 'admin' } })

    const blocked = await request(app).get('/api/v1/admin/businesses').set('Authorization', 'Bearer owner')
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('platform_admin_required')
  })

  it('pauses and resumes businesses with audit logs and read-only enforcement', async () => {
    const onboarded = await onboardOwner()
    const businessAccountId = onboarded.body.data.businessAccount.id

    const paused = await request(app).post(`/api/v1/admin/businesses/${businessAccountId}/pause`).set('Authorization', 'Bearer admin')
    expect(paused.status).toBe(200)
    expect(paused.body.data.accountStatus).toBe('paused')

    const write = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', 'Bearer owner')
      .send({ name: 'Blocked', branchCode: 'BLK', location: { address: 'Nope' } })
    expect(write.status).toBe(423)
    expect(write.body.error.code).toBe('account_read_only')

    const resumed = await request(app).post(`/api/v1/admin/businesses/${businessAccountId}/resume`).set('Authorization', 'Bearer admin')
    expect(resumed.status).toBe(200)
    expect(resumed.body.data.accountStatus).toBe('active')

    const logs = await request(app).get('/api/v1/admin/audit-logs').set('Authorization', 'Bearer admin')
    expect(logs.status).toBe(200)
    expect(logs.body.data.some((log: { action: string }) => log.action === 'business.paused')).toBe(true)
    expect(logs.body.data.some((log: { action: string }) => log.action === 'business.active')).toBe(true)
  })

  it('sets branch-limit override and manually activates subscriptions', async () => {
    const onboarded = await onboardOwner()
    const businessAccountId = onboarded.body.data.businessAccount.id

    const override = await request(app)
      .post(`/api/v1/admin/businesses/${businessAccountId}/branch-limit`)
      .set('Authorization', 'Bearer admin')
      .send({ branchLimitOverride: 3 })
    expect(override.status).toBe(200)
    expect(override.body.data.branchLimitOverride).toBe(3)

    const manual = await request(app)
      .post(`/api/v1/admin/businesses/${businessAccountId}/subscriptions/manual-activate`)
      .set('Authorization', 'Bearer admin')
      .send({ planType: 'monthly', days: 10, reason: 'Support adjustment' })
    expect(manual.status).toBe(201)
    expect(manual.body.data.account.planTier).toBe('paid')
    expect(manual.body.data.account.subscriptionStatus).toBe('active')
    expect(manual.body.data.subscription.provider).toBe('manual')

    const account = await BusinessAccountModel.findById(businessAccountId).orFail()
    expect(account.subscriptionEndsAt).toBeTruthy()
  })

  it('one-click activates Pro from an empty body, defaulting to a monthly plan', async () => {
    const onboarded = await onboardOwner()
    const businessAccountId = onboarded.body.data.businessAccount.id

    const grant = await request(app)
      .post(`/api/v1/admin/businesses/${businessAccountId}/subscriptions/manual-activate`)
      .set('Authorization', 'Bearer admin')
      .send({})
    expect(grant.status).toBe(201)
    expect(grant.body.data.account.planTier).toBe('paid')
    expect(grant.body.data.account.planType).toBe('monthly')
    expect(grant.body.data.account.subscriptionStatus).toBe('active')
    expect(grant.body.data.subscription.provider).toBe('manual')
    expect(grant.body.data.subscription.amount).toBe(0)

    const me = await request(app).get('/api/v1/me').set('Authorization', 'Bearer owner')
    expect(me.body.data.planTier).toBe('paid')
    expect(me.body.data.subscriptionStatus).toBe('active')
  })

  it('lists payment events and marks failed event for retry', async () => {
    const onboarded = await onboardOwner()
    const businessAccountId = onboarded.body.data.businessAccount.id
    const event = await PaymentEventModel.create({
      provider: 'mpesa',
      eventId: 'failed-admin-retry',
      businessAccountId,
      eventType: 'mpesa.callback',
      rawPayload: { resultCode: 1032 },
      processingStatus: 'failed',
      errorMessage: 'M-Pesa result code 1032',
      processedAt: new Date()
    })

    const payments = await request(app).get('/api/v1/admin/payments').set('Authorization', 'Bearer admin')
    expect(payments.status).toBe(200)
    expect(payments.body.data[0].eventId).toBe('failed-admin-retry')

    const retry = await request(app).post(`/api/v1/admin/payment-events/${event._id.toString()}/retry`).set('Authorization', 'Bearer admin')
    expect(retry.status).toBe(200)
    expect(retry.body.data.processingStatus).toBe('received')
    expect(retry.body.data.errorMessage).toBeUndefined()
  })
})

function onboardOwner() {
  return request(app).post('/api/v1/onboarding/business').set('Authorization', 'Bearer owner').send({
    business: { businessName: 'Faham Test Shop', businessType: 'retail', country: 'Kenya', currency: 'KES' },
    branch: { name: 'Main Branch', location: { address: '123 Test Street', city: 'Nairobi' }, contact: { phone: '+254700000000' } }
  })
}
