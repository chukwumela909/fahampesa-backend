import type { Request } from 'express'
import type { Types } from 'mongoose'

export type Role = 'owner' | 'manager' | 'cashier'

export interface AuthUser {
  firebaseUid: string
  email?: string
  phone?: string
  name?: string
  authTime?: Date
  platformRole?: 'admin'
}

export interface RequestContext {
  auth: AuthUser
  userId: Types.ObjectId
  businessAccountId?: Types.ObjectId
  role?: Role
  membershipId?: Types.ObjectId
  assignedBranchIds: Types.ObjectId[]
  accountStatus?: 'active' | 'paused' | 'revoked'
  planTier?: 'free' | 'paid'
  subscriptionStatus?: 'none' | 'pending' | 'active' | 'expired' | 'failed' | 'cancelled'
  subscriptionEndsAt?: Date | null
  branchLimitOverride?: number | null
}

export interface AppRequest extends Request {
  context?: RequestContext
}
