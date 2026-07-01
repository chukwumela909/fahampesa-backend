/**
 * One-off operational script: grant super admin access to an email.
 *
 * Uses the same service path the API uses (createSuperAdminUser ->
 * createFirebaseSuperAdmin), so it sets BOTH:
 *   - Firebase custom claims (platformRole=admin, role=super_admin, ...) -> the real auth gate
 *   - Mongo User.platformRole=admin + PlatformAdminUserModel role=super_admin -> admin listing
 *
 * Idempotent: elevates the account if it already exists, creates it otherwise.
 *
 * Usage:
 *   npx tsx scripts/create-super-admin.ts <email> "<displayName>" [password]
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database.js'
import { createSuperAdminUser } from '../src/services/platform.service.js'
import { createFirebaseSuperAdmin } from '../src/config/firebase.js'

async function main() {
  const [email, displayName, password] = process.argv.slice(2)
  if (!email || !displayName) {
    throw new Error('Usage: tsx scripts/create-super-admin.ts <email> "<displayName>" [password]')
  }

  console.log(`[super-admin] Connecting to MongoDB...`)
  await connectDatabase()

  console.log(`[super-admin] Granting super admin to ${email} (${displayName})...`)
  const result = await createSuperAdminUser(undefined, { email, displayName, password })

  console.log(`[super-admin] Mongo records written. User.platformRole + PlatformAdminUser role set.`)

  // createSuperAdminUser swallows Firebase failures (firebaseUser=null). The Firebase
  // custom claims are the real auth gate, so verify they were set; re-run directly to
  // surface the real error if they weren't.
  if (!result.firebaseUser) {
    console.warn('[super-admin] Firebase custom claims were NOT set by the service. Retrying directly to surface the error...')
    const firebaseUser = await createFirebaseSuperAdmin(email, password, displayName)
    console.log('[super-admin] Firebase custom claims set on retry:', firebaseUser.customClaims)
  } else {
    const claims = (result.firebaseUser as { customClaims?: unknown }).customClaims
    console.log('[super-admin] Firebase custom claims set:', claims)
  }

  console.log(`[super-admin] Done. ${email} now has super admin access.`)
  console.log('[super-admin] Note: the account must obtain a fresh ID token (sign out/in) for new claims to take effect.')
}

main()
  .then(async () => {
    await disconnectDatabase()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('[super-admin] Failed:', error instanceof Error ? error.message : error)
    await disconnectDatabase().catch(() => {})
    process.exit(1)
  })
