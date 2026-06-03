import { z } from 'zod'

const roleSchema = z.enum(['owner', 'manager', 'cashier'])
const statusSchema = z.enum(['active', 'inactive', 'suspended'])
const invitationStatusSchema = z.enum(['pending', 'accepted', 'cancelled'])

export const staffListQuerySchema = z.object({
  branchId: z.string().optional(),
  status: statusSchema.optional()
})

export const staffInvitationListQuerySchema = z.object({
  status: invitationStatusSchema.optional()
})

export const createStaffInvitationSchema = z.object({
  email: z.string().trim().email(),
  role: roleSchema.exclude(['owner']),
  branchIds: z.array(z.string().trim().min(1)).min(1),
  permissions: z.array(z.string().trim().min(1)).default([])
})

export const acceptStaffInvitationSchema = z.object({
  token: z.string().trim().min(1)
})

export const createStaffSchema = z.object({
  firebaseUid: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  fullName: z.string().trim().min(1),
  phone: z.string().trim().optional(),
  role: roleSchema.exclude(['owner']),
  branchIds: z.array(z.string().trim().min(1)).default([]),
  permissions: z.array(z.string().trim().min(1)).default([]),
  employeeId: z.string().trim().optional(),
  salary: z.number().nonnegative().optional(),
  emergencyContact: z.object({
    name: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    relationship: z.string().trim().optional()
  }).optional()
})

export const updateStaffSchema = createStaffSchema.partial().extend({
  status: statusSchema.optional(),
  twoFactorEnabled: z.boolean().optional()
})

export const activityLogQuerySchema = z.object({
  staffId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
})

export const createActivityLogSchema = z.object({
  staffId: z.string().optional(),
  action: z.string().trim().min(1),
  description: z.string().trim().optional(),
  severity: z.enum(['info', 'warning', 'error']).default('info'),
  metadata: z.record(z.unknown()).default({})
})

export const verifyTwoFactorSchema = z.object({
  token: z.string().trim().regex(/^\d{6}$/)
})

export type CreateStaffInput = z.infer<typeof createStaffSchema>
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>
export type CreateActivityLogInput = z.infer<typeof createActivityLogSchema>
export type CreateStaffInvitationInput = z.infer<typeof createStaffInvitationSchema>
