import type { Request, Response } from 'express'
import { asyncHandler } from '../utils/async-handler.js'
import { mpesaCallbackSchema } from '../validators/billing.validator.js'
import { processMpesaCallback, processStripeWebhookRaw } from '../services/billing.service.js'

export const mpesaCallback = asyncHandler(async (req: Request, res: Response) => {
  const body = mpesaCallbackSchema.parse(req.body)
  res.json({ data: await processMpesaCallback(body) })
})

export const stripeWebhook = asyncHandler(async (req: Request, res: Response) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}))
  res.json({ data: await processStripeWebhookRaw(rawBody, req.header('stripe-signature') ?? undefined) })
})
