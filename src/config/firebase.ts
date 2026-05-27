import admin from 'firebase-admin'
import { env } from './env.js'
import type { AuthUser } from '../types/http.js'

export interface FirebaseTokenVerifier {
  verifyIdToken(token: string): Promise<AuthUser>
}

function initFirebaseAdmin() {
  if (admin.apps.length > 0) return

  const firebaseAdminConfig = {
    FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: env.FIREBASE_PRIVATE_KEY
  }
  const missingFirebaseAdminVars = Object.entries(firebaseAdminConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  const hasFirebaseAdminConfig = missingFirebaseAdminVars.length < Object.keys(firebaseAdminConfig).length

  if (hasFirebaseAdminConfig && missingFirebaseAdminVars.length > 0) {
    throw new Error(`Firebase Admin SDK config is incomplete. Missing: ${missingFirebaseAdminVars.join(', ')}`)
  }

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: normalizeFirebasePrivateKey(env.FIREBASE_PRIVATE_KEY)
      }),
      storageBucket: env.FIREBASE_STORAGE_BUCKET
    })
    return
  }

  admin.initializeApp(env.FIREBASE_STORAGE_BUCKET ? { storageBucket: env.FIREBASE_STORAGE_BUCKET } : undefined)
}

export class FirebaseAdminTokenVerifier implements FirebaseTokenVerifier {
  constructor() {
    initFirebaseAdmin()
  }

  async verifyIdToken(token: string): Promise<AuthUser> {
    const decoded = await admin.auth().verifyIdToken(token)
    const platformRole = getPlatformRole(decoded as Record<string, unknown>)
    return {
      firebaseUid: decoded.uid,
      email: decoded.email,
      phone: decoded.phone_number,
      name: decoded.name,
      authTime: decoded.auth_time ? new Date(decoded.auth_time * 1000) : undefined,
      platformRole
    }
  }
}

export async function firebasePhoneExists(phone: string) {
  if (admin.apps.length === 0 && !hasExplicitFirebaseAdminConfig()) return false

  try {
    initFirebaseAdmin()
    await admin.auth().getUserByPhoneNumber(phone)
    return true
  } catch (error) {
    const firebaseError = error as { code?: string }
    if (firebaseError.code === 'auth/user-not-found') return false

    if (process.env.NODE_ENV !== 'production') {
      const message = error instanceof Error ? error.message : 'Unknown Firebase phone lookup error'
      console.warn(`[auth] Firebase phone lookup skipped: ${message}`)
    }
    return false
  }
}

export function getFirebaseStorageBucket() {
  if (!env.FIREBASE_STORAGE_BUCKET) {
    throw new Error('FIREBASE_STORAGE_BUCKET is required to upload Firebase Storage assets')
  }

  initFirebaseAdmin()
  return admin.storage().bucket(env.FIREBASE_STORAGE_BUCKET)
}

function hasExplicitFirebaseAdminConfig() {
  return Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY)
}

export function normalizeFirebasePrivateKey(rawPrivateKey: string) {
  const candidates = [
    rawPrivateKey,
    rawPrivateKey.trim(),
    stripWrappingQuotes(rawPrivateKey.trim()),
    parseJsonString(rawPrivateKey.trim()),
    decodeBase64String(rawPrivateKey.trim())
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    const normalized = candidate
      .trim()
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\r\n/g, '\n')
      .trim()

    if (isPemPrivateKey(normalized)) return normalized
  }

  throw new Error(
    'FIREBASE_PRIVATE_KEY must be a valid PEM private key. Use the service account private_key value with escaped newlines (\\n), a JSON-escaped string, or a base64-encoded PEM.'
  )
}

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function parseJsonString(value: string) {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

function decodeBase64String(value: string) {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value)) return undefined

  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8').trim()
    return isPemPrivateKey(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

function isPemPrivateKey(value: string) {
  return value.startsWith('-----BEGIN PRIVATE KEY-----') && value.endsWith('-----END PRIVATE KEY-----')
}

function getPlatformRole(decoded: Record<string, unknown>): AuthUser['platformRole'] {
  if (decoded.platformRole === 'admin') return 'admin'
  if (decoded.role === 'super_admin' || decoded.role === 'admin') return 'admin'
  if (decoded.superAdmin === true || decoded.admin === true) return 'admin'
  return undefined
}
