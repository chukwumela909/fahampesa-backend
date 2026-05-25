import type { ClientSession } from 'mongoose'
import type { AuthUser } from '../types/http.js'
import { UserModel } from '../models/user.model.js'
import { firebasePhoneExists } from '../config/firebase.js'

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
    if (auth.name && existing.fullName !== auth.name) {
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
}

export async function phoneExists(phone: string) {
  const existing = await UserModel.exists({ phone })
  if (existing) return true
  return firebasePhoneExists(phone)
}
