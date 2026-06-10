import path from 'node:path'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../src/app.js'
import type { AuthUser } from '../src/types/http.js'
import type { FirebaseTokenVerifier } from '../src/config/firebase.js'

class FakeVerifier implements FirebaseTokenVerifier {
  constructor(private readonly users: Record<string, AuthUser>) {}

  async verifyIdToken(token: string): Promise<AuthUser> {
    const user = this.users[token]
    if (!user) throw new Error('invalid token')
    return { ...user, authTime: new Date() }
  }
}

const fakeUsers: Record<string, AuthUser> = {
  owner: { firebaseUid: 'owner_uid', email: 'owner@example.com', name: 'Owner User' }
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

describe('Phase 12 PDF alignment: sale reversal, record purchase, profile', () => {
  it('restores branch stock and writes a return movement when a sale is deleted', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const product = await createProduct(branchId, 'Sugar 1kg', 'SUGAR-1KG', 10, 100)
    const productId = product.body.data.id

    const sale = await request(app)
      .post(`/api/v1/branches/${branchId}/sales`)
      .set('Authorization', 'Bearer owner')
      .send({ items: [{ productId, quantity: 3, unitPrice: 150 }], paymentMethod: 'cash' })
    expect(sale.status).toBe(201)

    const afterSale = await request(app).get(`/api/v1/branches/${branchId}/inventory`).set('Authorization', 'Bearer owner')
    expect(afterSale.body.data[0].inventory.quantity).toBe(7)

    const deleted = await request(app)
      .delete(`/api/v1/branches/${branchId}/sales/${sale.body.data.id}`)
      .set('Authorization', 'Bearer owner')
    expect(deleted.status).toBe(200)
    expect(deleted.body.data.deleted).toBe(true)

    const afterDelete = await request(app).get(`/api/v1/branches/${branchId}/inventory`).set('Authorization', 'Bearer owner')
    expect(afterDelete.body.data[0].inventory.quantity).toBe(10)

    const movements = await request(app)
      .get(`/api/v1/branches/${branchId}/inventory/movements?productId=${productId}`)
      .set('Authorization', 'Bearer owner')
    expect(movements.body.data[0].movementType).toBe('return')
    expect(movements.body.data[0].direction).toBe('in')

    const sales = await request(app).get(`/api/v1/branches/${branchId}/sales`).set('Authorization', 'Bearer owner')
    expect(sales.body.data).toHaveLength(0)
  })

  it('reverses the debtor receivable when a credit sale is deleted', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const product = await createProduct(branchId, 'Rice 2kg', 'RICE-2KG', 10, 100)
    const productId = product.body.data.id

    const debtor = await request(app)
      .post(`/api/v1/branches/${branchId}/debtors`)
      .set('Authorization', 'Bearer owner')
      .send({ name: 'Jane Doe', phone: '+254700111222' })
    expect(debtor.status).toBe(201)
    const debtorId = debtor.body.data.id

    const sale = await request(app)
      .post(`/api/v1/branches/${branchId}/sales`)
      .set('Authorization', 'Bearer owner')
      .send({ items: [{ productId, quantity: 2, unitPrice: 150 }], paymentMethod: 'credit', customer: { debtorId } })
    expect(sale.status).toBe(201)

    const owedAfterSale = await request(app).get(`/api/v1/branches/${branchId}/debtors/${debtorId}`).set('Authorization', 'Bearer owner')
    expect(owedAfterSale.body.data.currentDebt).toBe(300)

    await request(app).delete(`/api/v1/branches/${branchId}/sales/${sale.body.data.id}`).set('Authorization', 'Bearer owner').expect(200)

    const owedAfterDelete = await request(app).get(`/api/v1/branches/${branchId}/debtors/${debtorId}`).set('Authorization', 'Bearer owner')
    expect(owedAfterDelete.body.data.currentDebt).toBe(0)
  })

  it('records a purchase and increases stock immediately with receiveImmediately', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const product = await createProduct(branchId, 'Maize 2kg', 'MAIZE-2KG', 2, 100)
    const supplier = await request(app)
      .post(`/api/v1/branches/${branchId}/suppliers`)
      .set('Authorization', 'Bearer owner')
      .send({ name: 'Grain Supplier' })

    const order = await request(app)
      .post(`/api/v1/branches/${branchId}/purchase-orders`)
      .set('Authorization', 'Bearer owner')
      .send({
        supplierId: supplier.body.data.id,
        items: [{ productId: product.body.data.id, quantityOrdered: 5, unitCostPrice: 80 }],
        amountPaid: 100,
        receiveImmediately: true
      })
    expect(order.status).toBe(201)
    expect(order.body.data.status).toBe('received')
    expect(order.body.data.outstandingAmount).toBe(300)

    const inventory = await request(app).get(`/api/v1/branches/${branchId}/inventory`).set('Authorization', 'Bearer owner')
    expect(inventory.body.data[0].inventory.quantity).toBe(7)
    expect(inventory.body.data[0].inventory.costPrice).toBe(80)

    const supplierDetail = await request(app).get(`/api/v1/branches/${branchId}/suppliers/${supplier.body.data.id}`).set('Authorization', 'Bearer owner')
    expect(supplierDetail.body.data.currentBalance).toBe(300)
    expect(supplierDetail.body.data.ledger[0].entryType).toBe('purchase')
  })

  it('persists a user-set profile name and does not clobber it from the auth token', async () => {
    await onboardOwner()

    const updated = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', 'Bearer owner')
      .send({ fullName: 'Custom Name', phone: '+254700999888' })
    expect(updated.status).toBe(200)
    expect(updated.body.data.fullName).toBe('Custom Name')
    expect(updated.body.data.phone).toBe('+254700999888')

    // A subsequent request runs findOrCreateUser again (auth.name = "Owner User").
    // The user-set name must survive.
    const secondUpdate = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', 'Bearer owner')
      .send({ phone: '+254700999000' })
    expect(secondUpdate.status).toBe(200)
    expect(secondUpdate.body.data.fullName).toBe('Custom Name')
  })
})

function onboardOwner() {
  return request(app).post('/api/v1/onboarding/business').set('Authorization', 'Bearer owner').send({
    business: { businessName: 'Faham Test Shop', businessType: 'retail', country: 'Kenya', currency: 'KES' },
    branch: { name: 'Main Branch', location: { address: '123 Test Street', city: 'Nairobi' }, contact: { phone: '+254700000000' } }
  })
}

function createProduct(branchId: string, name: string, sku: string, initialQuantity: number, costPrice: number) {
  return request(app)
    .post(`/api/v1/branches/${branchId}/products`)
    .set('Authorization', 'Bearer owner')
    .send({
      name,
      sku,
      inventory: { initialQuantity, reorderLevel: 2, costPrice, sellingPrice: costPrice * 1.25 }
    })
}
