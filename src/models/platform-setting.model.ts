import { Schema, model, type InferSchemaType } from 'mongoose'

const platformSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    settings: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
)

export type PlatformSettingDocument = InferSchemaType<typeof platformSettingSchema>
export const PlatformSettingModel = model('PlatformSetting', platformSettingSchema)
