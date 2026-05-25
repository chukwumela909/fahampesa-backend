import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { ApiError } from '../utils/api-error.js'
import { asyncHandler } from '../utils/async-handler.js'
import { uploadProductImage, type ProductImageStorageUploader } from '../services/asset.service.js'

export const uploadProductImageAsset = asyncHandler(async (req: AppRequest, res: Response) => {
  if (!req.file) {
    throw new ApiError(422, 'image_required', 'Product image file is required')
  }

  const uploader = req.app.locals.productImageUploader as ProductImageStorageUploader | undefined
  const result = await uploadProductImage(
    req.context!,
    {
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    },
    uploader
  )

  res.status(201).json({ data: result })
})
