import { Schema, model, type InferSchemaType } from 'mongoose'

const userSchema = new Schema(
  {
    firebaseUid: { type: String, required: true, unique: true, index: true },
    email: { type: String, trim: true, lowercase: true, sparse: true, index: true },
    phone: { type: String, trim: true, sparse: true, index: true },
    fullName: { type: String, trim: true },
    phoneVerified: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null }
  },
  { timestamps: true }
)

export type UserDocument = InferSchemaType<typeof userSchema>
export const UserModel = model('User', userSchema)
