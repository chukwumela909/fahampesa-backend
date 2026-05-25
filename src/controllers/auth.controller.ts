import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { normalizeMongo, serializeDocument } from '../utils/serialize.js'
import { phoneExistsQuerySchema } from '../validators/auth.validator.js'
import { onboardingProgressSchema, onboardingSchema, onboardingSkipSchema } from '../validators/onboarding.validator.js'
import { onboardBusiness } from '../services/account.service.js'
import { getOnboardingStatus, saveOnboardingProgress, skipOnboarding } from '../services/onboarding.service.js'
import { phoneExists as phoneExistsService } from '../services/user.service.js'

export const getMe = asyncHandler(async (req: AppRequest, res: Response) => {
  const onboardingStatus = await getOnboardingStatus(req.context!.userId)
  res.json({
    data: {
      auth: req.context?.auth,
      userId: req.context?.userId?.toString(),
      businessAccountId: req.context?.businessAccountId?.toString(),
      role: req.context?.role,
      assignedBranchIds: req.context?.assignedBranchIds.map((id) => id.toString()) ?? [],
      accountStatus: req.context?.accountStatus,
      planTier: req.context?.planTier,
      subscriptionStatus: req.context?.subscriptionStatus,
      subscriptionEndsAt: req.context?.subscriptionEndsAt?.toISOString() ?? null,
      onboardingStatus
    }
  })
})

export const onboard = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = onboardingSchema.parse(req.body)
  const result = await onboardBusiness({
    userId: req.context!.userId,
    personalProfile: body.personalProfile,
    companyProfile: body.companyProfile,
    business: body.business,
    branch: body.branch,
    staffInvitations: body.staffInvitations,
    requestMeta: {
      ipAddress: req.ip,
      userAgent: req.header('user-agent')
    }
  })

  res.status(201).json({
    data: {
      businessAccount: serializeDocument(result.account),
      branch: serializeDocument(result.branch),
      membership: serializeDocument(result.membership),
      staffInvitations: result.invitations.map((invitation) => normalizeMongo(invitation.toObject({ versionKey: false })))
    }
  })
})

export const onboardingStatus = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await getOnboardingStatus(req.context!.userId) })
})

export const onboardingProgress = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = onboardingProgressSchema.parse(req.body)
  res.json({ data: await saveOnboardingProgress(req.context!.userId, body) })
})

export const onboardingSkip = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = onboardingSkipSchema.parse(req.body)
  res.json({ data: await skipOnboarding(req.context!.userId, body) })
})

export const phoneExists = asyncHandler(async (req: AppRequest, res: Response) => {
  const query = phoneExistsQuerySchema.parse(req.query)
  res.json({ data: { exists: await phoneExistsService(query.phone) } })
})
