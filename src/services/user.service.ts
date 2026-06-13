import type { ClientSession, Types } from 'mongoose'
import type { AuthUser } from '../types/http.js'
import { UserModel } from '../models/user.model.js'
import { firebasePhoneExists } from '../config/firebase.js'
import { notFound } from '../utils/api-error.js'

export async function findOrCreateUser(auth: AuthUser, session?: ClientSession) {
  const existing = await UserModel.findOne({ firebaseUid: auth.firebaseUid }).session(session ?? null)
  if (existing) {
    let changed = false
    if (auth.email && existing.email !== auth.email) {
      existing.email = auth.email
      changed = true
    }
    if (auth.phone && existing.phone !== auth.phone) {
      existing.phone = auth.phone
      changed = true
    }
    // Only backfill the name from the auth token when the user has not set one,
    // so profile edits made via PATCH /me are not clobbered on the next request.
    if (auth.name && !existing.fullName) {
      existing.fullName = auth.name
      changed = true
    }
    if (auth.phone && !existing.phoneVerified) {
      existing.phoneVerified = true
      changed = true
    }
    existing.lastLoginAt = new Date()
    changed = true
    if (changed) await existing.save({ session })
    return existing
  }

  try {
    const [created] = await UserModel.create(
      [
        {
          firebaseUid: auth.firebaseUid,
          email: auth.email,
          phone: auth.phone,
          fullName: auth.name,
          phoneVerified: Boolean(auth.phone),
          lastLoginAt: new Date()
        }
      ],
      { session }
    )
    return created
  } catch (error) {
    // A concurrent request (e.g. the auth listener's /me racing an invite accept) may insert
    // the same firebaseUid first. The unique index rejects the duplicate — fall back to the
    // row the other request created instead of surfacing a spurious failure.
    if ((error as { code?: number }).code === 11000) {
      const raced = await UserModel.findOne({ firebaseUid: auth.firebaseUid }).session(session ?? null)
      if (raced) return raced
    }
    throw error
  }
}

export async function updateUserProfile(userId: Types.ObjectId, input: { fullName?: string; phone?: string }) {
  const user = await UserModel.findById(userId)
  if (!user) throw notFound('User not found')
  if (input.fullName !== undefined) user.fullName = input.fullName
  if (input.phone !== undefined) user.phone = input.phone
  await user.save()
  return user
}

export async function phoneExists(phone: string) {
  const existing = await UserModel.exists({ phone })
  if (existing) return true
  return firebasePhoneExists(phone)
}
