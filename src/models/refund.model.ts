import { Schema, model, type InferSchemaType } from 'mongoose'

/**
 * Durable record of a sale refund, kept for reporting and audit purposes.
 * Created when a sale is fully refunded; the sale itself is marked isRefunded
 * (not deleted) so it remains visible in history.
 */
const refundSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true, index: true },
    saleNumber: { type: String, required: true, trim: true },
    refundNumber: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: ['cash', 'mpesa', 'bank_transfer', 'card', 'credit', 'cheque', 'other'],
      required: true
    },
    reason: { type: String, trim: true },
    itemCount: { type: Number, default: 0 },
    restocked: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
)

refundSchema.index({ businessAccountId: 1, branchId: 1, createdAt: -1 })
refundSchema.index({ businessAccountId: 1, refundNumber: 1 }, { unique: true })

export type RefundDocument = InferSchemaType<typeof refundSchema>
export const RefundModel = model('Refund', refundSchema)
