import { Router } from 'express'
import { activateMonthly, checkoutStatus, history, mpesaStkPush, plans, receipt, stripeCheckoutSession, subscription } from '../controllers/billing.controller.js'
import { requireBusinessContext } from '../middleware/auth.js'

export const billingRouter = Router()

billingRouter.use(requireBusinessContext)
billingRouter.get('/plans', plans)
billingRouter.get('/subscription', subscription)
billingRouter.get('/history', history)
billingRouter.get('/receipts/:subscriptionId', receipt)
billingRouter.get('/checkout-status', checkoutStatus)
billingRouter.get('/checkout-status/:subscriptionId', checkoutStatus)
billingRouter.post('/subscription/activate', activateMonthly)
billingRouter.post('/mpesa/stk-push', mpesaStkPush)
billingRouter.post('/stripe/checkout-session', stripeCheckoutSession)
