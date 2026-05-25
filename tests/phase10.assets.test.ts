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
import type { ProductImageStorageInput, ProductImageStorageUploader } from '../src/services/asset.service.js'

class FakeVerifier implements FirebaseTokenVerifier {
  constructor(private readonly users: Record<string, AuthUser>) {}

  async verifyIdToken(token: string): Promise<AuthUser> {
    const user = this.users[token]
    if (!user) throw new Error('invalid token')
    return { ...user, authTime: new Date() }
  }
}

class FakeProductImageUploader implements ProductImageStorageUploader {
  uploads: ProductImageStorageInput[] = []

  async upload(input: ProductImageStorageInput) {
    this.uploads.push(input)
    return {
      url: `https://firebase.test/${encodeURIComponent(input.storagePath)}?alt=media&token=${input.downloadToken}`
    }
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

const imageUploader = new FakeProductImageUploader()
const app = createApp({ tokenVerifier: new FakeVerifier(fakeUsers), productImageUploader: imageUploader })
let replSet: MongoMemoryReplSet

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.MONGOMS_DOWNLOAD_DIR = path.join(process.cwd(), '.cache', 'mongodb-binaries')
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  await mongoose.connect(replSet.getUri())
})

afterEach(async () => {
  imageUploader.uploads = []
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})))
})

afterAll(async () => {
  await mongoose.disconnect()
  await replSet?.stop()
})

describe('Phase 10 product image assets', () => {
  it('uploads a product image to business-scoped storage for owners and managers', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id
    const account = await BusinessAccountModel.findOne({}).orFail()

    const ownerUpload = await request(app)
      .post('/api/v1/assets/product-images')
      .set('Authorization', 'Bearer owner')
      .attach('image', Buffer.from('fake-webp-image'), { filename: 'product.webp', contentType: 'image/webp' })

    expect(ownerUpload.status).toBe(201)
    expect(ownerUpload.body.data.url).toContain('https://firebase.test/')
    expect(ownerUpload.body.data.storagePath).toMatch(new RegExp(`^businesses/${account._id.toString()}/products/.+\\.webp$`))
    expect(ownerUpload.body.data.contentType).toBe('image/webp')
    expect(ownerUpload.body.data.size).toBe(Buffer.byteLength('fake-webp-image'))
    expect(imageUploader.uploads[0].contentType).toBe('image/webp')

    await addMembership('manager', branchId)
    const managerUpload = await request(app)
      .post('/api/v1/assets/product-images')
      .set('Authorization', 'Bearer manager')
      .attach('image', Buffer.from('fake-png-image'), { filename: 'product.png', contentType: 'image/png' })

    expect(managerUpload.status).toBe(201)
    expect(managerUpload.body.data.storagePath).toMatch(new RegExp(`^businesses/${account._id.toString()}/products/.+\\.png$`))
  })

  it('blocks cashiers from uploading product images', async () => {
    const onboarded = await onboardOwner()
    await addMembership('cashier', onboarded.body.data.branch.id)

    const response = await request(app)
      .post('/api/v1/assets/product-images')
      .set('Authorization', 'Bearer cashier')
      .attach('image', Buffer.from('fake-image'), { filename: 'product.jpg', contentType: 'image/jpeg' })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('manager_required')
    expect(imageUploader.uploads).toHaveLength(0)
  })

  it('validates missing, unsupported, and oversized product images', async () => {
    await onboardOwner()

    const missingFile = await request(app).post('/api/v1/assets/product-images').set('Authorization', 'Bearer owner')
    expect(missingFile.status).toBe(422)
    expect(missingFile.body.error.code).toBe('image_required')

    const unsupported = await request(app)
      .post('/api/v1/assets/product-images')
      .set('Authorization', 'Bearer owner')
      .attach('image', Buffer.from('not-image'), { filename: 'product.txt', contentType: 'text/plain' })
    expect(unsupported.status).toBe(422)
    expect(unsupported.body.error.code).toBe('unsupported_image_type')

    const oversized = await request(app)
      .post('/api/v1/assets/product-images')
      .set('Authorization', 'Bearer owner')
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'product.png', contentType: 'image/png' })
    expect(oversized.status).toBe(413)
    expect(oversized.body.error.code).toBe('image_too_large')
  })

  it('stores uploaded image URLs through product create and update payloads', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id

    const upload = await request(app)
      .post('/api/v1/assets/product-images')
      .set('Authorization', 'Bearer owner')
      .attach('image', Buffer.from('fake-jpeg-image'), { filename: 'product.jpg', contentType: 'image/jpeg' })
    expect(upload.status).toBe(201)

    const created = await request(app)
      .post(`/api/v1/branches/${branchId}/products`)
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Image Product',
        sku: 'IMAGE-PRODUCT',
        images: [upload.body.data.url]
      })
    expect(created.status).toBe(201)
    expect(created.body.data.images).toEqual([upload.body.data.url])

    const updated = await request(app)
      .patch(`/api/v1/branches/${branchId}/products/${created.body.data.id}`)
      .set('Authorization', 'Bearer owner')
      .send({ images: ['https://example.com/replacement.webp'] })
    expect(updated.status).toBe(200)
    expect(updated.body.data.images).toEqual(['https://example.com/replacement.webp'])
  })
})

function onboardOwner() {
  return request(app).post('/api/v1/onboarding/business').set('Authorization', 'Bearer owner').send({
    business: {
      businessName: 'Faham Asset Shop',
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
