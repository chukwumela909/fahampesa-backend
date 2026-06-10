import { z } from 'zod'

export const phoneExistsQuerySchema = z.object({
  phone: z.string().trim().min(7)
})

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(7).max(20).optional()
  })
  .refine((value) => value.fullName !== undefined || value.phone !== undefined, {
    message: 'At least one of fullName or phone is required'
  })
