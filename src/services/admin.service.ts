import type { Types } from 'mongoose'
import { AuditLogModel } from '../models/audit-log.model.js'
import { BranchModel } from '../models/branch.model.js'
import { BusinessAccountModel } from '../models/business-account.model.js'
import { PaymentEventModel } from '../models/payment-event.model.js'
import { SubscriptionModel } from '../models/subscription.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'
import { withTransaction } from '../config/database.js'
import { writeAuditLog } from './audit.service.js'

export async function searchBusinesses(context: RequestContext, input: { q?: string; status?: 'active' | 'paused' | 'revoked' }) {
  requirePlatformAdmin(context)
  const query: Record<string, unknown> = {}
  if (input.status) query.accountStatus = input.status
  if (input.q) query.businessName = new RegExp(escapeRegex(input.q), 'i')
  const accounts = await BusinessAccountModel.find(query).sort({ createdAt: -1 }).limit(100)
  return accounts.map((account) => normalizeMongo(account.toObject({ versionKey: false })))
}

export async function getBusinessDetail(context: RequestContext, businessAccountId: Types.ObjectId) {
  requirePlatformAdmin(context)
  const account = await BusinessAccountModel.findById(businessAccountId)
  if (!account) throw notFound('Business account not found')
  const [branches, subscriptions, paymentEvents] = await Promise.all([
    BranchModel.find({ businessAccountId }).sort({ createdAt: 1 }),
    SubscriptionModel.find({ businessAccountId }).sort({ createdAt: -1 }).limit(10),
    PaymentEventModel.find({ businessAccountId }).sort({ createdAt: -1 }).limit(10)
  ])
  return {
    account: normalizeMongo(account.toObject({ versionKey: false })),
    branches: branches.map((branch) => normalizeMongo(branch.toObject({ versionKey: false }))),
    subscriptions: subscriptions.map((subscription) => normalizeMongo(subscription.toObject({ versionKey: false }))),
    paymentEvents: paymentEvents.map((event) => normalizeMongo(event.toObject({ versionKey: false })))
  }
}

export async function setAccountStatus(
  context: RequestContext,
  businessAccountId: Types.ObjectId,
  status: 'active' | 'paused' | 'revoked',
  requestMeta?: { ipAddress?: string; userAgent?: string }
) {
  requirePlatformAdmin(context)
  const account = await BusinessAccountModel.findByIdAndUpdate(businessAccountId, { $set: { accountStatus: status } }, { new: true })
  if (!account) throw notFound('Business account not found')
  await logAdminAction(context, businessAccountId, `business.${status}`, 'business_account', businessAccountId, { accountStatus: status }, requestMeta)
  return normalizeMongo(account.toObject({ versionKey: false }))
}

export async function setBranchLimitOverride(
  context: RequestContext,
  businessAccountId: Types.ObjectId,
  branchLimitOverride: number | null,
  requestMeta?: { ipAddress?: string; userAgent?: string }
) {
  requirePlatformAdmin(context)
  const account = await BusinessAccountModel.findByIdAndUpdate(businessAccountId, { $set: { branchLimitOverride } }, { new: true })
  if (!account) throw notFound('Business account not found')
  await logAdminAction(context, businessAccountId, 'business.branch_limit_override', 'business_account', businessAccountId, { branchLimitOverride }, requestMeta)
  return normalizeMongo(account.toObject({ versionKey: false }))
}

export async function extendSubscription(
  context: RequestContext,
  businessAccountId: Types.ObjectId,
  input: { days: number; reason?: string },
  requestMeta?: { ipAddress?: string; userAgent?: string }
) {
  requirePlatformAdmin(context)
  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const account = await BusinessAccountModel.findById(businessAccountId).session(activeSession ?? null)
    if (!account) throw notFound('Business account not found')
    const baseDate = account.subscriptionEndsAt && account.subscriptionEndsAt.getTime() > Date.now() ? account.subscriptionEndsAt : new Date()
    const endDate = addDays(baseDate, input.days)
    account.planTier = 'paid'
    account.subscriptionStatus = 'active'
    account.subscriptionStartsAt = account.subscriptionStartsAt ?? new Date()
    account.subscriptionEndsAt = endDate
    await account.save(activeSession ? { session: activeSession } : undefined)
    await logAdminAction(context, businessAccountId, 'business.subscription_extended', 'business_account', businessAccountId, { days: input.days, reason: input.reason, endDate }, requestMeta, activeSession)
    return normalizeMongo(account.toObject({ versionKey: false }))
  })
}

export async function manualActivateSubscription(
  context: RequestContext,
  businessAccountId: Types.ObjectId,
  input: { planType: 'monthly' | 'yearly'; days?: number; reason?: string },
  requestMeta?: { ipAddress?: string; userAgent?: string }
) {
  requirePlatformAdmin(context)
  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const account = await BusinessAccountModel.findById(businessAccountId).session(activeSession ?? null)
    if (!account) throw notFound('Business account not found')
    const days = input.days ?? (input.planType === 'monthly' ? 30 : 365)
    const startDate = new Date()
    const endDate = addDays(startDate, days)
    account.planTier = 'paid'
    account.planType = input.planType
    account.subscriptionStatus = 'active'
    account.subscriptionStartsAt = startDate
    account.subscriptionEndsAt = endDate
    await account.save(activeSession ? { session: activeSession } : undefined)

    // Idempotent: reuse the account's existing subscription row instead of always inserting a new
    // one (which made a manually-added subscription show up twice). Update the most recent row in
    // place and expire any others so exactly one active subscription remains; create only if none.
    const subscriptionFields = {
      businessAccountId,
      userId: context.userId,
      provider: 'manual',
      planType: input.planType,
      status: 'active' as const,
      amount: 0,
      currency: account.currency === 'KES' ? 'KSH' : 'USD',
      transactionId: `manual-${Date.now()}`,
      startDate,
      endDate,
      receiptNumber: `MANUAL-${businessAccountId.toString().slice(-8).toUpperCase()}`
    }
    const existing = await SubscriptionModel.find({ businessAccountId })
      .sort({ createdAt: -1 })
      .session(activeSession ?? null)
    let subscription
    if (existing.length > 0) {
      subscription = existing[0]
      subscription.set(subscriptionFields)
      await subscription.save(activeSession ? { session: activeSession } : undefined)
      const staleIds = existing.slice(1).map((s) => s._id)
      if (staleIds.length > 0) {
        await SubscriptionModel.updateMany(
          { _id: { $in: staleIds } },
          { $set: { status: 'expired' } },
          activeSession ? { session: activeSession } : {}
        )
      }
    } else {
      ;[subscription] = await SubscriptionModel.create([subscriptionFields], activeSession ? { session: activeSession } : {})
    }

    await logAdminAction(context, businessAccountId, 'business.subscription_manual_activated', 'subscription', subscription._id, { planType: input.planType, days, reason: input.reason }, requestMeta, activeSession)
    return {
      account: normalizeMongo(account.toObject({ versionKey: false })),
      subscription: normalizeMongo(subscription.toObject({ versionKey: false }))
    }
  })
}

export async function deactivateSubscription(
  context: RequestContext,
  businessAccountId: Types.ObjectId,
  input: { reason?: string },
  requestMeta?: { ipAddress?: string; userAgent?: string }
) {
  requirePlatformAdmin(context)
  return withTransaction(async (session) => {
    const activeSession = session.inTransaction() ? session : undefined
    const account = await BusinessAccountModel.findById(businessAccountId).session(activeSession ?? null)
    if (!account) throw notFound('Business account not found')
    // Downgrade to free immediately. Leave accountStatus untouched so the business
    // keeps free-tier access — this is a plan revocation, not an account suspension.
    account.planTier = 'free'
    account.planType = null
    account.subscriptionStatus = 'cancelled'
    account.subscriptionEndsAt = null
    await account.save(activeSession ? { session: activeSession } : undefined)

    await SubscriptionModel.updateMany(
      { businessAccountId, status: 'active' },
      { $set: { status: 'cancelled' } },
      activeSession ? { session: activeSession } : {}
    )

    await logAdminAction(context, businessAccountId, 'business.subscription_deactivated', 'business_account', businessAccountId, { reason: input.reason }, requestMeta, activeSession)
    return normalizeMongo(account.toObject({ versionKey: false }))
  })
}

export async function listPaymentEvents(context: RequestContext) {
  requirePlatformAdmin(context)
  const events = await PaymentEventModel.find({}).sort({ createdAt: -1 }).limit(100)
  return events.map((event) => normalizeMongo(event.toObject({ versionKey: false })))
}

export async function retryPaymentEvent(context: RequestContext, eventId: Types.ObjectId, requestMeta?: { ipAddress?: string; userAgent?: string }) {
  requirePlatformAdmin(context)
  const event = await PaymentEventModel.findById(eventId)
  if (!event) throw notFound('Payment event not found')
  if (event.processingStatus !== 'failed') {
    event.processingStatus = 'ignored'
    event.errorMessage = 'Retry ignored because event is not failed'
  } else {
    event.processingStatus = 'received'
    event.errorMessage = undefined
  }
  event.processedAt = null
  await event.save()
  await logAdminAction(context, event.businessAccountId ?? undefined, 'payment_event.retry_requested', 'payment_event', event._id, { provider: event.provider, eventId: event.eventId }, requestMeta)
  return normalizeMongo(event.toObject({ versionKey: false }))
}

export async function listAuditLogs(context: RequestContext) {
  requirePlatformAdmin(context)
  const logs = await AuditLogModel.find({ scope: 'platform' }).sort({ createdAt: -1 }).limit(100)
  return logs.map((log) => normalizeMongo(log.toObject({ versionKey: false })))
}

async function logAdminAction(
  context: RequestContext,
  businessAccountId: Types.ObjectId | undefined,
  action: string,
  targetType: string,
  targetId: Types.ObjectId,
  metadata: Record<string, unknown>,
  requestMeta?: { ipAddress?: string; userAgent?: string },
  session?: Parameters<typeof writeAuditLog>[1]
) {
  await writeAuditLog(
    {
      scope: 'platform',
      businessAccountId,
      actorUserId: context.userId,
      actorRole: 'platform-admin',
      action,
      targetType,
      targetId,
      metadata,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent
    },
    session
  )
}

function requirePlatformAdmin(context: RequestContext) {
  if (context.auth.platformRole !== 'admin') throw new ApiError(403, 'platform_admin_required', 'Platform admin access is required')
}

function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
