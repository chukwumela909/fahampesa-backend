import crypto from 'node:crypto'
import type { NextFunction, Response } from 'express'
import type { Types } from 'mongoose'
import type { AppRequest } from '../types/http.js'
import { ApiError } from '../utils/api-error.js'
import { IdempotencyKeyModel } from '../models/idempotency-key.model.js'

const MIN_KEY_LENGTH = 8
const MAX_KEY_LENGTH = 255

/**
 * Collapses duplicate submissions that carry the same `Idempotency-Key` header.
 *
 * The first request inserts a `pending` record (guarded by a unique index), runs the
 * handler, and stores its successful response. Concurrent duplicates (e.g. a button
 * clicked four times) lose the unique-index race and get `409 idempotency_request_in_progress`;
 * later replays of a finished request get the original response back verbatim.
 *
 * The header is optional — requests without it pass straight through, so this is fully
 * backwards compatible. Reusing a key for a materially different request is rejected.
 */
export function idempotency(req: AppRequest, res: Response, next: NextFunction) {
  void handleIdempotency(req, res, next).catch(next)
}

async function handleIdempotency(req: AppRequest, res: Response, next: NextFunction) {
  const rawKey = req.header('idempotency-key')
  if (rawKey === undefined) {
    next()
    return
  }

  const key = rawKey.trim()
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
    throw new ApiError(
      400,
      'invalid_idempotency_key',
      `Idempotency-Key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters`
    )
  }

  const businessAccountId = req.context?.businessAccountId
  if (!businessAccountId) {
    // No business scope to key against — nothing to deduplicate.
    next()
    return
  }

  const method = req.method
  const path = req.originalUrl.split('?')[0]
  const requestHash = fingerprint(method, path, req.body)

  try {
    await IdempotencyKeyModel.create({ businessAccountId, key, method, path, requestHash, status: 'pending' })
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    await replayStoredResponse({ businessAccountId, key, method, path, requestHash }, res, next)
    return
  }

  captureResponse({ businessAccountId, key }, res)
  next()
}

interface ReplayParams {
  businessAccountId: Types.ObjectId
  key: string
  method: string
  path: string
  requestHash: string
}

async function replayStoredResponse(params: ReplayParams, res: Response, next: NextFunction) {
  const existing = await IdempotencyKeyModel.findOne({ businessAccountId: params.businessAccountId, key: params.key })
  if (!existing) {
    // The prior record was removed (failed request cleaned up) between the failed insert
    // and this lookup — let the caller retry the operation normally.
    next()
    return
  }

  if (existing.method !== params.method || existing.path !== params.path || existing.requestHash !== params.requestHash) {
    throw new ApiError(422, 'idempotency_key_reuse', 'Idempotency-Key was already used for a different request')
  }

  if (existing.status === 'completed') {
    res.status(existing.statusCode ?? 200).json(existing.responseBody)
    return
  }

  throw new ApiError(409, 'idempotency_request_in_progress', 'A request with this Idempotency-Key is already being processed')
}

function captureResponse(record: { businessAccountId: Types.ObjectId; key: string }, res: Response) {
  const originalJson = res.json.bind(res)

  // Persist the outcome BEFORE the response is flushed so that a replay arriving the instant
  // the client gets its answer always observes a `completed` record (never a stale `pending`).
  res.json = ((body: unknown) => {
    const isSuccess = res.statusCode >= 200 && res.statusCode < 300
    const persist = isSuccess
      ? IdempotencyKeyModel.updateOne(
          { businessAccountId: record.businessAccountId, key: record.key },
          { $set: { status: 'completed', statusCode: res.statusCode, responseBody: body } }
        )
      : // A non-2xx response is not a committed result — drop the guard so the client can retry.
        IdempotencyKeyModel.deleteOne({ businessAccountId: record.businessAccountId, key: record.key, status: 'pending' })

    persist
      .catch((error) => {
        console.error('[idempotency] failed to persist response for key', record.key, error)
      })
      .finally(() => {
        originalJson(body)
      })

    return res
  }) as Response['json']
}

function fingerprint(method: string, path: string, body: unknown) {
  const payload = JSON.stringify({ method, path, body: body ?? null })
  return crypto.createHash('sha256').update(payload).digest('hex')
}

function isDuplicateKeyError(error: unknown) {
  return (error as { code?: number }).code === 11000
}
