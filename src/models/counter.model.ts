import { Schema, model, type InferSchemaType } from 'mongoose'

// Per-business monotonic sequences for human-facing document numbers
// (SALE-000123, REF-…, TRF-…). Replaces countDocuments-based numbering, which
// raced under concurrency (two cashiers → duplicate key → raw 500) and reused
// numbers after hard-deletes.
const counterSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true },
    key: { type: String, required: true, trim: true },
    seq: { type: Number, required: true, default: 0 }
  },
  { timestamps: true }
)

counterSchema.index({ businessAccountId: 1, key: 1 }, { unique: true })

export type CounterDocument = InferSchemaType<typeof counterSchema>
export const CounterModel = model('Counter', counterSchema)
