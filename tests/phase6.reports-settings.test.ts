import path from 'node:path'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../src/app.js'
import type { AuthUser } from '../src/types/http.js'
import type { FirebaseTokenVerifier } from '../src/config/firebase.js'
import { BusinessAccountModel } from '../src/models/business-account.model.js'
import { BusinessMembershipModel } from '../src/models/business-membership.model.js'
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
  manager: { firebaseUid: 'manager_uid', email: 'manager@example.com', name: 'Manager User' },
  cashier: { firebaseUid: 'cashier_uid', email: 'cashier@example.com', name: 'Cashier User' }
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

describe('Phase 6 reports and settings', () => {
  it('lets owners view all-branch dashboard and financial reports', async () => {
    const { mainBranchId, secondBranchId, productId } = await seedReportData()

    const sale = await request(app)
      .post(`/api/v1/branches/${mainBranchId}/sales`)
      .set('Authorization', 'Bearer owner')
      .send({ items: [{ productId, quantity: 2, unitPrice: 150 }], paymentMethod: 'cash' })
    expect(sale.status).toBe(201)

    await request(app)
      .post(`/api/v1/branches/${secondBranchId}/expenses`)
      .set('Authorization', 'Bearer owner')
      .send({ amount: 100, category: 'Transport', paymentMethod: 'cash' })
      .expect(201)

    const dashboard = await request(app).get('/api/v1/reports/dashboard?branchId=all').set('Authorization', 'Bearer owner')
    expect(dashboard.status).toBe(200)
    expect(dashboard.body.data.branchIds).toContain(mainBranchId)
    expect(dashboard.body.data.branchIds).toContain(secondBranchId)
    expect(dashboard.body.data.totalSales).toBe(300)
    expect(dashboard.body.data.totalProfit).toBe(100)
    expect(dashboard.body.data.totalExpenses).toBe(100)
    expect(dashboard.body.data.inventoryValue).toBeGreaterThan(0)

    const valuation = await request(app).get('/api/v1/reports/inventory-valuation?branchId=all').set('Authorization', 'Bearer owner')
    expect(valuation.status).toBe(200)
    expect(valuation.body.data.totalStockValue).toBeGreaterThan(0)
  })

  it('restricts manager all-branch reports and limits assigned branch report scope', async () => {
    const { mainBranchId, secondBranchId, productId } = await seedReportData()
    await addMembership('manager', secondBranchId)

    await request(app)
      .post(`/api/v1/branches/${secondBranchId}/sales`)
      .set('Authorization', 'Bearer owner')
      .send({ items: [{ productId, quantity: 1, unitPrice: 160 }], paymentMethod: 'cash' })
      .expect(201)

    const all = await request(app).get('/api/v1/reports/sales?branchId=all').set('Authorization', 'Bearer manager')
    expect(all.status).toBe(403)
    expect(all.body.error.code).toBe('owner_required')

    const forbidden = await request(app).get(`/api/v1/reports/sales?branchId=${mainBranchId}`).set('Authorization', 'Bearer manager')
    expect(forbidden.status).toBe(403)
    expect(forbidden.body.error.code).toBe('branch_forbidden')

    const assigned = await request(app).get(`/api/v1/reports/sales?branchId=${secondBranchId}`).set('Authorization', 'Bearer manager')
    expect(assigned.status).toBe(200)
    expect(assigned.body.data.branchIds).toEqual([secondBranchId])
    expect(assigned.body.data.totalSales).toBe(160)
  })

  it('returns cashier-safe reports and blocks valuation reports', async () => {
    const { mainBranchId, productId } = await seedReportData()
    await addMembership('cashier', mainBranchId)
    await request(app)
      .post(`/api/v1/branches/${mainBranchId}/sales`)
      .set('Authorization', 'Bearer cashier')
      .send({ items: [{ productId, quantity: 1, unitPrice: 150 }], paymentMethod: 'cash' })
      .expect(201)

    const sales = await request(app).get(`/api/v1/reports/sales?branchId=${mainBranchId}`).set('Authorization', 'Bearer cashier')
    expect(sales.status).toBe(200)
    expect(sales.body.data.totalSales).toBe(150)
    expect(sales.body.data.totalCost).toBeUndefined()
    expect(sales.body.data.totalProfit).toBeUndefined()

    const valuation = await request(app).get(`/api/v1/reports/inventory-valuation?branchId=${mainBranchId}`).set('Authorization', 'Bearer cashier')
    expect(valuation.status).toBe(403)
    expect(valuation.body.error.code).toBe('financial_report_forbidden')
  })

  it('keeps settings functional and role scoped', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    await addMembership('cashier', branchId)

    const updated = await request(app)
      .patch('/api/v1/settings')
      .set('Authorization', 'Bearer owner')
      .send({
        receiptSettings: { footerText: 'Thank you' },
        notificationSettings: { lowStockEnabled: true },
        syncSettings: { offlineSyncEnabled: true, autoSyncInterval: 15 }
      })
    expect(updated.status).toBe(200)
    expect(updated.body.data.receiptSettings.footerText).toBe('Thank you')
    expect(updated.body.data.notificationSettings.lowStockEnabled).toBe(true)

    const cashierSettings = await request(app).get('/api/v1/settings').set('Authorization', 'Bearer cashier')
    expect(cashierSettings.status).toBe(200)
    expect(cashierSettings.body.data.receiptSettings.footerText).toBe('Thank you')
    expect(cashierSettings.body.data.notificationSettings).toBeUndefined()

    const cashierPatch = await request(app).patch('/api/v1/settings').set('Authorization', 'Bearer cashier').send({ receiptSettings: { footerText: 'Nope' } })
    expect(cashierPatch.status).toBe(403)
    expect(cashierPatch.body.error.code).toBe('manager_required')
  })
})

async function seedReportData() {
  const onboarded = await onboardOwner()
  const mainBranchId = onboarded.body.data.branch.id
  await BusinessAccountModel.updateOne({}, { $set: { planTier: 'paid', subscriptionStatus: 'active', subscriptionEndsAt: futureDate() } })
  const secondBranch = await createBranch('Second Branch', 'BR002')
  const product = await createProduct(mainBranchId, 'Soap', 'SOAP', 10, 100)
  await request(app)
    .post(`/api/v1/branches/${secondBranch.body.data.id}/products`)
    .set('Authorization', 'Bearer owner')
    .send({ productId: product.body.data.id, inventory: { initialQuantity: 5, reorderLevel: 1, costPrice: 100, sellingPrice: 150 } })
    .expect(201)
  return { mainBranchId, secondBranchId: secondBranch.body.data.id, productId: product.body.data.id }
}

function onboardOwner() {
  return request(app).post('/api/v1/onboarding/business').set('Authorization', 'Bearer owner').send({
    business: { businessName: 'Faham Test Shop', businessType: 'retail', country: 'Kenya', currency: 'KES' },
    branch: { name: 'Main Branch', location: { address: '123 Test Street', city: 'Nairobi' }, contact: { phone: '+254700000000' } }
  })
}

function createBranch(name: string, branchCode: string) {
  return request(app).post('/api/v1/branches').set('Authorization', 'Bearer owner').send({
    name,
    branchCode,
    location: { address: `${name} Address`, city: 'Nairobi' },
    contact: { phone: '+254711111111' }
  })
}

function createProduct(branchId: string, name: string, sku: string, initialQuantity: number, costPrice: number) {
  return request(app)
    .post(`/api/v1/branches/${branchId}/products`)
    .set('Authorization', 'Bearer owner')
    .send({ name, sku, inventory: { initialQuantity, reorderLevel: 2, costPrice, sellingPrice: 150 } })
}

async function addMembership(role: 'manager' | 'cashier', branchId: string) {
  const ownerUser = await UserModel.findOne({ firebaseUid: 'owner_uid' }).orFail()
  const user = await UserModel.create({
    firebaseUid: `${role}_uid`,
    email: `${role}@example.com`,
    fullName: `${role} User`
  })
  const account = await BusinessAccountModel.findOne({}).orFail()

  await BusinessMembershipModel.create({
    businessAccountId: account._id,
    userId: user._id,
    role,
    assignedBranchIds: [branchId],
    permissions: [],
    createdBy: ownerUser._id
  })
}

function futureDate() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
}
