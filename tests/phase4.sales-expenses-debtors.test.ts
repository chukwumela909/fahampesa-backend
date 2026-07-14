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
  owner: {
    firebaseUid: 'owner_uid',
    email: 'owner@example.com',
    name: 'Owner User'
  },
  manager: {
    firebaseUid: 'manager_uid',
    email: 'manager@example.com',
    name: 'Manager User'
  },
  cashier: {
    firebaseUid: 'cashier_uid',
    email: 'cashier@example.com',
    name: 'Cashier User'
  }
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

describe('Phase 4 sales, expenses, and debtors', () => {
  it('creates a sale, deducts branch inventory, and writes sale stock movements', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const product = await createProduct(branchId, 'Milk 500ml', 'MILK-500', 10, 50)
    const productId = product.body.data.id

    const sale = await request(app)
      .post(`/api/v1/branches/${branchId}/sales`)
      .set('Authorization', 'Bearer owner')
      .send({
        items: [{ productId, quantity: 3, unitPrice: 70 }],
        paymentMethod: 'mpesa',
        notes: 'Till label only, no provider call'
      })

    expect(sale.status).toBe(201)
    expect(sale.body.data.paymentMethod).toBe('mpesa')
    expect(sale.body.data.totalAmount).toBe(210)
    expect(sale.body.data.totalCost).toBe(150)
    expect(sale.body.data.profit).toBe(60)

    const inventory = await request(app).get(`/api/v1/branches/${branchId}/inventory`).set('Authorization', 'Bearer owner')
    expect(inventory.status).toBe(200)
    expect(inventory.body.data[0].inventory.quantity).toBe(7)

    const movements = await request(app)
      .get(`/api/v1/branches/${branchId}/inventory/movements?productId=${productId}`)
      .set('Authorization', 'Bearer owner')
    expect(movements.status).toBe(200)
    expect(movements.body.data[0].movementType).toBe('sale')
    expect(movements.body.data[0].previousQuantity).toBe(10)
    expect(movements.body.data[0].newQuantity).toBe(7)
  })

  it('applies fixed and percentage discounts to line items and the whole cart', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const milk = await createProduct(branchId, 'Milk 500ml', 'MILK-500', 10, 50)
    const bread = await createProduct(branchId, 'Bread', 'BREAD', 10, 30)

    const sale = await request(app)
      .post(`/api/v1/branches/${branchId}/sales`)
      .set('Authorization', 'Bearer owner')
      .send({
        items: [
          { productId: milk.body.data.id, quantity: 2, unitPrice: 100, discount: 10, discountType: 'percentage' },
          { productId: bread.body.data.id, quantity: 1, unitPrice: 80, discount: 5, discountType: 'fixed' }
        ],
        paymentMethod: 'cash',
        tax: 5,
        discount: 10,
        discountType: 'percentage'
      })

    expect(sale.status).toBe(201)
    expect(sale.body.data.items[0].discount).toBe(10)
    expect(sale.body.data.items[0].discountType).toBe('percentage')
    expect(sale.body.data.items[0].discountAmount).toBe(20)
    expect(sale.body.data.items[0].lineSubtotal).toBe(180)
    expect(sale.body.data.items[1].discount).toBe(5)
    expect(sale.body.data.items[1].discountType).toBe('fixed')
    expect(sale.body.data.items[1].discountAmount).toBe(5)
    expect(sale.body.data.items[1].lineSubtotal).toBe(75)
    expect(sale.body.data.subtotal).toBe(255)
    expect(sale.body.data.discount).toBe(10)
    expect(sale.body.data.discountType).toBe('percentage')
    expect(sale.body.data.discountAmount).toBe(26)
    expect(sale.body.data.totalAmount).toBe(234)
    expect(sale.body.data.totalCost).toBe(130)
    expect(sale.body.data.profit).toBe(104)
  })

  it('rejects overselling and lets cashier create assigned-branch sales without seeing cost fields', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const product = await createProduct(branchId, 'Bread', 'BREAD', 2, 80)
    const productId = product.body.data.id
    await addMembership('cashier', branchId)

    const oversell = await request(app)
      .post(`/api/v1/branches/${branchId}/sales`)
      .set('Authorization', 'Bearer cashier')
      .send({
        items: [{ productId, quantity: 3, unitPrice: 110 }],
        paymentMethod: 'cash'
      })
    expect(oversell.status).toBe(409)
    expect(oversell.body.error.code).toBe('insufficient_stock')

    const sale = await request(app)
      .post(`/api/v1/branches/${branchId}/sales`)
      .set('Authorization', 'Bearer cashier')
      .send({
        items: [{ productId, quantity: 1, unitPrice: 110 }],
        paymentMethod: 'card'
      })
    expect(sale.status).toBe(201)
    expect(sale.body.data.totalAmount).toBe(110)
    expect(sale.body.data.totalCost).toBeUndefined()
    expect(sale.body.data.profit).toBeUndefined()
    expect(sale.body.data.items[0].lineCost).toBeUndefined()
    expect(sale.body.data.items[0].lineProfit).toBeUndefined()

    const sales = await request(app).get(`/api/v1/branches/${branchId}/sales`).set('Authorization', 'Bearer cashier')
    expect(sales.status).toBe(200)
    expect(sales.body.data[0].totalCost).toBeUndefined()
    // Receipts must attribute the sale to the cashier who made it, not the viewer.
    expect(sales.body.data[0].createdByName).toBe('cashier User')
    expect(typeof sales.body.data[0].createdBy).toBe('string')
  })

  it('keeps expenses branch scoped and manager-only', async () => {
    const onboarded = await onboardOwner()
    const mainBranchId = onboarded.body.data.branch.id
    await BusinessAccountModel.updateOne({}, { $set: { planTier: 'paid', subscriptionStatus: 'active', subscriptionEndsAt: futureDate() } })
    const secondBranch = await createBranch('Second Branch', 'BR002')
    await addMembership('manager', secondBranch.body.data.id)

    const blocked = await request(app)
      .post(`/api/v1/branches/${mainBranchId}/expenses`)
      .set('Authorization', 'Bearer manager')
      .send({
        amount: 500,
        category: 'Rent',
        paymentMethod: 'cash'
      })
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('branch_forbidden')

    const created = await request(app)
      .post(`/api/v1/branches/${secondBranch.body.data.id}/expenses`)
      .set('Authorization', 'Bearer manager')
      .send({
        amount: 500,
        category: 'Transport',
        description: 'Delivery rider',
        paymentMethod: 'cash',
        vendor: 'Rider'
      })
    expect(created.status).toBe(201)
    expect(created.body.data.branchId).toBe(secondBranch.body.data.id)

    const list = await request(app).get(`/api/v1/branches/${secondBranch.body.data.id}/expenses`).set('Authorization', 'Bearer manager')
    expect(list.status).toBe(200)
    expect(list.body.data).toHaveLength(1)
  })

  it('updates debtor balances through credit sales and debtor payments', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const product = await createProduct(branchId, 'Rice 2kg', 'RICE-2KG', 10, 400)
    const productId = product.body.data.id

    const debtor = await request(app)
      .post(`/api/v1/branches/${branchId}/debtors`)
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Amina Customer',
        phone: '+254700000001',
        creditLimit: 2000
      })
    expect(debtor.status).toBe(201)
    expect(debtor.body.data.currentDebt).toBe(0)

    const creditSale = await request(app)
      .post(`/api/v1/branches/${branchId}/sales`)
      .set('Authorization', 'Bearer owner')
      .send({
        items: [{ productId, quantity: 2, unitPrice: 600 }],
        paymentMethod: 'credit',
        customer: {
          name: 'Amina Customer',
          debtorId: debtor.body.data.id
        }
      })
    expect(creditSale.status).toBe(201)
    expect(creditSale.body.data.totalAmount).toBe(1200)

    const debtorAfterSale = await request(app).get(`/api/v1/branches/${branchId}/debtors/${debtor.body.data.id}`).set('Authorization', 'Bearer owner')
    expect(debtorAfterSale.status).toBe(200)
    expect(debtorAfterSale.body.data.currentDebt).toBe(1200)
    expect(debtorAfterSale.body.data.totalPurchases).toBe(1200)
    expect(debtorAfterSale.body.data.paymentStatus).toBe('outstanding')

    const payment = await request(app)
      .post(`/api/v1/branches/${branchId}/debtors/${debtor.body.data.id}/payments`)
      .set('Authorization', 'Bearer owner')
      .send({
        amount: 500,
        paymentMethod: 'mpesa',
        reference: 'MPE-001'
      })
    expect(payment.status).toBe(201)
    expect(payment.body.data.debtor.currentDebt).toBe(700)
    expect(payment.body.data.payment.outstandingBalance).toBe(700)
  })

  it('persists opening debt and note when creating a debtor, and note edits', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id

    const debtor = await request(app)
      .post(`/api/v1/branches/${branchId}/debtors`)
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Chao Customer',
        phone: '+254700000003',
        creditLimit: 5000,
        openingDebt: 1200,
        note: 'Carried over from the old ledger'
      })
    expect(debtor.status).toBe(201)
    expect(debtor.body.data.currentDebt).toBe(1200)
    expect(debtor.body.data.totalPurchases).toBe(1200)
    expect(debtor.body.data.paymentStatus).toBe('outstanding')
    expect(debtor.body.data.note).toBe('Carried over from the old ledger')

    // Opening debt above the credit limit is rejected like any other purchase
    const overLimit = await request(app)
      .post(`/api/v1/branches/${branchId}/debtors`)
      .set('Authorization', 'Bearer owner')
      .send({ name: 'Over Limit', creditLimit: 1000, openingDebt: 2000 })
    expect(overLimit.status).toBe(409)
    expect(overLimit.body.error.code).toBe('credit_limit_exceeded')

    // Note is editable; openingDebt is create-only and ignored on update
    const updated = await request(app)
      .patch(`/api/v1/branches/${branchId}/debtors/${debtor.body.data.id}`)
      .set('Authorization', 'Bearer owner')
      .send({ note: 'Updated note', openingDebt: 9999 })
    expect(updated.status).toBe(200)
    expect(updated.body.data.note).toBe('Updated note')
    expect(updated.body.data.currentDebt).toBe(1200)
  })

  it('adds manual debt to an existing debtor and blocks delete until the balance is clear', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id

    const debtor = await request(app)
      .post(`/api/v1/branches/${branchId}/debtors`)
      .set('Authorization', 'Bearer owner')
      .send({ name: 'Brian Customer', phone: '+254700000002', creditLimit: 5000 })
    expect(debtor.status).toBe(201)
    const debtorId = debtor.body.data.id

    // Manual purchase increases the balance and totals
    const purchase = await request(app)
      .post(`/api/v1/branches/${branchId}/debtors/${debtorId}/purchases`)
      .set('Authorization', 'Bearer owner')
      .send({ amount: 1500 })
    expect(purchase.status).toBe(201)
    expect(purchase.body.data.currentDebt).toBe(1500)
    expect(purchase.body.data.totalPurchases).toBe(1500)

    // Credit-limit guard blocks a purchase that would exceed the limit
    const overLimit = await request(app)
      .post(`/api/v1/branches/${branchId}/debtors/${debtorId}/purchases`)
      .set('Authorization', 'Bearer owner')
      .send({ amount: 4000 })
    expect(overLimit.status).toBe(409)
    expect(overLimit.body.error.code).toBe('credit_limit_exceeded')

    // Cannot delete a debtor who still owes money
    const blockedDelete = await request(app)
      .delete(`/api/v1/branches/${branchId}/debtors/${debtorId}`)
      .set('Authorization', 'Bearer owner')
    expect(blockedDelete.status).toBe(409)
    expect(blockedDelete.body.error.code).toBe('debtor_has_outstanding_debt')

    // Settle the balance, then the debtor can be deleted (soft delete → gone from the active list)
    const payoff = await request(app)
      .post(`/api/v1/branches/${branchId}/debtors/${debtorId}/payments`)
      .set('Authorization', 'Bearer owner')
      .send({ amount: 1500, paymentMethod: 'cash' })
    expect(payoff.status).toBe(201)
    expect(payoff.body.data.debtor.currentDebt).toBe(0)

    const okDelete = await request(app)
      .delete(`/api/v1/branches/${branchId}/debtors/${debtorId}`)
      .set('Authorization', 'Bearer owner')
    expect(okDelete.status).toBe(200)

    const list = await request(app).get(`/api/v1/branches/${branchId}/debtors`).set('Authorization', 'Bearer owner')
    expect(list.status).toBe(200)
    expect(list.body.data.some((d: { id: string }) => d.id === debtorId)).toBe(false)
  })

  it('collapses duplicate sale submissions that share an Idempotency-Key', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const product = await createProduct(branchId, 'Soda 500ml', 'SODA-500', 10, 100)
    const productId = product.body.data.id

    const salePayload = { items: [{ productId, quantity: 2, unitPrice: 100 }], paymentMethod: 'cash' }
    const key = 'sale-idempotency-key-0001'

    const first = await request(app)
      .post(`/api/v1/branches/${branchId}/sales`)
      .set('Authorization', 'Bearer owner')
      .set('Idempotency-Key', key)
      .send(salePayload)
    expect(first.status).toBe(201)

    // A retried POST (dropped response, offline drain, double-tap) returns the SAME sale, not a new one
    const replay = await request(app)
      .post(`/api/v1/branches/${branchId}/sales`)
      .set('Authorization', 'Bearer owner')
      .set('Idempotency-Key', key)
      .send(salePayload)
    expect(replay.status).toBe(201)
    expect(replay.body.data.id).toBe(first.body.data.id)

    // Exactly one sale exists and stock was deducted once (10 - 2 = 8)
    const sales = await request(app).get(`/api/v1/branches/${branchId}/sales`).set('Authorization', 'Bearer owner')
    expect(sales.body.data).toHaveLength(1)
    const inventory = await request(app).get(`/api/v1/branches/${branchId}/inventory`).set('Authorization', 'Bearer owner')
    expect(inventory.body.data[0].inventory.quantity).toBe(8)
  })

  it('reports business usage counts for plan-limit enforcement', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    await createProduct(branchId, 'Usage A', 'USE-A', 5, 50)
    await createProduct(branchId, 'Usage B', 'USE-B', 5, 50)

    const usage = await request(app).get('/api/v1/usage').set('Authorization', 'Bearer owner')
    expect(usage.status).toBe(200)
    expect(usage.body.data.products).toBe(2)
    expect(usage.body.data.branches).toBe(1)
    expect(usage.body.data.staff).toBe(0)
    expect(usage.body.data.suppliers).toBe(0)
    expect(usage.body.data.debtors).toBe(0)
    expect(usage.body.data.dailySales).toBe(0)
  })
})

function onboardOwner() {
  return request(app).post('/api/v1/onboarding/business').set('Authorization', 'Bearer owner').send({
    business: {
      businessName: 'Faham Test Shop',
      businessType: 'retail',
      country: 'Kenya',
      currency: 'KES'
    },
    branch: {
      name: 'Main Branch',
      location: { address: '123 Test Street', city: 'Nairobi' },
      contact: { phone: '+254700000000' }
    }
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
    .send({
      name,
      sku,
      inventory: {
        initialQuantity,
        reorderLevel: 2,
        costPrice,
        sellingPrice: costPrice * 1.4
      }
    })
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
