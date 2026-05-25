import type { ClientSession, Types } from 'mongoose'
import { AuditLogModel } from '../models/audit-log.model.js'

export interface AuditInput {
  scope: 'business' | 'platform'
  businessAccountId?: Types.ObjectId
  actorUserId: Types.ObjectId
  actorRole?: string
  action: string
  targetType: string
  targetId?: Types.ObjectId
  branchId?: Types.ObjectId
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

export async function writeAuditLog(input: AuditInput, session?: ClientSession) {
  const [log] = await AuditLogModel.create([input], { session })
  return log
}
