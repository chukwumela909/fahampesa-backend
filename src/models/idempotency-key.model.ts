import { Schema, model, type InferSchemaType } from 'mongoose'

const idempotencyKeySchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true },
    key: { type: String, required: true, trim: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: { type: String, enum: ['pending', 'completed'], default: 'pending', required: true },
    statusCode: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
)

// A key is unique per business account; replaying it returns the stored response.
idempotencyKeySchema.index({ businessAccountId: 1, key: 1 }, { unique: true })
// Keys are short-lived guards against double-submits, not a permanent ledger.
idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 })

export type IdempotencyKeyDocument = InferSchemaType<typeof idempotencyKeySchema>
export const IdempotencyKeyModel = model('IdempotencyKey', idempotencyKeySchema)
