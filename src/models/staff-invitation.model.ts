import { Schema, model, type InferSchemaType } from 'mongoose'

const staffInvitationSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    sourceRole: { type: String, enum: ['admin', 'manager', 'staff', 'cashier'], required: true },
    role: { type: String, enum: ['manager', 'cashier'], required: true },
    tokenHash: { type: String, required: true, unique: true, select: false, index: true },
    status: { type: String, enum: ['pending', 'accepted', 'cancelled'], default: 'pending', index: true },
    expiresAt: { type: Date, required: true, index: true },
    acceptedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    acceptedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedBranchIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
    permissions: [{ type: String }],
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
)

staffInvitationSchema.index({ businessAccountId: 1, email: 1, status: 1 })
staffInvitationSchema.index({ businessAccountId: 1, createdAt: -1 })

export type StaffInvitationDocument = InferSchemaType<typeof staffInvitationSchema>
export const StaffInvitationModel = model('StaffInvitation', staffInvitationSchema)
