import { Schema, model, type InferSchemaType } from 'mongoose'

const auditLogSchema = new Schema(
  {
    scope: { type: String, enum: ['business', 'platform'], required: true, index: true },
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorRole: { type: String },
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true },
    targetId: { type: Schema.Types.ObjectId },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ipAddress: { type: String },
    userAgent: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

auditLogSchema.index({ businessAccountId: 1, createdAt: -1 })

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema>
export const AuditLogModel = model('AuditLog', auditLogSchema)
