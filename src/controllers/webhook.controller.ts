import type { Request, Response } from 'express'
import { asyncHandler } from '../utils/async-handler.js'
import { mpesaCallbackSchema, stripeWebhookSchema } from '../validators/billing.validator.js'
import { processMpesaCallback, processStripeWebhook } from '../services/billing.service.js'

export const mpesaCallback = asyncHandler(async (req: Request, res: Response) => {
  const body = mpesaCallbackSchema.parse(req.body)
  res.json({ data: await processMpesaCallback(body) })
})

export const stripeWebhook = asyncHandler(async (req: Request, res: Response) => {
  const body = stripeWebhookSchema.parse(req.body)
  res.json({ data: await processStripeWebhook(body) })
})
