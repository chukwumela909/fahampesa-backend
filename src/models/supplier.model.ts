import { Schema, model, type InferSchemaType } from 'mongoose'

const supplierSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    categories: { type: [String], default: [] },
    productsSupplied: { type: [String], default: [] },
    openingBalance: { type: Number, default: 0, min: 0 },
    paymentTerms: { type: String, trim: true },
    currentBalance: { type: Number, default: 0, min: 0 },
    totalPurchases: { type: Number, default: 0, min: 0 },
    totalPaid: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
)

supplierSchema.index({ businessAccountId: 1, branchId: 1, status: 1 })
supplierSchema.index({ businessAccountId: 1, branchId: 1, name: 1 })

export type SupplierDocument = InferSchemaType<typeof supplierSchema>
export const SupplierModel = model('Supplier', supplierSchema)
