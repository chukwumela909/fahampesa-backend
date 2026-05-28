import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import type { FirebaseTokenVerifier } from './config/firebase.js'
import { FirebaseAdminTokenVerifier } from './config/firebase.js'
import { authMiddleware } from './middleware/auth.js'
import { errorHandler } from './middleware/error-handler.js'
import { authRouter, publicAuthRouter } from './routes/auth.routes.js'
import { branchRouter } from './routes/branch.routes.js'
import { transferRouter } from './routes/transfer.routes.js'
import { reportRouter } from './routes/report.routes.js'
import { settingsRouter } from './routes/settings.routes.js'
import { billingRouter } from './routes/billing.routes.js'
import { webhookRouter } from './routes/webhook.routes.js'
import { adminRouter } from './routes/admin.routes.js'
import { assetRouter } from './routes/asset.routes.js'
import { createPublicPlatformRouter, notificationRouter, platformAdminRouter } from './routes/platform.routes.js'
import { staffRouter } from './routes/staff.routes.js'
import type { ProductImageStorageUploader } from './services/asset.service.js'

export interface CreateAppOptions {
  tokenVerifier?: FirebaseTokenVerifier
  productImageUploader?: ProductImageStorageUploader
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const verifier = options.tokenVerifier ?? new FirebaseAdminTokenVerifier()
  if (options.productImageUploader) app.locals.productImageUploader = options.productImageUploader

  app.use(helmet())
  app.use(cors())
  app.use(express.json({ limit: '1mb' }))
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'))
  }

  app.get('/api/v1/health', (_req, res) => {
    res.json({ data: { status: 'ok' } })
  })

  app.use('/api/v1/webhooks', webhookRouter)
  app.use('/api/v1', createPublicPlatformRouter(verifier))
  app.use('/api/v1', publicAuthRouter)
  app.use('/api/v1', authMiddleware(verifier))
  app.use('/api/v1', authRouter)
  app.use('/api/v1/admin', adminRouter)
  app.use('/api/v1/admin', platformAdminRouter)
  app.use('/api/v1/assets', assetRouter)
  app.use('/api/v1/billing', billingRouter)
  app.use('/api/v1/branches', branchRouter)
  app.use('/api/v1/reports', reportRouter)
  app.use('/api/v1/settings', settingsRouter)
  app.use('/api/v1/notifications', notificationRouter)
  app.use('/api/v1/staff', staffRouter)
  app.use('/api/v1/transfers', transferRouter)

  app.use(errorHandler)
  return app
}
