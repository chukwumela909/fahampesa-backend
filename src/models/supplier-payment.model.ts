import { Schema, model, type InferSchemaType } from 'mongoose'

const supplierPaymentSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: ['cash', 'mpesa', 'bank_transfer', 'card', 'cheque', 'other'], required: true },
    reference: { type: String, trim: true },
    notes: { type: String, trim: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

supplierPaymentSchema.index({ businessAccountId: 1, branchId: 1, supplierId: 1, createdAt: -1 })

export type SupplierPaymentDocument = InferSchemaType<typeof supplierPaymentSchema>
export const SupplierPaymentModel = model('SupplierPayment', supplierPaymentSchema)
