import { Schema, model, type InferSchemaType } from 'mongoose'

const subscriptionSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, enum: ['mpesa', 'stripe', 'manual'], required: true, index: true },
    planType: { type: String, enum: ['monthly', 'yearly'], required: true },
    status: { type: String, enum: ['pending', 'active', 'expired', 'failed', 'cancelled'], default: 'pending', index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['KSH', 'USD'], required: true },
    checkoutRequestId: { type: String, trim: true },
    merchantRequestId: { type: String, trim: true },
    stripeCheckoutSessionId: { type: String, trim: true },
    transactionId: { type: String, trim: true },
    phoneNumber: { type: String, trim: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    receiptNumber: { type: String, trim: true }
  },
  { timestamps: true }
)

subscriptionSchema.index({ businessAccountId: 1, status: 1, createdAt: -1 })
subscriptionSchema.index({ checkoutRequestId: 1 }, { sparse: true })
subscriptionSchema.index({ stripeCheckoutSessionId: 1 }, { sparse: true })

export type SubscriptionDocument = InferSchemaType<typeof subscriptionSchema>
export const SubscriptionModel = model('Subscription', subscriptionSchema)
