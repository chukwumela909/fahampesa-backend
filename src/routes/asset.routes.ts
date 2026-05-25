import { Router } from 'express'
import multer from 'multer'
import { uploadProductImageAsset } from '../controllers/asset.controller.js'
import { requireBusinessContext, requireWriteAccess } from '../middleware/auth.js'
import { ApiError } from '../utils/api-error.js'
import { PRODUCT_IMAGE_FIELD, PRODUCT_IMAGE_MAX_BYTES, isAllowedProductImageMimeType } from '../services/asset.service.js'

export const assetRouter = Router()

const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: PRODUCT_IMAGE_MAX_BYTES,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    if (isAllowedProductImageMimeType(file.mimetype)) {
      cb(null, true)
      return
    }

    cb(new ApiError(422, 'unsupported_image_type', 'Product image must be JPEG, PNG, or WebP'))
  }
})

assetRouter.use(requireBusinessContext)
assetRouter.post('/product-images', requireWriteAccess, productImageUpload.single(PRODUCT_IMAGE_FIELD), uploadProductImageAsset)
