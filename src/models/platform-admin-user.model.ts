import { Schema, model, type InferSchemaType } from 'mongoose'

const platformAdminUserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    role: { type: String, enum: ['super_admin', 'admin', 'viewer'], default: 'viewer', index: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    lastLogin: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
)

export type PlatformAdminUserDocument = InferSchemaType<typeof platformAdminUserSchema>
export const PlatformAdminUserModel = model('PlatformAdminUser', platformAdminUserSchema)
