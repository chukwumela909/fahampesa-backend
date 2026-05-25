import { Schema, model, type InferSchemaType } from 'mongoose'

const paymentEventSchema = new Schema(
  {
    provider: { type: String, enum: ['mpesa', 'stripe', 'manual'], required: true, index: true },
    eventId: { type: String, trim: true },
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', index: true },
    eventType: { type: String, required: true, trim: true },
    rawPayload: { type: Schema.Types.Mixed, default: {} },
    processingStatus: { type: String, enum: ['received', 'processed', 'failed', 'ignored'], default: 'received', index: true },
    errorMessage: { type: String, trim: true },
    processedAt: { type: Date, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

paymentEventSchema.index({ provider: 1, eventId: 1 }, { unique: true, sparse: true })
paymentEventSchema.index({ processingStatus: 1, createdAt: -1 })

export type PaymentEventDocument = InferSchemaType<typeof paymentEventSchema>
export const PaymentEventModel = model('PaymentEvent', paymentEventSchema)
