import path from 'node:path'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import type { AuthUser } from '../src/types/http.js'
import type { FirebaseTokenVerifier } from '../src/config/firebase.js'

vi.mock('../src/config/firebase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/firebase.js')>()
  return {
    ...actual,
    listFirebaseAuthUsers: vi.fn(async () => [
      {
        uid: 'owner_uid',
        email: 'owner@example.com',
        displayName: 'Owner User',
        emailVerified: true,
        disabled: false,
        metadata: { creationTime: '2026-01-01T00:00:00.000Z', lastSignInTime: '2026-01-02T00:00:00.000Z' },
        customClaims: {}
      },
      {
        uid: 'firebase_only_uid',
        email: 'firebase-only@example.com',
        displayName: 'Firebase Only',
        emailVerified: true,
        disabled: false,
        metadata: { creationTime: '2026-01-03T00:00:00.000Z', lastSignInTime: '2026-01-04T00:00:00.000Z' },
        customClaims: {}
      }
    ])
  }
})

const { createApp } = await import('../src/app.js')

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

describe('platform auth user listing', () => {
  it('only returns Firebase users that have a Mongo business account', async () => {
    await request(app).post('/api/v1/onboarding/business').set('Authorization', 'Bearer owner').send({
      business: { businessName: 'Faham Test Shop', businessType: 'retail', country: 'Kenya', currency: 'KES' },
      branch: { name: 'Main Branch', location: { address: '123 Test Street', city: 'Nairobi' }, contact: { phone: '+254700000000' } }
    })

    const users = await request(app).get('/api/v1/admin/firebase-auth-users?includeFirestore=true').set('Authorization', 'Bearer admin')

    expect(users.status).toBe(200)
    expect(users.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uid: 'owner_uid',
          email: 'owner@example.com',
          businessName: 'Faham Test Shop'
        })
      ])
    )
    expect(users.body.users).toHaveLength(1)
    expect(users.body.users.some((user: { uid?: string }) => user.uid === 'firebase_only_uid')).toBe(false)
    expect(users.body.stats.totalUsers).toBe(1)
  })
})
