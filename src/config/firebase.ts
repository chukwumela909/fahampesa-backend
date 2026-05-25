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
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
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

function getPlatformRole(decoded: Record<string, unknown>): AuthUser['platformRole'] {
  if (decoded.platformRole === 'admin') return 'admin'
  if (decoded.role === 'super_admin' || decoded.role === 'admin') return 'admin'
  if (decoded.superAdmin === true || decoded.admin === true) return 'admin'
  return undefined
}
