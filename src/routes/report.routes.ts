import { Router } from 'express'
import { branchPerformance, dashboard, expenses, inventoryValuation, lowStock, sales, suppliers } from '../controllers/report.controller.js'
import { requireBusinessContext } from '../middleware/auth.js'

export const reportRouter = Router()

reportRouter.use(requireBusinessContext)
reportRouter.get('/dashboard', dashboard)
reportRouter.get('/sales', sales)
reportRouter.get('/inventory-valuation', inventoryValuation)
reportRouter.get('/low-stock', lowStock)
reportRouter.get('/suppliers', suppliers)
reportRouter.get('/expenses', expenses)
reportRouter.get('/branch-performance', branchPerformance)
