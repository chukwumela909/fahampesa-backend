import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { adminBusinessQuerySchema, branchLimitOverrideSchema, manualActivateSchema, subscriptionDeactivateSchema, subscriptionExtendSchema } from '../validators/admin.validator.js'
import {
  deactivateSubscription,
  extendSubscription,
  getBusinessDetail,
  listAuditLogs,
  listPaymentEvents,
  manualActivateSubscription,
  retryPaymentEvent,
  searchBusinesses,
  setAccountStatus,
  setBranchLimitOverride
} from '../services/admin.service.js'

export const businesses = asyncHandler(async (req: AppRequest, res: Response) => {
  const query = adminBusinessQuerySchema.parse(req.query)
  res.json({ data: await searchBusinesses(req.context!, query) })
})

export const businessDetail = asyncHandler(async (req: AppRequest, res: Response) => {
  const businessAccountId = toObjectId(objectIdSchema.parse(req.params.businessAccountId))
  res.json({ data: await getBusinessDetail(req.context!, businessAccountId) })
})

export const pause = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await setAccountStatus(req.context!, businessAccountId(req), 'paused', meta(req)) })
})

export const resume = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await setAccountStatus(req.context!, businessAccountId(req), 'active', meta(req)) })
})

export const revoke = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await setAccountStatus(req.context!, businessAccountId(req), 'revoked', meta(req)) })
})

export const branchLimit = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = branchLimitOverrideSchema.parse(req.body)
  res.json({ data: await setBranchLimitOverride(req.context!, businessAccountId(req), body.branchLimitOverride, meta(req)) })
})

export const extend = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = subscriptionExtendSchema.parse(req.body)
  res.json({ data: await extendSubscription(req.context!, businessAccountId(req), body, meta(req)) })
})

export const manualActivate = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = manualActivateSchema.parse(req.body)
  res.status(201).json({ data: await manualActivateSubscription(req.context!, businessAccountId(req), body, meta(req)) })
})

export const deactivate = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = subscriptionDeactivateSchema.parse(req.body)
  res.json({ data: await deactivateSubscription(req.context!, businessAccountId(req), body, meta(req)) })
})

export const retryPayment = asyncHandler(async (req: AppRequest, res: Response) => {
  const eventId = toObjectId(objectIdSchema.parse(req.params.eventId))
  res.json({ data: await retryPaymentEvent(req.context!, eventId, meta(req)) })
})

export const auditLogs = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await listAuditLogs(req.context!) })
})

export const payments = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await listPaymentEvents(req.context!) })
})

function businessAccountId(req: AppRequest) {
  return toObjectId(objectIdSchema.parse(req.params.businessAccountId))
}

function meta(req: AppRequest) {
  return { ipAddress: req.ip, userAgent: req.header('user-agent') }
}
