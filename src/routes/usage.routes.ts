import { Router } from 'express'
import { usage } from '../controllers/usage.controller.js'
import { requireBusinessContext } from '../middleware/auth.js'

export const usageRouter = Router()

usageRouter.use(requireBusinessContext)
usageRouter.get('/', usage)
