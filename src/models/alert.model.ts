import { Schema, model, type InferSchemaType } from 'mongoose'

const alertSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    alertType: {
      type: String,
      enum: ['low_stock', 'expiry', 'operational'],
      required: true,
      index: true
    },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', index: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    message: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['active', 'acknowledged', 'resolved'],
      default: 'active',
      index: true
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
    resolvedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

alertSchema.index({ businessAccountId: 1, branchId: 1, alertType: 1, status: 1 })

export type AlertDocument = InferSchemaType<typeof alertSchema>
export const AlertModel = model('Alert', alertSchema)
