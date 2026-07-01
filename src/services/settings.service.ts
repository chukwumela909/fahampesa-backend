import { SettingsModel } from '../models/settings.model.js'
import type { RequestContext } from '../types/http.js'
import { ApiError, notFound } from '../utils/api-error.js'
import { normalizeMongo } from '../utils/serialize.js'

export interface SettingsUpdateInput {
  businessProfile?: Record<string, unknown>
  receiptSettings?: Record<string, unknown>
  notificationSettings?: Record<string, unknown>
  deviceSettings?: Record<string, unknown>
  syncSettings?: Record<string, unknown>
}

export async function getSettings(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  const settings = await SettingsModel.findOne({ businessAccountId: context.businessAccountId })
  if (!settings) throw notFound('Settings not found')
  return serializeSettings(settings, context)
}

export async function updateSettings(context: RequestContext, input: SettingsUpdateInput) {
  requireManagerRole(context)
  const settings = await SettingsModel.findOneAndUpdate(
    { businessAccountId: context.businessAccountId },
    { $set: input },
    { new: true }
  )
  if (!settings) throw notFound('Settings not found')
  return serializeSettings(settings, context)
}

function serializeSettings(settings: { toObject(options?: unknown): unknown }, context: RequestContext) {
  const value = normalizeMongo(settings.toObject({ versionKey: false })) as Record<string, unknown>
  if (context.role === 'cashier') {
    return {
      id: value.id,
      businessAccountId: value.businessAccountId,
      businessProfile: pickSafeBusinessProfile((value.businessProfile ?? {}) as Record<string, unknown>),
      receiptSettings: value.receiptSettings ?? {},
      deviceSettings: value.deviceSettings ?? {},
      syncSettings: value.syncSettings ?? {}
    }
  }
  return value
}

function pickSafeBusinessProfile(profile: Record<string, unknown>) {
  return {
    businessName: profile.businessName,
    businessType: profile.businessType,
    country: profile.country,
    currency: profile.currency,
    // Operational fields the POS/receipts need at the till. Cashiers ring up sales,
    // so they must receive the configured VAT rate (and low-stock threshold / contact
    // details for receipts) — otherwise the POS falls back to a built-in default and
    // the tax rate set in Settings never reflects for cashier-run sales.
    taxRate: profile.taxRate,
    lowStockThreshold: profile.lowStockThreshold,
    businessPhone: profile.businessPhone,
    businessAddress: profile.businessAddress
  }
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) throw new ApiError(403, 'business_required', 'Business context required')
  if (context.role !== 'owner' && context.role !== 'manager') {
    throw new ApiError(403, 'manager_required', 'Only owners and managers can update settings')
  }
}
