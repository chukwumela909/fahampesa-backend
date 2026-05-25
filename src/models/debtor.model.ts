import { Schema, model, type InferSchemaType } from 'mongoose'

const debtorSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    creditLimit: { type: Number, default: 0, min: 0 },
    currentDebt: { type: Number, default: 0, min: 0 },
    totalPurchases: { type: Number, default: 0, min: 0 },
    totalPayments: { type: Number, default: 0, min: 0 },
    paymentStatus: {
      type: String,
      enum: ['clear', 'outstanding', 'overdue'],
      default: 'clear',
      index: true
    },
    dueDate: { type: Date, default: null },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
)

debtorSchema.index({ businessAccountId: 1, branchId: 1, isActive: 1 })

export type DebtorDocument = InferSchemaType<typeof debtorSchema>
export const DebtorModel = model('Debtor', debtorSchema)
