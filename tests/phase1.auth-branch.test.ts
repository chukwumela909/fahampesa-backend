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
import { BranchModel } from '../src/models/branch.model.js'
import { OnboardingStateModel } from '../src/models/onboarding-state.model.js'
import { SettingsModel } from '../src/models/settings.model.js'
import { StaffInvitationModel } from '../src/models/staff-invitation.model.js'
import { UserModel } from '../src/models/user.model.js'

class FakeVerifier implements FirebaseTokenVerifier {
  constructor(private readonly users: Record<string, AuthUser>) {}

  async verifyIdToken(token: string): Promise<AuthUser> {
    const user = this.users[token]
    if (!user) throw new Error('invalid token')
    if (token === 'oldOwner') return user
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
  },
  oldOwner: {
    firebaseUid: 'owner_uid',
    email: 'owner@example.com',
    name: 'Owner User',
    authTime: new Date(Date.now() - 10 * 60 * 1000)
  },
  owner2: {
    firebaseUid: 'owner2_uid',
    email: 'owner2@example.com',
    name: 'Owner Two'
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

describe('Phase 1 auth, onboarding, subscription access, and branches', () => {
  it('checks whether a phone number exists without requiring a bearer token', async () => {
    await UserModel.create({ firebaseUid: 'phone_uid', phone: '+254700111222', fullName: 'Phone User' })

    const found = await request(app).get('/api/v1/auth/phone-exists?phone=%2B254700111222')
    expect(found.status).toBe(200)
    expect(found.body.data.exists).toBe(true)

    const missing = await request(app).get('/api/v1/auth/phone-exists?phone=%2B254700999888')
    expect(missing.status).toBe(200)
    expect(missing.body.data.exists).toBe(false)
  })

  it('returns a clean 400 for malformed JSON request bodies', async () => {
    const response = await request(app)
      .post('/api/v1/onboarding/business')
      .set('Authorization', 'Bearer owner')
      .set('Content-Type', 'application/json')
      .send('  ')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('invalid_json')
  })

  it('rejects requests without a bearer token', async () => {
    const response = await request(app).get('/api/v1/me')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('missing_auth_token')
  })

  it('rejects requests with an invalid bearer token', async () => {
    const response = await request(app).get('/api/v1/me').set('Authorization', 'Bearer nope')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('invalid_auth_token')
  })

  it('saves onboarding progress and allows users to skip setup before business creation', async () => {
    const initial = await request(app).get('/api/v1/onboarding/status').set('Authorization', 'Bearer owner')
    expect(initial.status).toBe(200)
    expect(initial.body.data.completed).toBe(false)
    expect(initial.body.data.currentStep).toBe(1)

    const progress = await request(app)
      .put('/api/v1/onboarding/progress')
      .set('Authorization', 'Bearer owner')
      .send({
        currentStep: 3,
        completedSteps: [1, 2],
        data: {
          personalProfile: { fullName: 'Owner User', phoneNumber: '+254700000000' }
        }
      })
    expect(progress.status).toBe(200)
    expect(progress.body.data.currentStep).toBe(3)
    expect(progress.body.data.status).toBe('in_progress')

    const skipped = await request(app)
      .post('/api/v1/onboarding/skip')
      .set('Authorization', 'Bearer owner')
      .send({ currentStep: 7, skippedSteps: [3, 4, 5, 6] })
    expect(skipped.status).toBe(200)
    expect(skipped.body.data.status).toBe('skipped')

    const finalStatus = await request(app).get('/api/v1/onboarding/status').set('Authorization', 'Bearer owner')
    expect(finalStatus.body.data.completed).toBe(true)
    expect(finalStatus.body.data.skipped).toBe(true)
    expect(finalStatus.body.data.hasBusiness).toBe(false)
  })

  it('onboards a business account with owner membership and first branch', async () => {
    const response = await onboardOwner()

    expect(response.status).toBe(201)
    expect(response.body.data.businessAccount.businessName).toBe('Faham Test Shop')
    expect(response.body.data.businessAccount.planTier).toBe('free')
    expect(response.body.data.branch.name).toBe('Main Branch')
    expect(response.body.data.membership.role).toBe('owner')

    const me = await request(app).get('/api/v1/me').set('Authorization', 'Bearer owner')
    expect(me.status).toBe(200)
    expect(me.body.data.role).toBe('owner')
    expect(me.body.data.businessAccountId).toBe(response.body.data.businessAccount.id)
  })

  it('onboards with personal profile, legal company data, and staff invitations', async () => {
    const response = await request(app)
      .post('/api/v1/onboarding/business')
      .set('Authorization', 'Bearer owner')
      .send({
        personalProfile: {
          fullName: 'Amina Owner',
          phoneNumber: '+254700123456',
          phoneVerified: true
        },
        companyProfile: {
          legalCompanyName: 'Amina Retail Limited',
          registrationNumber: 'C123456789'
        },
        business: {
          businessName: 'Amina Shop',
          businessType: 'retail',
          country: 'Kenya',
          currency: 'KES'
        },
        branch: {
          name: 'Amina Main',
          location: { address: '456 Retail Street', city: 'Nairobi' },
          contact: { phone: '+254700123456' }
        },
        staffInvitations: [
          { email: 'manager@example.com', role: 'admin' },
          { email: 'cashier@example.com', role: 'staff' }
        ]
      })

    expect(response.status).toBe(201)
    expect(response.body.data.businessAccount.legalCompanyName).toBe('Amina Retail Limited')
    expect(response.body.data.businessAccount.registrationNumber).toBe('C123456789')
    expect(response.body.data.staffInvitations).toHaveLength(2)
    expect(response.body.data.staffInvitations[0].inviteUrl).toContain('/staff/invite?token=')
    expect(response.body.data.staffInvitations[0].tokenHash).toBeUndefined()

    const user = await UserModel.findOne({ firebaseUid: 'owner_uid' }).orFail()
    expect(user.fullName).toBe('Amina Owner')
    expect(user.phone).toBe('+254700123456')
    expect(user.phoneVerified).toBe(true)

    const settings = await SettingsModel.findOne({ businessAccountId: response.body.data.businessAccount.id }).orFail()
    expect(settings.businessProfile.companyLegalName).toBe('Amina Retail Limited')
    expect(settings.businessProfile.companyRegistrationNumber).toBe('C123456789')

    const invitations = await StaffInvitationModel.find({ businessAccountId: response.body.data.businessAccount.id }).sort({ email: 1 }).select('+tokenHash')
    expect(invitations.map((invitation) => invitation.role)).toEqual(['cashier', 'manager'])
    expect(invitations.every((invitation) => invitation.tokenHash)).toBe(true)
    expect(invitations.every((invitation) => invitation.status === 'pending')).toBe(true)
    expect(invitations.every((invitation) => invitation.expiresAt.getTime() > Date.now())).toBe(true)
    expect(invitations.every((invitation) => invitation.assignedBranchIds.map(String).includes(response.body.data.branch.id))).toBe(true)

    const state = await OnboardingStateModel.findOne({ userId: user._id }).orFail()
    expect(state.status).toBe('completed')
    expect(state.currentStep).toBe(7)
  })

  it('prevents duplicate active owner onboarding for the same Firebase UID', async () => {
    await onboardOwner()

    const duplicate = await onboardOwner()
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('business_already_exists')
  })

  it('enforces free and paid branch limits', async () => {
    await onboardOwner()

    const freeCreate = await createBranch('Second Branch', 'BR002')
    expect(freeCreate.status).toBe(403)
    expect(freeCreate.body.error.code).toBe('branch_limit_reached')

    await BusinessAccountModel.updateOne({}, { $set: { planTier: 'paid', subscriptionStatus: 'active', subscriptionEndsAt: futureDate() } })

    for (let i = 2; i <= 6; i += 1) {
      const response = await createBranch(`Branch ${i}`, `BR00${i}`)
      expect(response.status).toBe(201)
    }

    const seventh = await createBranch('Branch 7', 'BR007')
    expect(seventh.status).toBe(403)

    await BusinessAccountModel.updateOne({}, { $set: { branchLimitOverride: 7 } })
    const override = await createBranch('Branch 7', 'BR007')
    expect(override.status).toBe(201)
  })

  it('treats blank branch codes as omitted during branch creation', async () => {
    await onboardOwner()
    await BusinessAccountModel.updateOne({}, { $set: { planTier: 'paid', subscriptionStatus: 'active', subscriptionEndsAt: futureDate() } })

    const firstBlankCode = await createBranch('Second Branch', '')
    expect(firstBlankCode.status).toBe(201)
    expect(firstBlankCode.body.data.branchCode).toBeUndefined()

    const secondBlankCode = await createBranch('Third Branch', '   ')
    expect(secondBlankCode.status).toBe(201)
    expect(secondBlankCode.body.data.branchCode).toBeUndefined()

    const branches = await BranchModel.find({ name: { $in: ['Second Branch', 'Third Branch'] } }).sort({ createdAt: 1 })
    expect(branches).toHaveLength(2)
    expect(branches.every((branch) => branch.branchCode === undefined)).toBe(true)
  })

  it('allows reads but blocks writes when paid subscription is expired', async () => {
    await onboardOwner()
    await BusinessAccountModel.updateOne({}, { $set: { planTier: 'paid', subscriptionStatus: 'active', subscriptionEndsAt: pastDate() } })

    const list = await request(app).get('/api/v1/branches').set('Authorization', 'Bearer owner')
    expect(list.status).toBe(200)
    expect(list.body.data).toHaveLength(1)

    const write = await createBranch('Blocked Branch', 'BLOCK')
    expect(write.status).toBe(402)
    expect(write.body.error.code).toBe('account_read_only')
  })

  it('allows reads but blocks writes when account is paused', async () => {
    await onboardOwner()
    await BusinessAccountModel.updateOne({}, { $set: { accountStatus: 'paused' } })

    const list = await request(app).get('/api/v1/branches').set('Authorization', 'Bearer owner')
    expect(list.status).toBe(200)

    const write = await createBranch('Paused Branch', 'PAUSED')
    expect(write.status).toBe(423)
    expect(write.body.error.code).toBe('account_read_only')
  })

  it('limits manager and cashier branch lists to assigned branches', async () => {
    const onboarded = await onboardOwner()
    await BusinessAccountModel.updateOne({}, { $set: { planTier: 'paid', subscriptionStatus: 'active', subscriptionEndsAt: futureDate() } })

    const second = await createBranch('Second Branch', 'BR002')
    expect(second.status).toBe(201)

    const businessAccountId = onboarded.body.data.businessAccount.id
    const ownerUser = await UserModel.findOne({ firebaseUid: 'owner_uid' }).orFail()
    const managerUser = await UserModel.create({ firebaseUid: 'manager_uid', email: 'manager@example.com', fullName: 'Manager User' })
    const cashierUser = await UserModel.create({ firebaseUid: 'cashier_uid', email: 'cashier@example.com', fullName: 'Cashier User' })

    await BusinessMembershipModel.create({
      businessAccountId,
      userId: managerUser._id,
      role: 'manager',
      assignedBranchIds: [second.body.data.id],
      permissions: [],
      createdBy: ownerUser._id
    })
    await BusinessMembershipModel.create({
      businessAccountId,
      userId: cashierUser._id,
      role: 'cashier',
      assignedBranchIds: [onboarded.body.data.branch.id],
      permissions: [],
      createdBy: ownerUser._id
    })

    const managerBranches = await request(app).get('/api/v1/branches').set('Authorization', 'Bearer manager')
    expect(managerBranches.status).toBe(200)
    expect(managerBranches.body.data).toHaveLength(1)
    expect(managerBranches.body.data[0].name).toBe('Second Branch')

    const cashierBranches = await request(app).get('/api/v1/branches').set('Authorization', 'Bearer cashier')
    expect(cashierBranches.status).toBe(200)
    expect(cashierBranches.body.data).toHaveLength(1)
    expect(cashierBranches.body.data[0].name).toBe('Main Branch')
  })

  it('prevents access to branches from another business account', async () => {
    await onboardOwner()
    const secondBusiness = await request(app).post('/api/v1/onboarding/business').set('Authorization', 'Bearer owner2').send({
      business: {
        businessName: 'Other Business',
        businessType: 'retail',
        country: 'Kenya',
        currency: 'KES'
      },
      branch: {
        name: 'Other Main',
        location: { address: 'Other Street', city: 'Nairobi' }
      }
    })
    expect(secondBusiness.status).toBe(201)

    const crossTenant = await request(app)
      .get(`/api/v1/branches/${secondBusiness.body.data.branch.id}`)
      .set('Authorization', 'Bearer owner')

    expect(crossTenant.status).toBe(404)
  })

  it('disables and re-enables a branch with recent reauthentication', async () => {
    const onboarded = await onboardOwner()
    await BusinessAccountModel.updateOne({}, { $set: { planTier: 'paid', subscriptionStatus: 'active', subscriptionEndsAt: futureDate() } })

    const stale = await request(app)
      .post(`/api/v1/branches/${onboarded.body.data.branch.id}/disable`)
      .set('Authorization', 'Bearer oldOwner')
    expect(stale.status).toBe(403)
    expect(stale.body.error.code).toBe('recent_reauth_required')

    const disabled = await request(app)
      .post(`/api/v1/branches/${onboarded.body.data.branch.id}/disable`)
      .set('Authorization', 'Bearer owner')
    expect(disabled.status).toBe(200)
    expect(disabled.body.data.status).toBe('disabled')

    const list = await request(app).get('/api/v1/branches').set('Authorization', 'Bearer owner')
    expect(list.body.data).toHaveLength(0)

    const enabled = await request(app)
      .post(`/api/v1/branches/${onboarded.body.data.branch.id}/enable`)
      .set('Authorization', 'Bearer owner')
    expect(enabled.status).toBe(200)
    expect(enabled.body.data.status).toBe('active')
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

function futureDate() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
}

function pastDate() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000)
}
