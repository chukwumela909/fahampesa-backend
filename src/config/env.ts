import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/fahampesa'),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  SUPER_ADMIN_SECRET: z.string().optional(),
  MONGODB_ALLOW_STANDALONE_WRITES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  APP_BASE_URL: z.string().url().default('http://localhost:4000'),
  NEXT_PUBLIC_BASE_URL: z.string().url().optional(),
  // Web-app base used in staff invitation links; falls back to NEXT_PUBLIC_BASE_URL.
  STAFF_INVITE_BASE_URL: z.string().url().optional(),
  // Resend transactional email. Optional: when unset, emails are skipped (never blocks the action).
  RESEND_API_KEY: z.string().trim().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().trim().min(1).default('FahamPesa <no-reply@worldstreetgold.com>'),
  MPESA_SHORTCODE: z.string().trim().min(1).optional(),
  MPESA_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_PASSKEY: z.string().trim().min(1).optional(),
  MPESA_CONSUMER_KEY: z.string().trim().min(1).optional(),
  MPESA_CONSUMER_SECRET: z.string().trim().min(1).optional(),
  MPESA_CALLBACK_URL: z.string().url().optional(),
  STRIPE_SECRET_KEY: z.string().trim().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().trim().min(1).optional()
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return

  const requiredKeys = [
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_CALLBACK_URL',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET'
  ] as const

  for (const key of requiredKeys) {
    if (!value[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required in production`
      })
    }
  }
})

export const env = envSchema.parse(process.env)
