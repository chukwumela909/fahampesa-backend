import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { activityLogQuerySchema, acceptStaffInvitationSchema, createActivityLogSchema, createStaffInvitationSchema, createStaffSchema, staffInvitationListQuerySchema, staffListQuerySchema, updateStaffSchema, verifyTwoFactorSchema } from '../validators/staff.validator.js'
import { activateStaff, createStaff, deactivateStaff, deleteStaff, disableStaffTwoFactor, getStaff, listStaff, listStaffActivityLogs, setupStaffTwoFactor, updateStaff, verifyStaffTwoFactor, writeStaffActivity } from '../services/staff.service.js'
import { acceptStaffInvitation, cancelStaffInvitation, inviteStaff, listStaffInvitations, lookupStaffInvitation } from '../services/staff-invitation.service.js'
import { ApiError } from '../utils/api-error.js'

export const list = asyncHandler(async (req: AppRequest, res: Response) => {
  const query = staffListQuerySchema.parse(req.query)
  res.json({ data: await listStaff(req.context!, query) })
})

export const create = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = createStaffSchema.parse(req.body)
  res.status(201).json({ data: await createStaff(req.context!, body) })
})

export const createInvitation = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = createStaffInvitationSchema.parse(req.body)
  res.status(201).json({ data: await inviteStaff(req.context!, body) })
})

export const listInvitations = asyncHandler(async (req: AppRequest, res: Response) => {
  const query = staffInvitationListQuerySchema.parse(req.query)
  res.json({ data: await listStaffInvitations(req.context!, query) })
})

export const cancelInvitation = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await cancelStaffInvitation(req.context!, staffId(req)) })
})

export const acceptInvitation = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = acceptStaffInvitationSchema.parse(req.body)
  res.json({ data: await acceptStaffInvitation(req.context!, body.token) })
})

export const lookupInvitation = asyncHandler(async (req: AppRequest, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : ''
  if (!token) throw new ApiError(400, 'token_required', 'token is required')
  res.json({ data: await lookupStaffInvitation(token) })
})

export const get = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await getStaff(req.context!, staffId(req)) })
})

export const update = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = updateStaffSchema.parse(req.body)
  res.json({ data: await updateStaff(req.context!, staffId(req), body) })
})

export const remove = asyncHandler(async (req: AppRequest, res: Response) => {
  const id = staffId(req)
  // Soft delete (deactivate) by default; permanent purge only when explicitly requested.
  if (req.query.permanent === 'true') {
    res.json({ data: await deleteStaff(req.context!, id) })
    return
  }
  res.json({ data: await deactivateStaff(req.context!, id) })
})

export const activate = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await activateStaff(req.context!, staffId(req)) })
})

export const logs = asyncHandler(async (req: AppRequest, res: Response) => {
  const query = activityLogQuerySchema.parse(req.query)
  res.json({ data: await listStaffActivityLogs(req.context!, query) })
})

export const createLog = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = createActivityLogSchema.parse(req.body)
  res.status(201).json({ data: await writeStaffActivity(req.context!, body) })
})

export const setupTwoFactor = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await setupStaffTwoFactor(req.context!) })
})

export const verifyTwoFactor = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = verifyTwoFactorSchema.parse(req.body)
  res.json({ data: await verifyStaffTwoFactor(req.context!, body.token) })
})

export const disableTwoFactor = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await disableStaffTwoFactor(req.context!) })
})

function staffId(req: AppRequest) {
  return toObjectId(objectIdSchema.parse(req.params.staffId))
}
