import { Schema, model, type InferSchemaType } from 'mongoose'

const debtorPaymentSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    debtorId: { type: Schema.Types.ObjectId, ref: 'Debtor', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: ['cash', 'mpesa', 'bank_transfer', 'card', 'cheque', 'other'],
      required: true
    },
    reference: { type: String, trim: true },
    outstandingBalance: { type: Number, required: true, min: 0 },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

debtorPaymentSchema.index({ businessAccountId: 1, branchId: 1, debtorId: 1, createdAt: -1 })

export type DebtorPaymentDocument = InferSchemaType<typeof debtorPaymentSchema>
export const DebtorPaymentModel = model('DebtorPayment', debtorPaymentSchema)
