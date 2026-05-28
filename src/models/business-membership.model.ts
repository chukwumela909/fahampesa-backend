import { Schema, model, type InferSchemaType } from 'mongoose'

const businessMembershipSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['owner', 'manager', 'cashier'], required: true },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active', index: true },
    assignedBranchIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
    permissions: [{ type: String }],
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },
    employeeId: { type: String, trim: true },
    salary: { type: Number, min: 0 },
    emergencyContact: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      relationship: { type: String, trim: true }
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
)

businessMembershipSchema.index({ businessAccountId: 1, userId: 1 }, { unique: true })
businessMembershipSchema.index({ businessAccountId: 1, role: 1 })
businessMembershipSchema.index({ businessAccountId: 1, assignedBranchIds: 1 })

export type BusinessMembershipDocument = InferSchemaType<typeof businessMembershipSchema>
export const BusinessMembershipModel = model('BusinessMembership', businessMembershipSchema)
