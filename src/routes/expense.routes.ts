import { Router } from 'express'
import { create, list, remove, update } from '../controllers/expense.controller.js'
import { requireWriteAccess } from '../middleware/auth.js'

export const expenseRouter = Router({ mergeParams: true })

expenseRouter.get('/', list)
expenseRouter.post('/', requireWriteAccess, create)
expenseRouter.patch('/:expenseId', requireWriteAccess, update)
expenseRouter.delete('/:expenseId', requireWriteAccess, remove)
