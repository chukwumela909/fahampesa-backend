import { Schema, model, type InferSchemaType } from 'mongoose'

const purchaseOrderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, trim: true },
    quantityOrdered: { type: Number, required: true, min: 0 },
    quantityReceived: { type: Number, default: 0, min: 0 },
    unitCostPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 }
  },
  { _id: false }
)

const purchaseOrderSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    poNumber: { type: String, required: true, trim: true },
    items: { type: [purchaseOrderItemSchema], default: [] },
    subtotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    shippingCost: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    outstandingAmount: { type: Number, required: true, min: 0 },
    paymentTerms: { type: String, trim: true },
    expectedDeliveryDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ['draft', 'pending', 'approved', 'sent', 'partially_received', 'received', 'cancelled', 'rejected'],
      default: 'draft',
      index: true
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    receivedAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: Number, default: 1 }
  },
  { timestamps: true }
)

purchaseOrderSchema.index({ businessAccountId: 1, branchId: 1, status: 1 })
purchaseOrderSchema.index({ businessAccountId: 1, poNumber: 1 }, { unique: true })

export type PurchaseOrderDocument = InferSchemaType<typeof purchaseOrderSchema>
export const PurchaseOrderModel = model('PurchaseOrder', purchaseOrderSchema)
