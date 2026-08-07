import type { NextFunction, Response } from 'express'
import type { FirebaseTokenVerifier } from '../config/firebase.js'
import type { AppRequest } from '../types/http.js'
import { ApiError } from '../utils/api-error.js'
import { findOrCreateUser } from '../services/user.service.js'
import { effectiveSubscriptionStatus, isBusinessWritable, resolveActiveMembership } from '../services/account.service.js'

export function authMiddleware(verifier: FirebaseTokenVerifier) {
  return async (req: AppRequest, _res: Response, next: NextFunction) => {
    try {
      const header = req.header('authorization')
      if (!header?.startsWith('Bearer ')) {
        throw new ApiError(401, 'missing_auth_token', 'Authorization bearer token is required')
      }

      const token = header.slice('Bearer '.length).trim()
      if (!token) throw new ApiError(401, 'missing_auth_token', 'Authorization bearer token is required')

      let auth
      try {
        auth = await verifier.verifyIdToken(token)
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          const firebaseError = error instanceof Error ? error.message : 'Unknown Firebase token verification error'
          console.warn(`[auth] Firebase token verification failed: ${firebaseError}`)
        }
        throw new ApiError(401, 'invalid_auth_token', 'Invalid authorization token')
      }
      const user = await findOrCreateUser(auth)
      if (user.disabled) {
        throw new ApiError(403, 'user_disabled', 'User account is disabled')
      }
      const resolved = await resolveActiveMembership(user._id)

      req.context = {
        auth: {
          ...auth
        },
        userId: user._id,
        assignedBranchIds: []
      }

      if (resolved) {
        req.context.businessAccountId = resolved.account._id
        req.context.role = resolved.membership.role
        req.context.membershipId = resolved.membership._id
        req.context.assignedBranchIds = resolved.membership.assignedBranchIds
        req.context.accountStatus = resolved.account.accountStatus
        req.context.planTier = resolved.account.planTier
        // Effective status so read endpoints (/me, /billing/subscription) reflect a lapsed
        // subscription; write-gating still re-checks the end date in isBusinessWritable.
        req.context.subscriptionStatus = effectiveSubscriptionStatus(resolved.account)
        req.context.subscriptionEndsAt = resolved.account.subscriptionEndsAt
        req.context.branchLimitOverride = resolved.account.branchLimitOverride
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}

export function requireBusinessContext(req: AppRequest, _res: Response, next: NextFunction) {
  if (!req.context?.businessAccountId || !req.context.role) {
    next(new ApiError(403, 'business_required', 'Business context required'))
    return
  }
  next()
}

export function requireWriteAccess(req: AppRequest, _res: Response, next: NextFunction) {
  if (!req.context?.businessAccountId || !req.context.accountStatus || !req.context.planTier || !req.context.subscriptionStatus) {
    next(new ApiError(403, 'business_required', 'Business context required'))
    return
  }

  const writable = isBusinessWritable({
    accountStatus: req.context.accountStatus,
    planTier: req.context.planTier,
    subscriptionStatus: req.context.subscriptionStatus,
    subscriptionEndsAt: req.context.subscriptionEndsAt
  })

  if (!writable) {
    const statusCode = req.context.accountStatus === 'active' ? 402 : 423
    next(new ApiError(statusCode, 'account_read_only', 'Account is read-only until subscription or account status is resolved'))
    return
  }

  next()
}

// Debtors, expenses, and suppliers are Pro-only: free accounts get no access at all
// (reads included), matching the web app's full-page PlanGate. subscriptionStatus here is
// the effective status (auth middleware derives it), so 'active' implies a live end date.
export function requirePaidPlan(req: AppRequest, _res: Response, next: NextFunction) {
  if (!req.context?.businessAccountId || !req.context.planTier || !req.context.subscriptionStatus) {
    next(new ApiError(403, 'business_required', 'Business context required'))
    return
  }

  const hasActivePaidAccess =
    req.context.planTier === 'paid' &&
    req.context.subscriptionStatus === 'active' &&
    !!req.context.subscriptionEndsAt &&
    req.context.subscriptionEndsAt.getTime() > Date.now()

  if (!hasActivePaidAccess) {
    next(new ApiError(403, 'plan_upgrade_required', 'This feature requires an active Pro subscription'))
    return
  }

  next()
}

export function requireRecentAuth(maxAgeMs = 5 * 60 * 1000) {
  return (req: AppRequest, _res: Response, next: NextFunction) => {
    const authTime = req.context?.auth.authTime
    if (!authTime) {
      next(new ApiError(403, 'recent_reauth_required', 'Recent reauthentication is required'))
      return
    }

    if (Date.now() - authTime.getTime() > maxAgeMs) {
      next(new ApiError(403, 'recent_reauth_required', 'Recent reauthentication is required'))
      return
    }

    next()
  }
}

export function requirePlatformAdmin(req: AppRequest, _res: Response, next: NextFunction) {
  if (req.context?.auth.platformRole !== 'admin') {
    next(new ApiError(403, 'platform_admin_required', 'Platform admin access is required'))
    return
  }
  next()
}
