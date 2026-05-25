import { Schema, model, type InferSchemaType } from 'mongoose'

const expenseSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    category: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    paymentMethod: {
      type: String,
      enum: ['cash', 'mpesa', 'bank_transfer', 'card', 'cheque', 'other'],
      required: true
    },
    vendor: { type: String, trim: true },
    receiptNumber: { type: String, trim: true },
    attachmentUrl: { type: String, trim: true },
    date: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
)

expenseSchema.index({ businessAccountId: 1, branchId: 1, date: -1 })

export type ExpenseDocument = InferSchemaType<typeof expenseSchema>
export const ExpenseModel = model('Expense', expenseSchema)
