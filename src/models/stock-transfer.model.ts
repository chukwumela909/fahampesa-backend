import { Schema, model, type InferSchemaType } from 'mongoose'

const stockTransferItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 }
  },
  { _id: false }
)

const stockTransferSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    transferNumber: { type: String, required: true, trim: true },
    fromBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    toBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    items: { type: [stockTransferItemSchema], default: [] },
    status: { type: String, enum: ['requested', 'approved', 'in_transit', 'received', 'cancelled', 'rejected'], default: 'requested', index: true },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    shippedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    notes: { type: String, trim: true },
    version: { type: Number, default: 1 }
  },
  { timestamps: true }
)

stockTransferSchema.index({ businessAccountId: 1, fromBranchId: 1, status: 1 })
stockTransferSchema.index({ businessAccountId: 1, toBranchId: 1, status: 1 })
stockTransferSchema.index({ businessAccountId: 1, transferNumber: 1 }, { unique: true })

export type StockTransferDocument = InferSchemaType<typeof stockTransferSchema>
export const StockTransferModel = model('StockTransfer', stockTransferSchema)
