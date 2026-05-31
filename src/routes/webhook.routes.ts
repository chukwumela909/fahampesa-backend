import { Router } from 'express'
import { mpesaCallback } from '../controllers/webhook.controller.js'

export const webhookRouter = Router()

webhookRouter.post('/mpesa/callback', mpesaCallback)
