import { Router } from 'express'
import { get, update } from '../controllers/settings.controller.js'
import { requireBusinessContext, requireWriteAccess } from '../middleware/auth.js'

export const settingsRouter = Router()

settingsRouter.use(requireBusinessContext)
settingsRouter.get('/', get)
settingsRouter.patch('/', requireWriteAccess, update)
