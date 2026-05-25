import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { ApiError } from '../utils/api-error.js'

interface BodyParserError extends Error {
  status?: number
  statusCode?: number
  type?: string
}

interface MulterLikeError extends Error {
  code?: string
  field?: string
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: err.flatten()
      }
    })
    return
  }

  const bodyParserError = err as BodyParserError
  if (bodyParserError.type === 'entity.parse.failed') {
    res.status(bodyParserError.statusCode ?? bodyParserError.status ?? 400).json({
      error: {
        code: 'invalid_json',
        message: 'Request body contains invalid JSON'
      }
    })
    return
  }

  const multerError = err as MulterLikeError
  if (multerError.name === 'MulterError') {
    if (multerError.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: {
          code: 'image_too_large',
          message: 'Product image must be 5 MB or smaller'
        }
      })
      return
    }

    res.status(422).json({
      error: {
        code: 'invalid_multipart',
        message: 'Multipart upload request is invalid',
        details: { code: multerError.code, field: multerError.field }
      }
    })
    return
  }

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    })
    return
  }

  // eslint-disable-next-line no-console
  console.error(err)
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Internal server error'
    }
  })
}
