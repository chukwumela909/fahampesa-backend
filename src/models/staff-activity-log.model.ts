import { Schema, model, type InferSchemaType } from 'mongoose'

const staffActivityLogSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    staffMembershipId: { type: Schema.Types.ObjectId, ref: 'BusinessMembership', index: true },
    staffUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true },
    severity: { type: String, enum: ['info', 'warning', 'error'], default: 'info' },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
)

staffActivityLogSchema.index({ businessAccountId: 1, createdAt: -1 })

export type StaffActivityLogDocument = InferSchemaType<typeof staffActivityLogSchema>
export const StaffActivityLogModel = model('StaffActivityLog', staffActivityLogSchema)
