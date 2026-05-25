import type { ClientSession, Types } from 'mongoose'
import { BusinessMembershipModel } from '../models/business-membership.model.js'
import { OnboardingStateModel } from '../models/onboarding-state.model.js'
import type { OnboardingProgressBody } from '../validators/onboarding.validator.js'
import { normalizeMongo } from '../utils/serialize.js'

export async function getOnboardingStatus(userId: Types.ObjectId) {
  const [membership, state] = await Promise.all([
    BusinessMembershipModel.findOne({ userId, status: 'active' }).sort({ createdAt: 1 }),
    OnboardingStateModel.findOne({ userId })
  ])

  const hasBusiness = Boolean(membership)
  const skipped = state?.status === 'skipped'
  const completed = hasBusiness || state?.status === 'completed' || skipped

  return {
    completed,
    skipped,
    currentStep: completed ? 7 : state?.currentStep ?? 1,
    completedSteps: state?.completedSteps ?? [],
    skippedSteps: state?.skippedSteps ?? [],
    hasOnboardingData: Boolean(state),
    hasBusiness,
    businessAccountId: membership?.businessAccountId.toString() ?? null,
    status: state?.status ?? (hasBusiness ? 'completed' : 'not_started'),
    data: state?.data ?? {}
  }
}

export async function saveOnboardingProgress(userId: Types.ObjectId, input: OnboardingProgressBody) {
  const state = await OnboardingStateModel.findOneAndUpdate(
    { userId },
    {
      $set: {
        status: 'in_progress',
        ...(input.currentStep !== undefined ? { currentStep: input.currentStep } : {}),
        ...(input.completedSteps !== undefined ? { completedSteps: uniqueNumbers(input.completedSteps) } : {}),
        ...(input.skippedSteps !== undefined ? { skippedSteps: uniqueNumbers(input.skippedSteps) } : {}),
        ...(input.data !== undefined ? { data: input.data } : {})
      },
      $setOnInsert: { userId }
    },
    { upsert: true, new: true }
  )
  return normalizeMongo(state.toObject({ versionKey: false }))
}

export async function skipOnboarding(userId: Types.ObjectId, input: OnboardingProgressBody) {
  const state = await OnboardingStateModel.findOneAndUpdate(
    { userId },
    {
      $set: {
        status: 'skipped',
        currentStep: input.currentStep ?? 7,
        completedSteps: uniqueNumbers(input.completedSteps ?? []),
        skippedSteps: uniqueNumbers(input.skippedSteps ?? []),
        ...(input.data !== undefined ? { data: input.data } : {}),
        skippedAt: new Date(),
        completedAt: new Date()
      },
      $setOnInsert: { userId }
    },
    { upsert: true, new: true }
  )
  return normalizeMongo(state.toObject({ versionKey: false }))
}

export async function markOnboardingCompleted(
  userId: Types.ObjectId,
  data: Record<string, unknown>,
  session?: ClientSession
) {
  const activeSession = session?.inTransaction() ? session : undefined
  await OnboardingStateModel.findOneAndUpdate(
    { userId },
    {
      $set: {
        status: 'completed',
        currentStep: 7,
        data,
        completedAt: new Date()
      },
      $setOnInsert: { userId }
    },
    activeSession ? { upsert: true, new: true, session: activeSession } : { upsert: true, new: true }
  )
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)].sort((a, b) => a - b)
}
