# Frontend Auth and Business Onboarding API Guide

Use Firebase Auth on the frontend for identity. This backend expects Firebase ID tokens on protected requests and owns business registration, business membership, onboarding progress, and authorization context.

## Base URL

```txt
http://localhost:4000/api/v1
```

For protected routes, send:

```http
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

In Firebase Web SDK:

```ts
const token = await firebaseUser.getIdToken()
```

## Registration Flow

1. Create or sign in the user with Firebase Auth.
2. Optionally verify/link the phone number with Firebase phone auth on the frontend.
3. Call `GET /me` to see whether the user already has a business.
4. If no business exists, route the user into onboarding.
5. Save onboarding draft progress as the user moves between steps.
6. When complete, call `POST /onboarding/business`.

## Public Phone Lookup

Use before phone-login OTP to avoid sending OTP for unknown phone numbers.

```http
GET /auth/phone-exists?phone=%2B254700000000
```

Response:

```json
{
  "data": {
    "exists": true
  }
}
```

## Session Bootstrap

```http
GET /me
```

Response shape:

```json
{
  "data": {
    "auth": {
      "firebaseUid": "abc",
      "email": "owner@example.com",
      "phone": "+254700000000",
      "name": "Owner User",
      "platformRole": "admin"
    },
    "userId": "mongo-user-id",
    "businessAccountId": "mongo-business-id-or-null",
    "role": "owner",
    "assignedBranchIds": ["branch-id"],
    "accountStatus": "active",
    "planTier": "free",
    "subscriptionStatus": "none",
    "subscriptionEndsAt": null,
    "onboardingStatus": {
      "completed": true,
      "skipped": false,
      "currentStep": 7,
      "completedSteps": [],
      "skippedSteps": [],
      "hasOnboardingData": true,
      "hasBusiness": true,
      "businessAccountId": "mongo-business-id",
      "status": "completed",
      "data": {}
    }
  }
}
```

Frontend routing suggestion:

- `businessAccountId` present or `onboardingStatus.hasBusiness === true`: go to dashboard.
- `onboardingStatus.completed === false`: go to onboarding.
- `onboardingStatus.skipped === true` and no business: allow limited/empty dashboard only if the app supports it.
- `auth.platformRole === "admin"`: route to platform admin UI if needed.

## Get Onboarding Status

```http
GET /onboarding/status
```

Use this if you need onboarding status without the full `/me` response.

## Save Onboarding Draft

```http
PUT /onboarding/progress
```

Example:

```json
{
  "currentStep": 3,
  "completedSteps": [1, 2],
  "skippedSteps": [],
  "data": {
    "personalProfile": {
      "fullName": "Owner User",
      "phoneNumber": "+254700000000"
    },
    "companyProfile": {
      "legalCompanyName": "Faham Test Shop Ltd",
      "registrationNumber": "C123456789"
    }
  }
}
```

Response returns the saved onboarding state.

## Skip Onboarding

```http
POST /onboarding/skip
```

Example:

```json
{
  "currentStep": 7,
  "skippedSteps": [3, 4, 5, 6],
  "data": {
    "reason": "user_skipped_setup"
  }
}
```

This marks onboarding as skipped. It does not create a business account.

## Complete Business Onboarding

```http
POST /onboarding/business
```

Example payload:

```json
{
  "personalProfile": {
    "fullName": "Owner User",
    "phoneNumber": "+254700000000",
    "phoneVerified": true
  },
  "companyProfile": {
    "legalCompanyName": "Faham Test Shop Ltd",
    "registrationNumber": "C123456789"
  },
  "business": {
    "businessName": "Faham Test Shop",
    "businessType": "retail",
    "country": "Kenya",
    "currency": "KES"
  },
  "branch": {
    "name": "Main Branch",
    "location": {
      "address": "123 Test Street",
      "city": "Nairobi",
      "region": "Nairobi",
      "country": "Kenya"
    },
    "contact": {
      "phone": "+254700000000",
      "email": "branch@example.com",
      "whatsapp": "+254700000000"
    },
    "branchCode": "MAIN",
    "branchType": "MAIN",
    "currency": "KES"
  },
  "staffInvitations": [
    {
      "email": "manager@example.com",
      "role": "manager",
      "branchIds": ["branch-id"],
      "permissions": ["inventory:read"]
    },
    {
      "email": "cashier@example.com",
      "role": "staff"
    }
  ]
}
```

Required fields:

- `business.businessName`
- `business.businessType`
- `business.country`
- `business.currency`
- `branch.name`
- `branch.location.address`

Response:

```json
{
  "data": {
    "businessAccount": {
      "id": "business-id",
      "businessName": "Faham Test Shop",
      "businessType": "retail",
      "legalCompanyName": "Faham Test Shop Ltd",
      "registrationNumber": "C123456789",
      "country": "Kenya",
      "billingRegion": "KENYA",
      "currency": "KES",
      "accountStatus": "active",
      "planTier": "free",
      "subscriptionStatus": "none"
    },
    "branch": {
      "id": "branch-id",
      "name": "Main Branch",
      "status": "active"
    },
    "membership": {
      "id": "membership-id",
      "role": "owner",
      "assignedBranchIds": ["branch-id"]
    },
    "staffInvitations": []
  }
}
```

When `staffInvitations` are supplied, each returned invitation includes an `inviteUrl`:

```json
{
  "id": "invitation-id",
  "email": "cashier@example.com",
  "role": "cashier",
  "status": "pending",
  "expiresAt": "2026-06-10T10:00:00.000Z",
  "assignedBranchIds": ["branch-id"],
  "permissions": [],
  "inviteUrl": "https://app.example.com/staff/invite?token=raw-token"
}
```

If onboarding omits `branchIds`, the invitation is assigned to the first/main branch created by onboarding.

After success, refresh `/me` and route to the dashboard.

## Staff Invite Link Flow

Owners and managers can create staff invitations after onboarding:

```http
POST /staff/invitations
```

```json
{
  "email": "cashier@example.com",
  "role": "cashier",
  "branchIds": ["branch-id"],
  "permissions": ["sales:read"]
}
```

Open the returned `inviteUrl` on the frontend. The frontend should:

1. Read `token` from `/staff/invite?token=...`.
2. Sign in or sign up the staff member with Firebase.
3. Call `POST /staff/invitations/accept` with the Firebase ID token.

```json
{
  "token": "raw-token-from-url"
}
```

The Firebase account email must match the invited email. On success, call `/me`; it will include the new `businessAccountId`, role, membership, and branch access for dashboard routing.

## Important Error Codes

- `401 missing_auth_token`: protected route called without Firebase bearer token.
- `401 invalid_auth_token`: Firebase token invalid/expired.
- `409 business_already_exists`: user already has an active business membership.
- `400 invalid_json`: request body is malformed.
- `400 validation_error`: payload failed schema validation.

## Frontend Notes

- Do not send `userId`, `businessAccountId`, or owner IDs from the frontend for onboarding. The backend derives identity from the Firebase token.
- Phone OTP sending and verification should remain in Firebase Web SDK unless a separate backend phone-auth flow is built later.
- `staffInvitations` now creates 7-day invite links. Email sending is not included yet; display or send the returned `inviteUrl` from the frontend/admin workflow.
- The backend maps Kenya accounts to M-Pesa billing region from `business.country === "Kenya"`; all other countries map to Stripe/other billing region.
