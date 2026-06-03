import { z } from 'zod'

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

const personalProfileSchema = z.object({
  fullName: z.string().trim().min(1).optional(),
  phoneNumber: z.string().trim().min(7).optional(),
  phoneVerified: z.boolean().optional()
})

const companyProfileSchema = z.object({
  legalCompanyName: z.string().trim().min(1).optional(),
  registrationNumber: z.string().trim().min(3).optional()
})

const staffInvitationSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(['admin', 'manager', 'staff', 'cashier']),
  branchIds: z.array(z.string().trim().min(1)).optional(),
  permissions: z.array(z.string().trim().min(1)).optional()
})

export const onboardingSchema = z.object({
  personalProfile: personalProfileSchema.optional(),
  companyProfile: companyProfileSchema.optional(),
  business: z.object({
    businessName: z.string().trim().min(1),
    businessType: z.string().trim().min(1),
    country: z.string().trim().min(1),
    currency: z.string().trim().min(1)
  }),
  branch: z.object({
    name: z.string().trim().min(1),
    location: branchLocationSchema,
    contact: branchContactSchema.optional(),
    branchCode: z.string().trim().optional(),
    branchType: z.enum(['MAIN', 'BRANCH', 'OUTLET', 'WAREHOUSE', 'KIOSK']).optional(),
    description: z.string().trim().optional(),
    currency: z.string().trim().optional()
  }),
  staffInvitations: z.array(staffInvitationSchema).max(20).optional()
})

export const onboardingProgressSchema = z.object({
  currentStep: z.number().int().min(1).optional(),
  completedSteps: z.array(z.number().int().min(1)).optional(),
  skippedSteps: z.array(z.number().int().min(1)).optional(),
  data: z.record(z.unknown()).optional()
})

export const onboardingSkipSchema = onboardingProgressSchema.optional().default({})

export type OnboardingBody = z.infer<typeof onboardingSchema>
export type OnboardingProgressBody = z.infer<typeof onboardingProgressSchema>
