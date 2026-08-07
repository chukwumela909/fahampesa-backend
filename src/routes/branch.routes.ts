import { Router } from 'express'
import { create, disable, enable, get, list, remove, update } from '../controllers/branch.controller.js'
import { requireBusinessContext, requirePaidPlan, requireRecentAuth, requireWriteAccess } from '../middleware/auth.js'
import { inventoryRouter } from './inventory.routes.js'
import { productRouter } from './product.routes.js'
import { debtorRouter } from './debtor.routes.js'
import { expenseRouter } from './expense.routes.js'
import { saleRouter } from './sale.routes.js'
import { purchaseOrderRouter } from './purchase-order.routes.js'
import { supplierRouter } from './supplier.routes.js'
import { branchDashboard } from '../controllers/report.controller.js'

export const branchRouter = Router()

branchRouter.use(requireBusinessContext)

branchRouter.get('/', list)
branchRouter.post('/', requireWriteAccess, create)
branchRouter.get('/:branchId/dashboard', branchDashboard)
branchRouter.use('/:branchId/products', productRouter)
branchRouter.use('/:branchId/inventory', inventoryRouter)
branchRouter.use('/:branchId/sales', saleRouter)
branchRouter.use('/:branchId/expenses', requirePaidPlan, expenseRouter)
branchRouter.use('/:branchId/debtors', requirePaidPlan, debtorRouter)
branchRouter.use('/:branchId/suppliers', requirePaidPlan, supplierRouter)
branchRouter.use('/:branchId/purchase-orders', purchaseOrderRouter)
branchRouter.get('/:branchId', get)
branchRouter.patch('/:branchId', requireWriteAccess, update)
branchRouter.post('/:branchId/disable', requireWriteAccess, requireRecentAuth(), disable)
branchRouter.post('/:branchId/enable', requireWriteAccess, enable)
branchRouter.delete('/:branchId', requireWriteAccess, remove)
