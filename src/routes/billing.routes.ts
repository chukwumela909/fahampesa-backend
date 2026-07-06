import { Router } from 'express'
import { checkoutStatus, history, mpesaStkPush, plans, receipt, stripeCheckoutSession, subscription } from '../controllers/billing.controller.js'
import { requireBusinessContext } from '../middleware/auth.js'

export const billingRouter = Router()

billingRouter.use(requireBusinessContext)
billingRouter.get('/plans', plans)
billingRouter.get('/subscription', subscription)
billingRouter.get('/history', history)
billingRouter.get('/receipts/:subscriptionId', receipt)
billingRouter.get('/checkout-status', checkoutStatus)
billingRouter.get('/checkout-status/:subscriptionId', checkoutStatus)
// Paid access is only ever granted through a real payment (M-Pesa/Stripe) or an audited
// platform-admin action (POST /admin/businesses/:id/subscriptions/manual-activate).
billingRouter.post('/mpesa/stk-push', mpesaStkPush)
billingRouter.post('/stripe/checkout-session', stripeCheckoutSession)
