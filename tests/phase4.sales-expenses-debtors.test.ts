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
