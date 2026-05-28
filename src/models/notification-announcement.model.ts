import { Schema, model, type InferSchemaType } from 'mongoose'

const notificationAnnouncementSchema = new Schema(
  {
    announcementId: { type: String, required: true, unique: true, index: true },
    businessAccountId: { type: Schema.Types.ObjectId, ref: 'BusinessAccount', index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    channel: { type: String, required: true, trim: true },
    targetAudience: { type: String, required: true, trim: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    recipientCount: { type: Number, default: 0, min: 0 },
    sentBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
)

notificationAnnouncementSchema.index({ businessAccountId: 1, createdAt: -1 })

export type NotificationAnnouncementDocument = InferSchemaType<typeof notificationAnnouncementSchema>
export const NotificationAnnouncementModel = model('NotificationAnnouncement', notificationAnnouncementSchema)
