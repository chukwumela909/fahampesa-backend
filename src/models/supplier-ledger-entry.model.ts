import { Schema, model, type InferSchemaType } from 'mongoose'

const supplierLedgerEntrySchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    entryType: { type: String, enum: ['opening_balance', 'purchase', 'payment', 'adjustment'], required: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    referenceType: { type: String, trim: true },
    referenceId: { type: Schema.Types.ObjectId },
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

supplierLedgerEntrySchema.index({ businessAccountId: 1, branchId: 1, supplierId: 1, createdAt: -1 })
supplierLedgerEntrySchema.index({ businessAccountId: 1, referenceType: 1, referenceId: 1 })

export type SupplierLedgerEntryDocument = InferSchemaType<typeof supplierLedgerEntrySchema>
export const SupplierLedgerEntryModel = model('SupplierLedgerEntry', supplierLedgerEntrySchema)
