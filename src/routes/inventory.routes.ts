import { Router } from 'express'
import { adjust, alerts, list, movements } from '../controllers/inventory.controller.js'
import { requireWriteAccess } from '../middleware/auth.js'

export const inventoryRouter = Router({ mergeParams: true })

inventoryRouter.get('/', list)
inventoryRouter.post('/adjustments', requireWriteAccess, adjust)
inventoryRouter.get('/movements', movements)
inventoryRouter.get('/alerts', alerts)
