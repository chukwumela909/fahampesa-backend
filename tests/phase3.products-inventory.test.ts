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
import { IdempotencyKeyModel } from '../src/models/idempotency-key.model.js'
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
  // The unique (businessAccountId, key) index is what collapses concurrent duplicate
  // submissions; build it before any request runs.
  await IdempotencyKeyModel.init()
})

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})))
})

afterAll(async () => {
  await mongoose.disconnect()
  await replSet?.stop()
})

describe('Phase 3 products and branch inventory', () => {
  it('creates a branch product with inventory, an initial stock movement, and a low-stock alert', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id

    const created = await createProduct(branchId, {
      name: 'Maize Flour 2kg',
      barcode: '600000000001',
      sku: 'MAIZE-2KG',
      category: 'Food',
      unitOfMeasure: 'bag',
      inventory: {
        initialQuantity: 3,
        reorderLevel: 5,
        costPrice: 120,
        sellingPrice: 150,
        initialStockReason: 'Opening count'
      }
    })

    expect(created.status).toBe(201)
    expect(created.body.data.name).toBe('Maize Flour 2kg')
    expect(created.body.data.inventory.quantity).toBe(3)
    expect(created.body.data.inventory.stockValue).toBe(360)
    expect(created.body.data.inventory.status).toBe('low_stock')

    const products = await request(app).get(`/api/v1/branches/${branchId}/products`).set('Authorization', 'Bearer owner')
    expect(products.status).toBe(200)
    expect(products.body.data).toHaveLength(1)
    expect(products.body.data[0].inventory.costPrice).toBe(120)

    const movements = await request(app).get(`/api/v1/branches/${branchId}/inventory/movements`).set('Authorization', 'Bearer owner')
    expect(movements.status).toBe(200)
    expect(movements.body.data).toHaveLength(1)
    expect(movements.body.data[0].movementType).toBe('initial')
    expect(movements.body.data[0].reason).toBe('Opening count')

    const alerts = await request(app).get(`/api/v1/branches/${branchId}/inventory/alerts`).set('Authorization', 'Bearer owner')
    expect(alerts.status).toBe(200)
    expect(alerts.body.data).toHaveLength(1)
    expect(alerts.body.data[0].alertType).toBe('low_stock')
  })

  it('changes stock only through adjustment commands and records movement history', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const created = await createProduct(branchId, {
      name: 'Sugar 1kg',
      sku: 'SUGAR-1KG',
      inventory: {
        initialQuantity: 3,
        reorderLevel: 5,
        costPrice: 500,
        sellingPrice: 650
      }
    })
    const productId = created.body.data.id

    const directPatch = await request(app)
      .patch(`/api/v1/branches/${branchId}/products/${productId}`)
      .set('Authorization', 'Bearer owner')
      .send({
        inventory: {
          quantity: 999,
          sellingPrice: 700
        }
      })
    expect(directPatch.status).toBe(200)
    expect(directPatch.body.data.inventory.quantity).toBe(3)
    expect(directPatch.body.data.inventory.sellingPrice).toBe(700)

    const increase = await request(app)
      .post(`/api/v1/branches/${branchId}/inventory/adjustments`)
      .set('Authorization', 'Bearer owner')
      .send({
        productId,
        adjustmentType: 'increase',
        quantity: 5,
        reason: 'Supplier count correction',
        unitCostPrice: 520
      })
    expect(increase.status).toBe(201)
    expect(increase.body.data.inventory.quantity).toBe(8)
    expect(increase.body.data.movement.direction).toBe('in')
    expect(increase.body.data.movement.previousQuantity).toBe(3)
    expect(increase.body.data.movement.newQuantity).toBe(8)

    const noAlerts = await request(app).get(`/api/v1/branches/${branchId}/inventory/alerts`).set('Authorization', 'Bearer owner')
    expect(noAlerts.status).toBe(200)
    expect(noAlerts.body.data).toHaveLength(0)

    const decrease = await request(app)
      .post(`/api/v1/branches/${branchId}/inventory/adjustments`)
      .set('Authorization', 'Bearer owner')
      .send({
        productId,
        adjustmentType: 'decrease',
        quantity: 4,
        reason: 'Damaged bags'
      })
    expect(decrease.status).toBe(201)
    expect(decrease.body.data.inventory.quantity).toBe(4)
    expect(decrease.body.data.movement.direction).toBe('out')

    const alerts = await request(app).get(`/api/v1/branches/${branchId}/inventory/alerts`).set('Authorization', 'Bearer owner')
    expect(alerts.status).toBe(200)
    expect(alerts.body.data).toHaveLength(1)

    const oversellLikeAdjustment = await request(app)
      .post(`/api/v1/branches/${branchId}/inventory/adjustments`)
      .set('Authorization', 'Bearer owner')
      .send({
        productId,
        adjustmentType: 'decrease',
        quantity: 99,
        reason: 'Invalid correction'
      })
    expect(oversellLikeAdjustment.status).toBe(409)
    expect(oversellLikeAdjustment.body.error.code).toBe('insufficient_stock')
  })

  it('flags a loss margin status when selling below cost and profit when above', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id

    const loss = await createProduct(branchId, {
      name: 'Clearance Mug',
      inventory: { costPrice: 100, sellingPrice: 80 }
    })
    expect(loss.status).toBe(201)
    expect(loss.body.data.inventory.profitMargin).toBe(-20)
    expect(loss.body.data.inventory.marginStatus).toBe('loss')

    const breakeven = await createProduct(branchId, {
      name: 'Cost Recovery Mug',
      inventory: { costPrice: 100, sellingPrice: 100 }
    })
    expect(breakeven.body.data.inventory.marginStatus).toBe('breakeven')

    const profit = await createProduct(branchId, {
      name: 'Premium Mug',
      inventory: { costPrice: 100, sellingPrice: 150 }
    })
    expect(profit.body.data.inventory.profitMargin).toBe(50)
    expect(profit.body.data.inventory.marginStatus).toBe('profit')
  })

  it('replays the same response and creates one product for a repeated Idempotency-Key', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const body = { name: 'Idempotent Soda', inventory: { sellingPrice: 50 } }
    const key = 'create-soda-0001'

    const first = await request(app)
      .post(`/api/v1/branches/${branchId}/products`)
      .set('Authorization', 'Bearer owner')
      .set('Idempotency-Key', key)
      .send(body)
    expect(first.status).toBe(201)

    const replay = await request(app)
      .post(`/api/v1/branches/${branchId}/products`)
      .set('Authorization', 'Bearer owner')
      .set('Idempotency-Key', key)
      .send(body)
    expect(replay.status).toBe(201)
    expect(replay.body.data.id).toBe(first.body.data.id)

    const products = await request(app).get(`/api/v1/branches/${branchId}/products`).set('Authorization', 'Bearer owner')
    expect(products.body.data).toHaveLength(1)
  })

  it('creates only one product when the same Idempotency-Key is submitted concurrently', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const body = { name: 'Rapid Click Bread', inventory: { sellingPrice: 40 } }
    const key = 'rapid-click-bread-1'

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post(`/api/v1/branches/${branchId}/products`)
          .set('Authorization', 'Bearer owner')
          .set('Idempotency-Key', key)
          .send(body)
      )
    )

    expect(responses.some((response) => response.status === 201)).toBe(true)
    for (const response of responses) {
      // Losers of the unique-index race are rejected as in-progress or replay the first result.
      expect([201, 409]).toContain(response.status)
    }

    const products = await request(app).get(`/api/v1/branches/${branchId}/products`).set('Authorization', 'Bearer owner')
    expect(products.body.data).toHaveLength(1)
  })

  it('rejects reusing an Idempotency-Key for a materially different request', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const key = 'reused-key-0001'

    const first = await request(app)
      .post(`/api/v1/branches/${branchId}/products`)
      .set('Authorization', 'Bearer owner')
      .set('Idempotency-Key', key)
      .send({ name: 'First Product', inventory: { sellingPrice: 10 } })
    expect(first.status).toBe(201)

    const reused = await request(app)
      .post(`/api/v1/branches/${branchId}/products`)
      .set('Authorization', 'Bearer owner')
      .set('Idempotency-Key', key)
      .send({ name: 'Different Product', inventory: { sellingPrice: 20 } })
    expect(reused.status).toBe(422)
    expect(reused.body.error.code).toBe('idempotency_key_reuse')
  })

  it('allows multiple products without optional barcode or SKU values', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id

    const first = await createProduct(branchId, {
      name: 'Loose Tomatoes',
      inventory: { sellingPrice: 20 }
    })
    const second = await createProduct(branchId, {
      name: 'Loose Onions',
      inventory: { sellingPrice: 15 }
    })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
  })

  it('bulk uploads products and reports per-row success and failure', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id

    const response = await request(app)
      .post(`/api/v1/branches/${branchId}/products/bulk-upload`)
      .set('Authorization', 'Bearer owner')
      .send({
        products: [
          { name: 'Bulk Salt 1kg', sku: 'BULK-SALT', inventory: { initialQuantity: 10, reorderLevel: 2, costPrice: 30, sellingPrice: 50 } },
          { name: 'Bulk Beans 1kg', sku: 'BULK-BEANS', inventory: { sellingPrice: 120 } },
          { name: 'Duplicate Salt', sku: 'BULK-SALT', inventory: { sellingPrice: 60 } }
        ]
      })

    expect(response.status).toBe(207)
    expect(response.body.data.total).toBe(3)
    expect(response.body.data.created).toBe(2)
    expect(response.body.data.failed).toBe(1)
    expect(response.body.data.results[2].status).toBe('failed')
    expect(response.body.data.results[2].error.code).toBe('duplicate_product_identity')

    const products = await request(app).get(`/api/v1/branches/${branchId}/products`).set('Authorization', 'Bearer owner')
    expect(products.body.data).toHaveLength(2)
  })

  it('returns 201 when every bulk-upload row succeeds and blocks cashiers', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id

    const ok = await request(app)
      .post(`/api/v1/branches/${branchId}/products/bulk-upload`)
      .set('Authorization', 'Bearer owner')
      .send({ products: [{ name: 'Bulk Rice', inventory: { sellingPrice: 200 } }] })
    expect(ok.status).toBe(201)
    expect(ok.body.data.created).toBe(1)
    expect(ok.body.data.failed).toBe(0)

    await addMembership('cashier', branchId)
    const blocked = await request(app)
      .post(`/api/v1/branches/${branchId}/products/bulk-upload`)
      .set('Authorization', 'Bearer cashier')
      .send({ products: [{ name: 'Cashier Bulk', inventory: { sellingPrice: 10 } }] })
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('manager_required')
  })

  it('hides cost and valuation fields from cashier reads and blocks cashier product writes', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const created = await createProduct(branchId, {
      name: 'Rice 5kg',
      sku: 'RICE-5KG',
      inventory: {
        initialQuantity: 10,
        reorderLevel: 2,
        costPrice: 800,
        sellingPrice: 1000
      }
    })
    await addMembership('cashier', branchId)

    const cashierProducts = await request(app).get(`/api/v1/branches/${branchId}/products`).set('Authorization', 'Bearer cashier')
    expect(cashierProducts.status).toBe(200)
    expect(cashierProducts.body.data).toHaveLength(1)
    expect(cashierProducts.body.data[0].inventory.quantity).toBe(10)
    expect(cashierProducts.body.data[0].inventory.sellingPrice).toBe(1000)
    expect(cashierProducts.body.data[0].inventory.costPrice).toBeUndefined()
    expect(cashierProducts.body.data[0].inventory.stockValue).toBeUndefined()
    expect(cashierProducts.body.data[0].inventory.profitMargin).toBeUndefined()

    const cashierMovements = await request(app)
      .get(`/api/v1/branches/${branchId}/inventory/movements?productId=${created.body.data.id}`)
      .set('Authorization', 'Bearer cashier')
    expect(cashierMovements.status).toBe(200)
    expect(cashierMovements.body.data[0].unitCostPrice).toBeUndefined()
    expect(cashierMovements.body.data[0].totalValue).toBeUndefined()

    const cashierCreate = await createProduct(branchId, { name: 'Blocked Product' }, 'cashier')
    expect(cashierCreate.status).toBe(403)
    expect(cashierCreate.body.error.code).toBe('manager_required')
  })

  it('enforces branch access and shows product stock only for accessible branches', async () => {
    const onboarded = await onboardOwner()
    const mainBranchId = onboarded.body.data.branch.id
    await BusinessAccountModel.updateOne({}, { $set: { planTier: 'paid', subscriptionStatus: 'active', subscriptionEndsAt: futureDate() } })
    const secondBranch = await createBranch('Second Branch', 'BR002')
    expect(secondBranch.status).toBe(201)

    const mainProduct = await createProduct(mainBranchId, {
      name: 'Cooking Oil',
      sku: 'OIL-1L',
      inventory: {
        initialQuantity: 4,
        reorderLevel: 2,
        costPrice: 900,
        sellingPrice: 1100
      }
    })

    const linked = await createProduct(secondBranch.body.data.id, {
      productId: mainProduct.body.data.id,
      inventory: {
        initialQuantity: 9,
        reorderLevel: 3,
        costPrice: 880,
        sellingPrice: 1080
      }
    })
    expect(linked.status).toBe(201)

    const ownerDetail = await request(app)
      .get(`/api/v1/branches/${mainBranchId}/products/${mainProduct.body.data.id}`)
      .set('Authorization', 'Bearer owner')
    expect(ownerDetail.status).toBe(200)
    expect(ownerDetail.body.data.inventoryByBranch).toHaveLength(2)

    await addMembership('manager', secondBranch.body.data.id)
    const managerMainBranch = await request(app).get(`/api/v1/branches/${mainBranchId}/products`).set('Authorization', 'Bearer manager')
    expect(managerMainBranch.status).toBe(403)
    expect(managerMainBranch.body.error.code).toBe('branch_forbidden')

    const managerDetail = await request(app)
      .get(`/api/v1/branches/${secondBranch.body.data.id}/products/${mainProduct.body.data.id}`)
      .set('Authorization', 'Bearer manager')
    expect(managerDetail.status).toBe(200)
    expect(managerDetail.body.data.inventoryByBranch).toHaveLength(1)
    expect(managerDetail.body.data.inventoryByBranch[0].branchId).toBe(secondBranch.body.data.id)
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

function createProduct(branchId: string, body: Record<string, unknown>, token = 'owner') {
  return request(app).post(`/api/v1/branches/${branchId}/products`).set('Authorization', `Bearer ${token}`).send(body)
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
