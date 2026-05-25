import { Router } from 'express'
import { mpesaCallback, stripeWebhook } from '../controllers/webhook.controller.js'

export const webhookRouter = Router()

webhookRouter.post('/mpesa/callback', mpesaCallback)
webhookRouter.post('/stripe', stripeWebhook)
