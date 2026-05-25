import { randomUUID } from 'node:crypto'
import type { Types } from 'mongoose'
import { getFirebaseStorageBucket } from '../config/firebase.js'
import type { RequestContext } from '../types/http.js'
import { ApiError } from '../utils/api-error.js'

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const PRODUCT_IMAGE_FIELD = 'image'

const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'] as const

type AllowedImageType = (typeof allowedImageTypes)[number]

export interface ProductImageUploadFile {
  buffer: Buffer
  originalName: string
  mimeType: string
  size: number
}

export interface ProductImageStorageInput {
  storagePath: string
  buffer: Buffer
  contentType: AllowedImageType
  downloadToken: string
}

export interface ProductImageStorageUploader {
  upload(input: ProductImageStorageInput): Promise<{ url: string }>
}

export interface ProductImageUploadResult {
  url: string
  storagePath: string
  contentType: AllowedImageType
  size: number
}

export class FirebaseProductImageStorageUploader implements ProductImageStorageUploader {
  async upload(input: ProductImageStorageInput) {
    const bucket = getFirebaseStorageBucket()
    const file = bucket.file(input.storagePath)

    await file.save(input.buffer, {
      resumable: false,
      metadata: {
        contentType: input.contentType,
        metadata: {
          firebaseStorageDownloadTokens: input.downloadToken
        }
      }
    })

    return {
      url: buildFirebaseDownloadUrl(bucket.name, input.storagePath, input.downloadToken)
    }
  }
}

const firebaseProductImageStorageUploader = new FirebaseProductImageStorageUploader()

export function isAllowedProductImageMimeType(value: string): value is AllowedImageType {
  return allowedImageTypes.includes(value as AllowedImageType)
}

export async function uploadProductImage(
  context: RequestContext,
  file: ProductImageUploadFile,
  uploader: ProductImageStorageUploader = firebaseProductImageStorageUploader
): Promise<ProductImageUploadResult> {
  requireManagerRole(context)

  if (!isAllowedProductImageMimeType(file.mimeType)) {
    throw new ApiError(422, 'unsupported_image_type', 'Product image must be JPEG, PNG, or WebP')
  }

  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    throw new ApiError(413, 'image_too_large', 'Product image must be 5 MB or smaller')
  }

  const downloadToken = randomUUID()
  const storagePath = buildProductImageStoragePath(context.businessAccountId!, file.mimeType)
  const uploaded = await uploader.upload({
    storagePath,
    buffer: file.buffer,
    contentType: file.mimeType,
    downloadToken
  })

  return {
    url: uploaded.url,
    storagePath,
    contentType: file.mimeType,
    size: file.size
  }
}

function buildProductImageStoragePath(businessAccountId: Types.ObjectId, contentType: AllowedImageType) {
  return `businesses/${businessAccountId.toString()}/products/${randomUUID()}${extensionForContentType(contentType)}`
}

function extensionForContentType(contentType: AllowedImageType) {
  if (contentType === 'image/jpeg') return '.jpg'
  if (contentType === 'image/png') return '.png'
  return '.webp'
}

function buildFirebaseDownloadUrl(bucketName: string, storagePath: string, token: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(token)}`
}

function requireManagerRole(context: RequestContext) {
  if (!context.businessAccountId || !context.role) {
    throw new ApiError(403, 'business_required', 'Business context required')
  }
  if (context.role !== 'owner' && context.role !== 'manager') {
    throw new ApiError(403, 'manager_required', 'Only owners and managers can upload product images')
  }
}
