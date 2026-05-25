import { Schema, model, type InferSchemaType } from 'mongoose'

const saleItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    lineSubtotal: { type: Number, required: true, min: 0 },
    lineCost: { type: Number, required: true, min: 0 },
    lineProfit: { type: Number, required: true }
  },
  { _id: false }
)

const saleSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    saleNumber: { type: String, required: true, trim: true },
    items: { type: [saleItemSchema], default: [] },
    customer: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
      debtorId: { type: Schema.Types.ObjectId, ref: 'Debtor', default: null }
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'mpesa', 'bank_transfer', 'card', 'credit', 'cheque', 'other'],
      required: true
    },
    subtotal: { type: Number, required: true, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    totalCost: { type: Number, required: true, min: 0 },
    profit: { type: Number, required: true },
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    version: { type: Number, default: 1 }
  },
  { timestamps: true }
)

saleSchema.index({ businessAccountId: 1, branchId: 1, createdAt: -1 })
saleSchema.index({ businessAccountId: 1, saleNumber: 1 }, { unique: true })

export type SaleDocument = InferSchemaType<typeof saleSchema>
export const SaleModel = model('Sale', saleSchema)
