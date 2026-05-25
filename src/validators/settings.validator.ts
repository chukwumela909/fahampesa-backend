import { z } from 'zod'

const looseObjectSchema = z.record(z.unknown())

export const updateSettingsSchema = z.object({
  businessProfile: looseObjectSchema.optional(),
  receiptSettings: looseObjectSchema.optional(),
  notificationSettings: looseObjectSchema.optional(),
  deviceSettings: looseObjectSchema.optional(),
  syncSettings: looseObjectSchema.optional()
})

export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema>
