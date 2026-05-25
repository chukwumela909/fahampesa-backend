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
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  MONGODB_ALLOW_STANDALONE_WRITES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  APP_BASE_URL: z.string().url().default('http://localhost:4000')
})

export const env = envSchema.parse(process.env)
