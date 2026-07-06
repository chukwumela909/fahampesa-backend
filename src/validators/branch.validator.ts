import { z } from 'zod'
import { objectIdSchema } from './common.js'

const openingHoursSchema = z.object({
  dayOfWeek: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
  isOpen: z.boolean(),
  openTime: z.string().optional(),
  closeTime: z.string().optional(),
  breakStart: z.string().optional(),
  breakEnd: z.string().optional()
})

const branchLocationSchema = z.object({
  address: z.string().trim().min(1),
  city: z.string().trim().optional(),
  region: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  country: z.string().trim().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  landmark: z.string().trim().optional(),
  directions: z.string().trim().optional()
})

const branchContactSchema = z.object({
  phone: z.string().trim().optional(),
  alternatePhone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  whatsapp: z.string().trim().optional()
})

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional()
)

export const createBranchSchema = z.object({
  name: z.string().trim().min(1),
  location: branchLocationSchema,
  contact: branchContactSchema.optional(),
  openingHours: z.array(openingHoursSchema).optional(),
  branchCode: optionalTrimmedString,
  branchType: z.enum(['MAIN', 'BRANCH', 'OUTLET', 'WAREHOUSE', 'KIOSK']).optional(),
  description: z.string().trim().optional(),
  currency: z.string().trim().optional(),
  taxSettings: z
    .object({
      chargeTax: z.boolean().optional(),
      taxRate: z.number().min(0).optional(),
      taxNumber: z.string().trim().optional()
    })
    .optional()
})

export const updateBranchSchema = createBranchSchema.partial().extend({
  status: z.enum(['active', 'inactive', 'under_maintenance', 'temporarily_closed']).optional(),
  // Assign (or clear, with null) the branch manager
  managerUserId: objectIdSchema.nullable().optional()
})

export type CreateBranchBody = z.infer<typeof createBranchSchema>
export type UpdateBranchBody = z.infer<typeof updateBranchSchema>
