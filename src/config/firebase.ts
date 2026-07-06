import admin from 'firebase-admin'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { env } from './env.js'
import type { AuthUser } from '../types/http.js'

export interface FirebaseTokenVerifier {
  verifyIdToken(token: string): Promise<AuthUser>
}

function initFirebaseAdmin() {
  if (admin.apps.length > 0) return

  const serviceAccountCredential = getServiceAccountCredential()
  if (serviceAccountCredential) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountCredential),
      storageBucket: env.FIREBASE_STORAGE_BUCKET
    })
    return
  }

  const hasFirebaseServiceAccountPath = Boolean(env.FIREBASE_SERVICE_ACCOUNT_PATH)
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

  if (hasFirebaseServiceAccountPath) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH must point to a valid Firebase service account JSON file.')
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

export async function listFirebaseAuthUsers(email?: string) {
  initFirebaseAdmin()
  if (email) {
    const user = await admin.auth().getUserByEmail(email)
    return [mapFirebaseUser(user)]
  }

  const result = await admin.auth().listUsers(1000)
  return result.users.map(mapFirebaseUser)
}

export async function setFirebaseAuthUserDisabled(uid: string, disabled: boolean) {
  initFirebaseAdmin()
  const user = await admin.auth().updateUser(uid, { disabled })
  return mapFirebaseUser(user)
}

export async function createFirebaseSuperAdmin(email: string, password: string | undefined, displayName: string) {
  initFirebaseAdmin()
  const normalizedEmail = email.toLowerCase()
  let user: admin.auth.UserRecord

  try {
    user = await admin.auth().getUserByEmail(normalizedEmail)
    user = await admin.auth().updateUser(user.uid, { displayName, emailVerified: true })
  } catch (error) {
    const firebaseError = error as { code?: string }
    if (firebaseError.code !== 'auth/user-not-found') throw error
    user = await admin.auth().createUser({ email: normalizedEmail, password, displayName, emailVerified: true })
  }

  await admin.auth().setCustomUserClaims(user.uid, {
    ...(user.customClaims ?? {}),
    platformRole: 'admin',
    role: 'super_admin',
    superAdmin: true,
    admin: true
  })

  return mapFirebaseUser(await admin.auth().getUser(user.uid))
}

export async function setPlatformAdminClaims(email: string, enabled: boolean) {
  initFirebaseAdmin()
  const user = await admin.auth().getUserByEmail(email.toLowerCase())
  const claims: Record<string, unknown> = { ...(user.customClaims ?? {}) }

  if (enabled) {
    claims.platformRole = 'admin'
    claims.admin = true
  } else {
    delete claims.platformRole
    delete claims.role
    delete claims.superAdmin
    delete claims.admin
  }

  await admin.auth().setCustomUserClaims(user.uid, claims)
  return mapFirebaseUser(await admin.auth().getUser(user.uid))
}

function hasExplicitFirebaseAdminConfig() {
  return Boolean(env.FIREBASE_SERVICE_ACCOUNT_PATH || (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY))
}

function mapFirebaseUser(user: admin.auth.UserRecord) {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    phoneNumber: user.phoneNumber,
    emailVerified: user.emailVerified,
    disabled: user.disabled,
    metadata: {
      creationTime: user.metadata.creationTime,
      lastSignInTime: user.metadata.lastSignInTime,
      lastRefreshTime: user.metadata.lastRefreshTime
    },
    customClaims: user.customClaims ?? {}
  }
}

function getServiceAccountCredential() {
  if (!env.FIREBASE_SERVICE_ACCOUNT_PATH) return undefined

  try {
    const serviceAccountPath = resolve(env.FIREBASE_SERVICE_ACCOUNT_PATH)
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as {
      project_id?: string
      projectId?: string
      client_email?: string
      clientEmail?: string
      private_key?: string
      privateKey?: string
    }

    const projectId = serviceAccount.project_id ?? serviceAccount.projectId
    const clientEmail = serviceAccount.client_email ?? serviceAccount.clientEmail
    const privateKey = serviceAccount.private_key ?? serviceAccount.privateKey

    if (!projectId || !clientEmail || !privateKey) return undefined

    return {
      projectId,
      clientEmail,
      privateKey: normalizeFirebasePrivateKey(privateKey)
    }
  } catch {
    return undefined
  }
}

export function normalizeFirebasePrivateKey(rawPrivateKey: string) {
  const trimmedPrivateKey = rawPrivateKey.trim()
  const directCandidates = [
    rawPrivateKey,
    trimmedPrivateKey,
    stripWrappingQuotes(trimmedPrivateKey),
    parseJsonPrivateKey(trimmedPrivateKey)
  ].filter((value): value is string => Boolean(value))

  const candidates = [
    ...directCandidates,
    ...directCandidates.map((candidate) => decodeBase64String(candidate)).filter((value): value is string => Boolean(value))
  ]

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

function parseJsonPrivateKey(value: string) {
  try {
    const parsed = JSON.parse(value)

    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object' && 'private_key' in parsed && typeof parsed.private_key === 'string') {
      return parsed.private_key
    }

    return undefined
  } catch {
    return parseJsonString(value)
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
