import { Router } from 'express'
import { bulkUpload, create, exportProducts, get, list, remove, update } from '../controllers/product.controller.js'
import { requireWriteAccess } from '../middleware/auth.js'
import { idempotency } from '../middleware/idempotency.js'

export const productRouter = Router({ mergeParams: true })

productRouter.get('/', list)
productRouter.post('/', requireWriteAccess, idempotency, create)
productRouter.post('/bulk-upload', requireWriteAccess, bulkUpload)
productRouter.get('/export', exportProducts)
productRouter.get('/:productId', get)
productRouter.patch('/:productId', requireWriteAccess, update)
productRouter.delete('/:productId', requireWriteAccess, remove)
