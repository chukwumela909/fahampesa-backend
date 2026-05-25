import { Schema, model, type InferSchemaType } from 'mongoose'

const settingsSchema = new Schema(
  {
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', required: true, unique: true },
    businessProfile: { type: Schema.Types.Mixed, default: {} },
    receiptSettings: { type: Schema.Types.Mixed, default: {} },
    notificationSettings: { type: Schema.Types.Mixed, default: {} },
    deviceSettings: { type: Schema.Types.Mixed, default: {} },
    syncSettings: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
)

export type SettingsDocument = InferSchemaType<typeof settingsSchema>
export const SettingsModel = model('Settings', settingsSchema)
