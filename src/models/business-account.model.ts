import { Schema, model, type InferSchemaType } from 'mongoose'

const businessAccountSchema = new Schema(
  {
    businessName: { type: String, required: true, trim: true },
    businessType: { type: String, trim: true },
    legalCompanyName: { type: String, trim: true },
    registrationNumber: { type: String, trim: true },
    country: { type: String, required: true, trim: true },
    billingRegion: { type: String, enum: ['KENYA', 'OTHER'], required: true },
    currency: { type: String, required: true, trim: true },
    accountStatus: { type: String, enum: ['active', 'paused', 'revoked'], default: 'active', index: true },
    planTier: { type: String, enum: ['free', 'paid'], default: 'free', index: true },
    planType: { type: String, enum: ['monthly', 'yearly', 'manual', null], default: null },
    subscriptionStatus: {
      type: String,
      enum: ['none', 'pending', 'active', 'expired', 'failed', 'cancelled'],
      default: 'none',
      index: true
    },
    subscriptionStartsAt: { type: Date, default: null },
    subscriptionEndsAt: { type: Date, default: null, index: true },
    branchLimitOverride: { type: Number, default: null },
    settings: { type: Schema.Types.Mixed, default: {} },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }
  },
  { timestamps: true }
)

export type BusinessAccountDocument = InferSchemaType<typeof businessAccountSchema>
export const BusinessAccountModel = model('BusinessAccount', businessAccountSchema)
