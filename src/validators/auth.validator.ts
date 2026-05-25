import { z } from 'zod'

export const phoneExistsQuerySchema = z.object({
  phone: z.string().trim().min(7)
})
