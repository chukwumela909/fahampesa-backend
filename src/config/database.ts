import mongoose from 'mongoose'
import { env } from './env.js'
import { ensureProductIdentityIndexes } from '../models/product.model.js'
import { ensureBranchIdentityIndexes } from '../models/branch.model.js'

export async function connectDatabase(uri = env.MONGODB_URI) {
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri)
  // Runs in production too: legacy deployments carry a stale plain-unique index on
  // (businessAccountId, branchCode) that blocks creating a second branch without a code.
  await ensureBranchIdentityIndexes()
  if (env.NODE_ENV !== 'production') {
    await ensureProductIdentityIndexes()
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect()
}

export async function withTransaction<T>(work: (session: mongoose.ClientSession) => Promise<T>) {
  const session = await mongoose.startSession()
  try {
    let result!: T
    try {
      await session.withTransaction(async () => {
        result = await work(session)
      })
    } catch (error) {
      if (!canFallbackToStandaloneWrite(error)) throw error

      console.warn('[database] MongoDB transactions are unavailable; retrying write without a transaction for local development.')
      result = await work(session)
    }
    return result
  } finally {
    await session.endSession()
  }
}

function canFallbackToStandaloneWrite(error: unknown) {
  if (env.NODE_ENV === 'production' || !env.MONGODB_ALLOW_STANDALONE_WRITES) return false

  const mongoError = error as { code?: number; codeName?: string; message?: string }
  return (
    mongoError.code === 20 ||
    mongoError.codeName === 'IllegalOperation' ||
    mongoError.message?.includes('Transaction numbers are only allowed on a replica set member or mongos') === true
  )
}
