import { Types } from 'mongoose'
import { createFirebaseSuperAdmin, listFirebaseAuthUsers, setFirebaseAuthUserDisabled } from '../config/firebase.js'
import { BusinessAccountModel } from '../models/business-account.model.js'
import { BusinessMembershipModel } from '../models/business-membership.model.js'
import { NotificationAnnouncementModel } from '../models/notification-announcement.model.js'
import { PlatformAdminUserModel } from '../models/platform-admin-user.model.js'
import { PlatformSettingModel } from '../models/platform-setting.model.js'
import { SubscriptionModel } from '../models/subscription.model.js'
import { UserModel } from '../models/user.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'

const defaultPlatformSettings = {
  platformName: 'FahamPesa System',
  timezone: 'Africa/Nairobi (EAT)',
  defaultLanguage: 'English',
  dataRetentionDays: 365,
  backupFrequency: 'Daily'
}

const defaultNotificationSettings = {
  emailEnabled: true,
  pushEnabled: true,
  slackEnabled: false,
  webhookUrl: '',
  alertThresholds: {
    userDropPercentage: 20,
    errorRatePercentage: 5,
    crashRatePercentage: 2
  }
}

const defaultIntegrationSettings = {
  firebase: { enabled: true, projectId: 'fahampesa-8c514', status: 'connected' },
  mixpanel: { enabled: false, projectToken: '', status: 'disconnected' },
  posthog: { enabled: false, apiKey: '', hostUrl: 'https://app.posthog.com', status: 'disconnected' }
}

export async function listEnhancedAuthUsers(context: RequestContext, input: { email?: string; includeFirestore?: boolean }) {
  requirePlatformAdmin(context)
  let firebaseUsers: Record<string, unknown>[] = []
  let source = 'Mongo users'
  let warning: string | undefined

  try {
    firebaseUsers = await listFirebaseAuthUsers(input.email)
    source = 'Firebase Authentication via Admin SDK'
  } catch (error) {
    warning = error instanceof Error ? error.message : 'Firebase Auth user listing unavailable'
  }

  const localUsers = await localAuthUsers({
    email: input.email,
    firebaseUids: input.email ? firebaseUsers.map((user) => String(user.uid)).filter(Boolean) : undefined
  })
  const usersByUid = new Map<string, Record<string, unknown>>()
  for (const user of localUsers) usersByUid.set(String(user.uid), user)
  for (const user of firebaseUsers) {
    const uid = String(user.uid)
    if (!usersByUid.has(uid)) continue
    usersByUid.set(uid, { ...(usersByUid.get(uid) ?? {}), ...user })
  }

  const users = [...usersByUid.values()].sort((a, b) => dateValue(b.metadata, 'creationTime') - dateValue(a.metadata, 'creationTime'))
  return {
    success: true,
    timestamp: new Date().toISOString(),
    stats: userStats(users),
    users,
    totalCount: users.length,
    source,
    searchedEmail: input.email ?? null,
    includeFirestoreData: input.includeFirestore ?? false,
    warning
  }
}

export async function disablePlatformUser(context: RequestContext, id: string, disabled: boolean) {
  requirePlatformAdmin(context)
  const user = await UserModel.findOne({ $or: [{ _id: Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined }, { firebaseUid: id }] })
  if (!user) throw notFound('User not found')
  user.disabled = disabled
  user.disabledAt = disabled ? new Date() : null
  await user.save()
  await BusinessMembershipModel.updateMany({ userId: user._id }, { $set: { status: disabled ? 'suspended' : 'active' } })

  let firebaseUser: unknown
  try {
    firebaseUser = await setFirebaseAuthUserDisabled(user.firebaseUid, disabled)
  } catch {
    firebaseUser = null
  }

  return {
    success: true,
    message: `User ${disabled ? 'disabled' : 'enabled'} successfully`,
    user: normalizeMongo(user.toObject({ versionKey: false })),
    firebaseUser
  }
}

export async function createSuperAdminUser(context: RequestContext | undefined, input: { email: string; password?: string; displayName: string }) {
  let firebaseUser: unknown
  try {
    firebaseUser = await createFirebaseSuperAdmin(input.email, input.password, input.displayName)
  } catch {
    firebaseUser = null
  }

  const user = await UserModel.findOneAndUpdate(
    { email: input.email.toLowerCase() },
    {
      $setOnInsert: { firebaseUid: firebaseUserUid(firebaseUser) ?? `admin:${input.email.toLowerCase()}` },
      $set: { email: input.email.toLowerCase(), fullName: input.displayName, platformRole: 'admin', disabled: false, disabledAt: null }
    },
    { new: true, upsert: true }
  )

  await PlatformAdminUserModel.findOneAndUpdate(
    { email: input.email.toLowerCase() },
    {
      $set: {
        name: input.displayName,
        role: 'super_admin',
        status: 'active',
        createdBy: context?.userId
      }
    },
    { upsert: true, new: true }
  )

  return {
    success: true,
    message: 'Super admin created successfully',
    user: normalizeMongo(user.toObject({ versionKey: false })),
    firebaseUser
  }
}

export async function getUserStatistics(context: RequestContext) {
  requirePlatformAdmin(context)
  const users = await localAuthUsers({})
  const now = Date.now()
  const dayAgo = now - 24 * 60 * 60 * 1000
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000
  const activeUsers = users.filter((user) => !user.disabled)
  const regions = aggregateRegions(users)
  return {
    success: true,
    timestamp: new Date().toISOString(),
    stats: {
      total: users.length,
      active: activeUsers.length,
      disabled: users.length - activeUsers.length,
      activeToday: users.filter((user) => dateValue(user.metadata, 'lastSignInTime') >= dayAgo).length,
      activeThisWeek: users.filter((user) => dateValue(user.metadata, 'lastSignInTime') >= weekAgo).length,
      activeThisMonth: users.filter((user) => dateValue(user.metadata, 'lastSignInTime') >= monthAgo).length,
      newThisWeek: users.filter((user) => dateValue(user.metadata, 'creationTime') >= weekAgo).length,
      newThisMonth: users.filter((user) => dateValue(user.metadata, 'creationTime') >= monthAgo).length,
      uniqueRegions: regions.length,
      regions,
      breakdown: {
        withEmail: users.filter((user) => user.email).length,
        withDisplayName: users.filter((user) => user.displayName).length,
        recentlyCreated: users.filter((user) => dateValue(user.metadata, 'creationTime') >= weekAgo).length
      },
      sampleUsers: users.slice(0, 5)
    }
  }
}

export async function getPlatformSetting(context: RequestContext, key: 'platform' | 'notifications' | 'integrations') {
  requirePlatformAdmin(context)
  const found = await PlatformSettingModel.findOne({ key })
  return {
    success: true,
    settings: found ? normalizeMongo(found.settings) : defaultForSetting(key),
    isDefault: !found
  }
}

export async function updatePlatformSetting(context: RequestContext, key: 'platform' | 'notifications' | 'integrations', settings: Record<string, unknown>) {
  requirePlatformAdmin(context)
  const updated = await PlatformSettingModel.findOneAndUpdate(
    { key },
    { $set: { settings, updatedBy: context.userId } },
    { new: true, upsert: true }
  )
  return {
    success: true,
    message: `${key} settings updated successfully`,
    settings: normalizeMongo(updated.settings)
  }
}

export async function listPlatformAdminUsers(context: RequestContext) {
  requirePlatformAdmin(context)
  const admins = await PlatformAdminUserModel.find({}).sort({ createdAt: -1 })
  const adminUsers = admins.map((admin) => normalizeMongo(admin.toObject({ versionKey: false })))
  return {
    success: true,
    adminUsers,
    total: admins.length,
    active: admins.filter((admin) => admin.status === 'active').length,
    byRole: {
      super_admin: admins.filter((admin) => admin.role === 'super_admin').length,
      admin: admins.filter((admin) => admin.role === 'admin').length,
      viewer: admins.filter((admin) => admin.role === 'viewer').length
    }
  }
}

export async function managePlatformAdminUser(
  context: RequestContext,
  input:
    | { action: 'create'; name: string; email: string; role: 'super_admin' | 'admin' | 'viewer'; createdBy?: string }
    | { action: 'update'; id: string; name?: string; email?: string; role?: 'super_admin' | 'admin' | 'viewer'; status?: 'active' | 'inactive' }
    | { action: 'delete'; id: string }
) {
  requirePlatformAdmin(context)
  if (input.action === 'delete') {
    await PlatformAdminUserModel.findByIdAndDelete(input.id)
    return { success: true, message: 'Admin user deleted successfully' }
  }

  if (input.action === 'update') {
    const updated = await PlatformAdminUserModel.findByIdAndUpdate(input.id, { $set: input }, { new: true })
    if (!updated) throw notFound('Admin user not found')
    return { success: true, message: 'Admin user updated successfully', adminUser: normalizeMongo(updated.toObject({ versionKey: false })) }
  }

  const admin = await PlatformAdminUserModel.create({
    name: input.name,
    email: input.email.toLowerCase(),
    role: input.role,
    createdBy: context.userId
  })
  return { success: true, message: 'Admin user created successfully', adminUser: normalizeMongo(admin.toObject({ versionKey: false })) }
}

export async function sendAnnouncement(context: RequestContext, input: { announcementId: string; announcement: Record<string, unknown> }) {
  requirePlatformAdmin(context)
  const recipientCount = await countRecipients(String(input.announcement.targetAudience ?? 'all'))
  const announcement = await NotificationAnnouncementModel.findOneAndUpdate(
    { announcementId: input.announcementId },
    {
      $set: {
        title: input.announcement.title,
        message: input.announcement.message,
        type: input.announcement.type,
        channel: input.announcement.channel,
        targetAudience: input.announcement.targetAudience,
        payload: input.announcement,
        recipientCount,
        sentBy: context.userId
      }
    },
    { upsert: true, new: true }
  )
  return { success: true, recipientCount, announcement: normalizeMongo(announcement.toObject({ versionKey: false })) }
}

export async function listAnnouncements(context: RequestContext, announcementId?: string) {
  requirePlatformAdmin(context)
  if (announcementId) {
    const announcement = await NotificationAnnouncementModel.findOne({ announcementId })
    if (!announcement) throw notFound('Announcement not found')
    return { success: true, announcement: normalizeMongo(announcement.toObject({ versionKey: false })) }
  }
  const announcements = await NotificationAnnouncementModel.find({}).sort({ createdAt: -1 }).limit(100)
  return { success: true, announcements: announcements.map((announcement) => normalizeMongo(announcement.toObject({ versionKey: false }))) }
}

export async function listNotificationRecipients(context: RequestContext, audience?: string) {
  requirePlatformAdmin(context)
  const users = await localAuthUsers({})
  return {
    success: true,
    recipients: users.filter((user) => matchesAudience(user, audience ?? 'all')),
    total: users.length
  }
}

async function localAuthUsers(input: { email?: string; firebaseUids?: string[] }) {
  const query: Record<string, unknown> = {}
  const filters: Record<string, unknown>[] = []
  if (input.email) filters.push({ email: new RegExp(escapeRegex(input.email), 'i') })
  if (input.firebaseUids?.length) filters.push({ firebaseUid: { $in: input.firebaseUids } })
  if (filters.length === 1) Object.assign(query, filters[0])
  if (filters.length > 1) query.$or = filters
  const users = await UserModel.find(query).sort({ createdAt: -1 })
  const memberships = await BusinessMembershipModel.find({ userId: { $in: users.map((user) => user._id) } })
  const accounts = await BusinessAccountModel.find({ _id: { $in: memberships.map((membership) => membership.businessAccountId) } })
  const subscriptions = await SubscriptionModel.find({ businessAccountId: { $in: accounts.map((account) => account._id) } }).sort({ createdAt: -1 })
  const accountById = new Map(accounts.map((account) => [account._id.toString(), account]))
  const membershipByUserId = new Map(
    memberships
      .filter((membership) => accountById.has(membership.businessAccountId.toString()))
      .map((membership) => [membership.userId.toString(), membership])
  )

  return users.flatMap((user) => {
    const membership = membershipByUserId.get(user._id.toString())
    const account = membership ? accountById.get(membership.businessAccountId.toString()) : undefined
    if (!account) return []
    const subscription = account ? subscriptions.find((item) => item.businessAccountId.toString() === account._id.toString()) : undefined
    return [{
      uid: user.firebaseUid,
      id: user._id.toString(),
      email: user.email,
      displayName: user.fullName,
      phoneNumber: user.phone,
      emailVerified: user.phoneVerified,
      disabled: user.disabled,
      platformRole: user.platformRole,
      metadata: {
        creationTime: user.createdAt?.toISOString(),
        lastSignInTime: user.lastLoginAt?.toISOString()
      },
      firestoreData: normalizeMongo(user.toObject({ versionKey: false })),
      businessName: account?.businessName,
      businessType: account?.businessType,
      country: account?.country ?? null,
      billingRegion: account?.billingRegion ?? null,
      isSubscribed: account?.subscriptionStatus === 'active',
      subscriptionId: subscription?._id.toString() ?? null,
      subscriptionEndDate: account?.subscriptionEndsAt?.getTime() ?? null,
      planType: account?.planType ?? null
    }]
  })
}

function requirePlatformAdmin(context: RequestContext) {
  if (context.auth.platformRole !== 'admin') throw new ApiError(403, 'platform_admin_required', 'Platform admin access is required')
}

function defaultForSetting(key: 'platform' | 'notifications' | 'integrations') {
  if (key === 'platform') return defaultPlatformSettings
  if (key === 'notifications') return defaultNotificationSettings
  return defaultIntegrationSettings
}

function userStats(users: Record<string, unknown>[]) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  return {
    totalUsers: users.length,
    activeUsers: users.filter((user) => !user.disabled).length,
    disabledUsers: users.filter((user) => user.disabled).length,
    verifiedEmails: users.filter((user) => user.emailVerified).length,
    usersWithFirestoreData: users.filter((user) => user.firestoreData).length,
    recentUsers: users.filter((user) => dateValue(user.metadata, 'creationTime') >= weekAgo).length,
    subscribedUsers: users.filter((user) => user.isSubscribed).length,
    freeUsers: users.filter((user) => !user.isSubscribed).length,
    monthlySubscribers: users.filter((user) => user.planType === 'monthly').length,
    yearlySubscribers: users.filter((user) => user.planType === 'yearly').length
  }
}

function aggregateRegions(users: Record<string, unknown>[]) {
  const counts = new Map<string, number>()
  for (const user of users) {
    const country = typeof user.country === 'string' ? user.country.trim() : ''
    if (!country) continue
    counts.set(country, (counts.get(country) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region))
}

async function countRecipients(audience: string) {
  const users = await localAuthUsers({})
  return users.filter((user) => matchesAudience(user, audience)).length
}

function matchesAudience(user: Record<string, unknown>, audience: string) {
  if (audience === 'all' || audience === 'all_users') return true
  if (audience === 'subscribed' || audience === 'paid_users') return user.isSubscribed === true
  if (audience === 'free' || audience === 'free_users') return user.isSubscribed !== true
  if (audience === 'disabled') return user.disabled === true
  return true
}

function dateValue(metadata: unknown, key: string) {
  const value = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>)[key] : undefined
  if (!value) return 0
  return new Date(String(value)).getTime() || 0
}

function firebaseUserUid(firebaseUser: unknown) {
  if (firebaseUser && typeof firebaseUser === 'object' && 'uid' in firebaseUser) return String((firebaseUser as { uid: unknown }).uid)
  return undefined
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
