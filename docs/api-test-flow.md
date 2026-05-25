# FahamPesa API Test Flow

Use this as the canonical backend API flow for manual testing and frontend handoff.
For the complete current endpoint catalog, see `docs/api-reference.md`.
For a frontend-agent-only brief, see `docs/frontend-auth-onboarding-guide.md`.

Base URL:

```text
http://localhost:4000
```

Auth header for protected requests:

```http
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

Fresh auth header for destructive/re-authenticated requests:

```http
Authorization: Bearer <FRESH_FIREBASE_ID_TOKEN>
Content-Type: application/json
```

## Frontend Handoff Summary

Firebase Auth owns identity on the frontend. The backend expects a Firebase ID
token on every protected API call and derives the app user, business account,
membership, and branch access from that token.

Recommended frontend flow:

1. Create or sign in the user with Firebase Auth.
2. Optionally link or verify the phone number with Firebase phone auth.
3. Call `GET /api/v1/me`.
4. If the response has `businessAccountId` or `onboardingStatus.hasBusiness`, route to the dashboard.
5. If no business exists, route to onboarding.
6. Persist onboarding drafts with `PUT /api/v1/onboarding/progress`.
7. Finish setup with `POST /api/v1/onboarding/business`.
8. Refresh `GET /api/v1/me` and route to the dashboard.

Current auth and onboarding endpoints:

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/auth/phone-exists?phone=<E164_PHONE>` | Public | Check whether a phone number exists in Firebase before sending OTP. |
| `GET` | `/api/v1/me` | Firebase bearer token | Bootstrap current user, business, role, subscription, and onboarding state. |
| `GET` | `/api/v1/onboarding/status` | Firebase bearer token | Fetch only onboarding status. |
| `PUT` | `/api/v1/onboarding/progress` | Firebase bearer token | Save draft onboarding progress. |
| `POST` | `/api/v1/onboarding/skip` | Firebase bearer token | Mark onboarding as skipped without creating a business. |
| `POST` | `/api/v1/onboarding/business` | Firebase bearer token | Create the business account, first branch, owner membership, and optional staff invitation records. |

## Flow 1: Health Check

### Request

```http
GET /api/v1/health
```

### Body

```json
null
```

### Expected Response: 200

```json
{
  "data": {
    "status": "ok"
  }
}
```

## Flow 2: Public Phone Lookup

### Request

```http
GET /api/v1/auth/phone-exists?phone=%2B254700000000
```

### Body

```json
null
```

### Expected Response: 200

```json
{
  "data": {
    "exists": true
  }
}
```

### Flow Note

This route is public. Use it before phone-login OTP if the frontend wants to avoid
sending OTPs to unknown phone numbers.

## Flow 3: Auth Context Before Onboarding

### Request

```http
GET /api/v1/me
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

### Body

```json
null
```

### Expected Response: 200

```json
{
  "data": {
    "auth": {
      "firebaseUid": "string",
      "email": "string",
      "phone": "string",
      "name": "string",
      "platformRole": null,
      "authTime": "ISO date string"
    },
    "userId": "string",
    "assignedBranchIds": [],
    "subscriptionEndsAt": null,
    "onboardingStatus": {
      "completed": false,
      "skipped": false,
      "currentStep": 1,
      "completedSteps": [],
      "skippedSteps": [],
      "hasOnboardingData": false,
      "hasBusiness": false,
      "businessAccountId": null,
      "status": "not_started",
      "data": {}
    }
  }
}
```

### Flow Note

Before onboarding, `businessAccountId`, `role`, `planTier`, and account/subscription fields may be absent.

## Flow 4: Get Onboarding Status

### Request

```http
GET /api/v1/onboarding/status
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

### Body

```json
null
```

### Expected Response: 200

```json
{
  "data": {
    "completed": false,
    "skipped": false,
    "currentStep": 1,
    "completedSteps": [],
    "skippedSteps": [],
    "hasOnboardingData": false,
    "hasBusiness": false,
    "businessAccountId": null,
    "status": "not_started",
    "data": {}
  }
}
```

## Flow 5: Save Onboarding Progress

### Request

```http
PUT /api/v1/onboarding/progress
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

### Body

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

### Expected Response: 200

```json
{
  "data": {
    "completed": false,
    "skipped": false,
    "currentStep": 3,
    "completedSteps": [1, 2],
    "skippedSteps": [],
    "hasOnboardingData": true,
    "hasBusiness": false,
    "businessAccountId": null,
    "status": "in_progress",
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
}
```

## Flow 6: Skip Onboarding

### Request

```http
POST /api/v1/onboarding/skip
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

### Body

```json
{
  "currentStep": 7,
  "skippedSteps": [3, 4, 5, 6],
  "data": {
    "reason": "user_skipped_setup"
  }
}
```

### Expected Response: 200

```json
{
  "data": {
    "completed": false,
    "skipped": true,
    "currentStep": 7,
    "completedSteps": [],
    "skippedSteps": [3, 4, 5, 6],
    "hasOnboardingData": true,
    "hasBusiness": false,
    "businessAccountId": null,
    "status": "skipped",
    "data": {
      "reason": "user_skipped_setup"
    }
  }
}
```

### Flow Note

This does not create a business account. If the frontend supports skipped onboarding,
it should still treat the user as having no business until `POST /api/v1/onboarding/business`
succeeds.

## Flow 7: Onboard Business Account

### Request

```http
POST /api/v1/onboarding/business
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

### Body

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
      "city": "Nairobi"
    },
    "contact": {
      "phone": "+254700000000"
    }
  },
  "staffInvitations": [
    {
      "email": "manager@example.com",
      "role": "manager"
    },
    {
      "email": "cashier@example.com",
      "role": "staff"
    }
  ]
}
```

### Expected Response: 201

```json
{
  "data": {
    "businessAccount": {
      "id": "string",
      "businessName": "Faham Test Shop",
      "businessType": "retail",
      "legalCompanyName": "Faham Test Shop Ltd",
      "registrationNumber": "C123456789",
      "country": "Kenya",
      "billingRegion": "KENYA",
      "currency": "KES",
      "accountStatus": "active",
      "planTier": "free",
      "planType": null,
      "subscriptionStatus": "none",
      "subscriptionStartsAt": null,
      "subscriptionEndsAt": null,
      "branchLimitOverride": null,
      "createdByUserId": "string",
      "createdAt": "ISO date string",
      "updatedAt": "ISO date string"
    },
    "branch": {
      "id": "string",
      "businessAccountId": "string",
      "name": "Main Branch",
      "location": {
        "address": "123 Test Street",
        "city": "Nairobi",
        "country": "Kenya"
      },
      "contact": {
        "phone": "+254700000000"
      },
      "openingHours": [],
      "branchCode": "MAIN",
      "branchType": "MAIN",
      "status": "active",
      "currency": "KES",
      "disabledAt": null,
      "disabledBy": null,
      "createdBy": "string",
      "createdAt": "ISO date string",
      "updatedAt": "ISO date string"
    },
    "membership": {
      "id": "string",
      "businessAccountId": "string",
      "userId": "string",
      "role": "owner",
      "status": "active",
      "assignedBranchIds": ["string"],
      "permissions": ["all:*"],
      "twoFactorEnabled": false,
      "createdBy": "string",
      "createdAt": "ISO date string",
      "updatedAt": "ISO date string"
    },
    "staffInvitations": [
      {
        "id": "string",
        "businessAccountId": "string",
        "email": "manager@example.com",
        "role": "manager",
        "status": "pending",
        "invitedBy": "string",
        "createdAt": "ISO date string",
        "updatedAt": "ISO date string"
      }
    ]
  }
}
```

### Flow Note

Save:

```text
businessAccount.id
branch.id
membership.id
```

The first branch is created automatically during onboarding.

## Flow 8: Auth Context After Onboarding

### Request

```http
GET /api/v1/me
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

### Body

```json
null
```

### Expected Response: 200

```json
{
  "data": {
    "auth": {
      "firebaseUid": "string",
      "email": "string",
      "phone": "string",
      "name": "string",
      "platformRole": null,
      "authTime": "ISO date string"
    },
    "userId": "string",
    "businessAccountId": "string",
    "role": "owner",
    "assignedBranchIds": ["string"],
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
      "businessAccountId": "string",
      "status": "completed",
      "data": {}
    }
  }
}
```

## Flow 9: Duplicate Onboarding Should Fail

### Request

```http
POST /api/v1/onboarding/business
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

### Body

Use the same body from Flow 7.

### Expected Response: 409

```json
{
  "error": {
    "code": "business_already_exists",
    "message": "User already has an active business membership"
  }
}
```

## Flow 10: List Branches

### Request

```http
GET /api/v1/branches
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

### Body

```json
null
```

### Expected Response: 200

```json
{
  "data": [
    {
      "id": "string",
      "businessAccountId": "string",
      "name": "Main Branch",
      "location": {
        "address": "123 Test Street",
        "city": "Nairobi",
        "country": "Kenya"
      },
      "contact": {
        "phone": "+254700000000"
      },
      "openingHours": [],
      "branchCode": "MAIN",
      "branchType": "MAIN",
      "status": "active",
      "currency": "KES",
      "disabledAt": null,
      "disabledBy": null,
      "createdBy": "string",
      "createdAt": "ISO date string",
      "updatedAt": "ISO date string"
    }
  ]
}
```

### Flow Note

Owner sees all active branches. Manager and cashier see only assigned active branches.

## Flow 11: Create Branch On Free Plan Should Fail

### Request

```http
POST /api/v1/branches
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

### Body

```json
{
  "name": "Second Branch",
  "branchCode": "BR002",
  "location": {
    "address": "Second Branch Address",
    "city": "Nairobi"
  },
  "contact": {
    "phone": "+254711111111"
  }
}
```

### Expected Response: 403

```json
{
  "error": {
    "code": "branch_limit_reached",
    "message": "Branch limit reached for current plan (1)"
  }
}
```

### Flow Note

Free plan allows only 1 active branch.

## Flow 12: Create Branch On Paid Plan

### Precondition

The business account must be upgraded in the database or by a future admin endpoint:

```json
{
  "planTier": "paid",
  "subscriptionStatus": "active",
  "subscriptionEndsAt": "future ISO date string"
}
```

### Request

```http
POST /api/v1/branches
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

### Body

```json
{
  "name": "Second Branch",
  "branchCode": "BR002",
  "location": {
    "address": "Second Branch Address",
    "city": "Nairobi"
  },
  "contact": {
    "phone": "+254711111111"
  }
}
```

### Expected Response: 201

```json
{
  "data": {
    "id": "string",
    "businessAccountId": "string",
    "name": "Second Branch",
    "branchCode": "BR002",
    "status": "active",
    "location": {
      "address": "Second Branch Address",
      "city": "Nairobi"
    },
    "contact": {
      "phone": "+254711111111"
    },
    "createdBy": "string",
    "createdAt": "ISO date string",
    "updatedAt": "ISO date string"
  }
}
```

### Flow Note

Paid plan allows up to 6 active branches unless `branchLimitOverride` is set.

## Flow 13: Get Branch By ID

### Request

```http
GET /api/v1/branches/<BRANCH_ID>
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

### Body

```json
null
```

### Expected Response: 200

```json
{
  "data": {
    "id": "<BRANCH_ID>",
    "businessAccountId": "string",
    "name": "Main Branch",
    "status": "active",
    "location": {
      "address": "123 Test Street"
    },
    "createdAt": "ISO date string",
    "updatedAt": "ISO date string"
  }
}
```

## Flow 14: Update Branch

### Request

```http
PATCH /api/v1/branches/<BRANCH_ID>
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

### Body

```json
{
  "name": "Updated Branch Name",
  "description": "Updated branch description",
  "status": "active"
}
```

### Expected Response: 200

```json
{
  "data": {
    "id": "<BRANCH_ID>",
    "name": "Updated Branch Name",
    "description": "Updated branch description",
    "status": "active",
    "businessAccountId": "string",
    "updatedAt": "ISO date string"
  }
}
```

### Flow Note

`businessAccountId`, `createdBy`, `disabledAt`, and `disabledBy` cannot be changed through this endpoint.

## Flow 15: Disable Branch

### Request

```http
POST /api/v1/branches/<BRANCH_ID>/disable
Authorization: Bearer <FRESH_FIREBASE_ID_TOKEN>
```

### Body

```json
null
```

### Expected Response: 200

```json
{
  "data": {
    "id": "<BRANCH_ID>",
    "status": "disabled",
    "disabledAt": "ISO date string",
    "disabledBy": "string"
  }
}
```

### Flow Note

Requires owner role and recent Firebase `auth_time`.

Disabled branches are excluded from normal branch list.

## Flow 16: Disable Branch With Old Auth Should Fail

### Request

```http
POST /api/v1/branches/<BRANCH_ID>/disable
Authorization: Bearer <OLD_FIREBASE_ID_TOKEN>
```

### Body

```json
null
```

### Expected Response: 403

```json
{
  "error": {
    "code": "recent_reauth_required",
    "message": "Recent reauthentication is required"
  }
}
```

## Flow 17: Enable Branch

### Request

```http
POST /api/v1/branches/<BRANCH_ID>/enable
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

### Body

```json
null
```

### Expected Response: 200

```json
{
  "data": {
    "id": "<BRANCH_ID>",
    "status": "active",
    "disabledAt": null,
    "disabledBy": null
  }
}
```

### Flow Note

Branch limit is checked before re-enabling.

## Flow 18: Expired Paid Account Write Should Fail

### Precondition

The business account has:

```json
{
  "planTier": "paid",
  "subscriptionStatus": "active",
  "subscriptionEndsAt": "past ISO date string"
}
```

### Request

```http
POST /api/v1/branches
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

### Body

```json
{
  "name": "Blocked Branch",
  "branchCode": "BLOCK",
  "location": {
    "address": "Blocked Address"
  }
}
```

### Expected Response: 402

```json
{
  "error": {
    "code": "account_read_only",
    "message": "Account is read-only until subscription or account status is resolved"
  }
}
```

## Flow 19: Paused Account Write Should Fail

### Precondition

The business account has:

```json
{
  "accountStatus": "paused"
}
```

### Request

```http
POST /api/v1/branches
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

### Body

```json
{
  "name": "Paused Branch",
  "branchCode": "PAUSED",
  "location": {
    "address": "Paused Address"
  }
}
```

### Expected Response: 423

```json
{
  "error": {
    "code": "account_read_only",
    "message": "Account is read-only until subscription or account status is resolved"
  }
}
```

## Flow 20: Missing Auth Token Should Fail

### Request

```http
GET /api/v1/me
```

### Body

```json
null
```

### Expected Response: 401

```json
{
  "error": {
    "code": "missing_auth_token",
    "message": "Authorization bearer token is required"
  }
}
```

## Flow 21: Invalid Auth Token Should Fail

### Request

```http
GET /api/v1/me
Authorization: Bearer <INVALID_TOKEN>
```

### Body

```json
null
```

### Expected Response: 401

```json
{
  "error": {
    "code": "invalid_auth_token",
    "message": "Invalid authorization token"
  }
}
```

## Flow 22: Cross-Business Branch Access Should Fail

### Precondition

Two separate business accounts exist:

- Business A has Token A.
- Business B has `<BRANCH_ID_B>`.

### Request

```http
GET /api/v1/branches/<BRANCH_ID_B>
Authorization: Bearer <TOKEN_A>
```

### Body

```json
null
```

### Expected Response: 404

```json
{
  "error": {
    "code": "not_found",
    "message": "Branch not found"
  }
}
```

## Flow 23: Manager And Cashier Branch Visibility

### Precondition

Business has:

- Branch A
- Branch B
- Manager assigned to Branch B
- Cashier assigned to Branch A

### Manager Request

```http
GET /api/v1/branches
Authorization: Bearer <MANAGER_FIREBASE_ID_TOKEN>
```

### Manager Expected Response: 200

```json
{
  "data": [
    {
      "id": "Branch B id",
      "name": "Branch B"
    }
  ]
}
```

### Cashier Request

```http
GET /api/v1/branches
Authorization: Bearer <CASHIER_FIREBASE_ID_TOKEN>
```

### Cashier Expected Response: 200

```json
{
  "data": [
    {
      "id": "Branch A id",
      "name": "Branch A"
    }
  ]
}
```

## General Error Response Shape

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```
