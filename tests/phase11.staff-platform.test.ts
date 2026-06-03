import path from 'node:path'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../src/app.js'
import type { AuthUser } from '../src/types/http.js'
import type { FirebaseTokenVerifier } from '../src/config/firebase.js'
import { StaffInvitationModel } from '../src/models/staff-invitation.model.js'

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
  cashier: { firebaseUid: 'cashier_uid', email: 'cashier@example.com', name: 'Cashier User' },
  invitee: { firebaseUid: 'invitee_uid', email: 'invitee@example.com', name: 'Invited User' },
  wrongInvitee: { firebaseUid: 'wrong_invitee_uid', email: 'wrong@example.com', name: 'Wrong User' },
  cancelledInvitee: { firebaseUid: 'cancelled_invitee_uid', email: 'cancelled@example.com', name: 'Cancelled User' },
  expiredInvitee: { firebaseUid: 'expired_invitee_uid', email: 'expired@example.com', name: 'Expired User' },
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

describe('Staff, platform admin utilities, and notifications', () => {
  it('manages business staff, activity logs, and two-factor setup', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id

    const created = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', 'Bearer owner')
      .send({
        firebaseUid: 'manager_uid',
        email: 'manager@example.com',
        fullName: 'Manager User',
        phone: '+254700111222',
        role: 'manager',
        branchIds: [branchId],
        permissions: ['inventory:read']
      })

    expect(created.status).toBe(201)
    expect(created.body.data.role).toBe('manager')
    expect(created.body.data.email).toBe('manager@example.com')

    const staffId = created.body.data.id
    const updated = await request(app)
      .patch(`/api/v1/staff/${staffId}`)
      .set('Authorization', 'Bearer owner')
      .send({ phone: '+254700333444', permissions: ['inventory:read', 'sales:read'] })
    expect(updated.status).toBe(200)
    expect(updated.body.data.phone).toBe('+254700333444')

    const listed = await request(app).get('/api/v1/staff').set('Authorization', 'Bearer owner')
    expect(listed.status).toBe(200)
    expect(listed.body.data).toHaveLength(2)

    const logs = await request(app).get('/api/v1/staff/logs').set('Authorization', 'Bearer owner')
    expect(logs.status).toBe(200)
    expect(logs.body.data.some((log: { action: string }) => log.action === 'staff_created')).toBe(true)

    const setup = await request(app).post('/api/v1/staff/2fa/setup').set('Authorization', 'Bearer owner')
    expect(setup.status).toBe(200)
    expect(setup.body.data.secret).toBeTruthy()
    expect(setup.body.data.otpauthUrl).toContain('otpauth://totp/')
  })

  it('creates, lists, cancels, and accepts staff invitations with constrained dashboard access', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id

    const created = await request(app)
      .post('/api/v1/staff/invitations')
      .set('Authorization', 'Bearer owner')
      .send({
        email: 'invitee@example.com',
        role: 'cashier',
        branchIds: [branchId],
        permissions: ['sales:read']
      })

    expect(created.status).toBe(201)
    expect(created.body.data.email).toBe('invitee@example.com')
    expect(created.body.data.role).toBe('cashier')
    expect(created.body.data.assignedBranchIds).toEqual([branchId])
    expect(created.body.data.inviteUrl).toContain('/staff/invite?token=')
    expect(created.body.data.tokenHash).toBeUndefined()

    const stored = await StaffInvitationModel.findById(created.body.data.id).select('+tokenHash').orFail()
    expect(stored.tokenHash).toBeTruthy()
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const listed = await request(app).get('/api/v1/staff/invitations?status=pending').set('Authorization', 'Bearer owner')
    expect(listed.status).toBe(200)
    expect(listed.body.data).toHaveLength(1)
    expect(listed.body.data[0].tokenHash).toBeUndefined()

    const token = tokenFromInviteUrl(created.body.data.inviteUrl)
    const mismatch = await request(app)
      .post('/api/v1/staff/invitations/accept')
      .set('Authorization', 'Bearer wrongInvitee')
      .send({ token })
    expect(mismatch.status).toBe(403)
    expect(mismatch.body.error.code).toBe('invitation_email_mismatch')

    const accepted = await request(app)
      .post('/api/v1/staff/invitations/accept')
      .set('Authorization', 'Bearer invitee')
      .send({ token })
    expect(accepted.status).toBe(200)
    expect(accepted.body.data.role).toBe('cashier')
    expect(accepted.body.data.assignedBranchIds).toEqual([branchId])

    const me = await request(app).get('/api/v1/me').set('Authorization', 'Bearer invitee')
    expect(me.status).toBe(200)
    expect(me.body.data.businessAccountId).toBe(onboarded.body.data.businessAccount.id)
    expect(me.body.data.role).toBe('cashier')
    expect(me.body.data.assignedBranchIds).toEqual([branchId])

    const reused = await request(app)
      .post('/api/v1/staff/invitations/accept')
      .set('Authorization', 'Bearer invitee')
      .send({ token })
    expect(reused.status).toBe(409)
    expect(reused.body.error.code).toBe('invitation_already_accepted')

    const cancelCreated = await request(app)
      .post('/api/v1/staff/invitations')
      .set('Authorization', 'Bearer owner')
      .send({ email: 'cancelled@example.com', role: 'manager', branchIds: [branchId] })
    expect(cancelCreated.status).toBe(201)

    const cancelled = await request(app)
      .post(`/api/v1/staff/invitations/${cancelCreated.body.data.id}/cancel`)
      .set('Authorization', 'Bearer owner')
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data.status).toBe('cancelled')

    const cancelledAccept = await request(app)
      .post('/api/v1/staff/invitations/accept')
      .set('Authorization', 'Bearer cancelledInvitee')
      .send({ token: tokenFromInviteUrl(cancelCreated.body.data.inviteUrl) })
    expect(cancelledAccept.status).toBe(410)
    expect(cancelledAccept.body.error.code).toBe('invitation_cancelled')

    const expiredCreated = await request(app)
      .post('/api/v1/staff/invitations')
      .set('Authorization', 'Bearer owner')
      .send({ email: 'expired@example.com', role: 'cashier', branchIds: [branchId] })
    expect(expiredCreated.status).toBe(201)
    await StaffInvitationModel.updateOne({ _id: expiredCreated.body.data.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } })

    const expired = await request(app)
      .post('/api/v1/staff/invitations/accept')
      .set('Authorization', 'Bearer expiredInvitee')
      .send({ token: tokenFromInviteUrl(expiredCreated.body.data.inviteUrl) })
    expect(expired.status).toBe(410)
    expect(expired.body.error.code).toBe('invitation_expired')

    const invalid = await request(app)
      .post('/api/v1/staff/invitations/accept')
      .set('Authorization', 'Bearer invitee')
      .send({ token: 'invalid-token' })
    expect(invalid.status).toBe(404)
    expect(invalid.body.error.code).toBe('invitation_not_found')
  })

  it('prevents cashiers from managing staff invitations', async () => {
    const onboarded = await onboardOwner()
    const branchId = onboarded.body.data.branch.id

    const created = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', 'Bearer owner')
      .send({
        firebaseUid: 'cashier_uid',
        email: 'cashier@example.com',
        fullName: 'Cashier User',
        role: 'cashier',
        branchIds: [branchId],
        permissions: ['sales:read']
      })
    expect(created.status).toBe(201)

    const list = await request(app).get('/api/v1/staff/invitations').set('Authorization', 'Bearer cashier')
    expect(list.status).toBe(403)
    expect(list.body.error.code).toBe('manager_required')

    const invite = await request(app)
      .post('/api/v1/staff/invitations')
      .set('Authorization', 'Bearer cashier')
      .send({ email: 'invitee@example.com', role: 'cashier', branchIds: [branchId] })
    expect(invite.status).toBe(403)
    expect(invite.body.error.code).toBe('manager_required')
  })

  it('exposes platform admin user utilities backed by Mongo data', async () => {
    const onboarded = await onboardOwner()
    const userId = onboarded.body.data.membership.userId

    const users = await request(app).get('/api/v1/admin/firebase-auth-users?includeFirestore=true').set('Authorization', 'Bearer admin')
    expect(users.status).toBe(200)
    expect(users.body.success).toBe(true)
    expect(users.body.users.some((user: { email?: string }) => user.email === 'owner@example.com')).toBe(true)

    const stats = await request(app).get('/api/v1/admin/user-stats').set('Authorization', 'Bearer admin')
    expect(stats.status).toBe(200)
    expect(stats.body.stats.total).toBeGreaterThan(0)

    const disabled = await request(app)
      .post(`/api/v1/admin/users/${userId}/disable`)
      .set('Authorization', 'Bearer admin')
      .send({ disabled: true })
    expect(disabled.status).toBe(200)
    expect(disabled.body.user.disabled).toBe(true)
  })

  it('persists platform settings, admin users, and notification announcements', async () => {
    const defaults = await request(app).get('/api/v1/admin/settings/platform').set('Authorization', 'Bearer admin')
    expect(defaults.status).toBe(200)
    expect(defaults.body.isDefault).toBe(true)

    const saved = await request(app)
      .post('/api/v1/admin/settings/platform')
      .set('Authorization', 'Bearer admin')
      .send({
        platformName: 'FahamPesa',
        timezone: 'Africa/Lagos',
        defaultLanguage: 'English',
        dataRetentionDays: 180,
        backupFrequency: 'Daily'
      })
    expect(saved.status).toBe(200)
    expect(saved.body.settings.platformName).toBe('FahamPesa')

    const adminUser = await request(app)
      .post('/api/v1/admin/settings/admin-users')
      .set('Authorization', 'Bearer admin')
      .send({ action: 'create', name: 'Viewer User', email: 'viewer@example.com', role: 'viewer' })
    expect(adminUser.status).toBe(201)
    expect(adminUser.body.adminUser.email).toBe('viewer@example.com')

    await onboardOwner()
    const sent = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', 'Bearer admin')
      .send({
        announcementId: 'release-1',
        announcement: {
          title: 'Release',
          message: 'New release is available',
          type: 'info',
          channel: 'email',
          targetAudience: 'all'
        }
      })
    expect(sent.status).toBe(200)
    expect(sent.body.recipientCount).toBeGreaterThan(0)

    const history = await request(app).get('/api/v1/notifications/send').set('Authorization', 'Bearer admin')
    expect(history.status).toBe(200)
    expect(history.body.announcements).toHaveLength(1)
  })
})

function onboardOwner() {
  return request(app).post('/api/v1/onboarding/business').set('Authorization', 'Bearer owner').send({
    business: { businessName: 'Faham Test Shop', businessType: 'retail', country: 'Kenya', currency: 'KES' },
    branch: { name: 'Main Branch', location: { address: '123 Test Street', city: 'Nairobi' }, contact: { phone: '+254700000000' } }
  })
}

function tokenFromInviteUrl(inviteUrl: string) {
  const token = new URL(inviteUrl).searchParams.get('token')
  if (!token) throw new Error('missing invite token')
  return token
}
