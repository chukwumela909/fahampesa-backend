import type { Response } from 'express'
import type { AppRequest } from '../types/http.js'
import { asyncHandler } from '../utils/async-handler.js'
import { objectIdSchema, toObjectId } from '../validators/common.js'
import { mpesaCheckoutSchema, stripeCheckoutSchema } from '../validators/billing.validator.js'
import { getBillingHistory, getCheckoutStatus, getCurrentSubscription, getPlans, getSubscriptionReceipt, startMpesaCheckout, startStripeCheckout } from '../services/billing.service.js'

export const plans = asyncHandler(async (_req: AppRequest, res: Response) => {
  res.json({ data: getPlans() })
})

export const subscription = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await getCurrentSubscription(req.context!) })
})

export const history = asyncHandler(async (req: AppRequest, res: Response) => {
  res.json({ data: await getBillingHistory(req.context!) })
})

export const receipt = asyncHandler(async (req: AppRequest, res: Response) => {
  const subscriptionId = toObjectId(objectIdSchema.parse(req.params.subscriptionId))
  res.json({ data: await getSubscriptionReceipt(req.context!, subscriptionId) })
})

export const checkoutStatus = asyncHandler(async (req: AppRequest, res: Response) => {
  const requestedId = req.params.subscriptionId ?? req.query.subscriptionId
  const subscriptionId = toObjectId(objectIdSchema.parse(requestedId))
  res.json({ data: await getCheckoutStatus(req.context!, subscriptionId) })
})

export const mpesaStkPush = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = mpesaCheckoutSchema.parse(req.body)
  res.status(201).json({ data: await startMpesaCheckout(req.context!, body) })
})

export const stripeCheckoutSession = asyncHandler(async (req: AppRequest, res: Response) => {
  const body = stripeCheckoutSchema.parse(req.body)
  res.status(201).json({ data: await startStripeCheckout(req.context!, body) })
})
