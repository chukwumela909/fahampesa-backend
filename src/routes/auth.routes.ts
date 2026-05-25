import { Router } from 'express'
import { getMe, onboard, onboardingProgress, onboardingSkip, onboardingStatus, phoneExists } from '../controllers/auth.controller.js'

export const publicAuthRouter = Router()
export const authRouter = Router()

publicAuthRouter.get('/auth/phone-exists', phoneExists)

authRouter.get('/me', getMe)
authRouter.get('/onboarding/status', onboardingStatus)
authRouter.put('/onboarding/progress', onboardingProgress)
authRouter.post('/onboarding/skip', onboardingSkip)
authRouter.post('/onboarding/business', onboard)
