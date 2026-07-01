# FahamPesa Backend API Reference

This is the current implemented API surface from the Express route files.
Use `docs/api-test-flow.md` for the guided auth/onboarding test flow.

Base URL:

```text
http://localhost:4000/api/v1
```

Protected business routes require:

```http
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

Platform admin routes require a Firebase token whose custom claims map to
`platformRole: "admin"` or equivalent admin/super-admin claims.

Common response shapes:

```json
{
  "data": {}
}
```

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```

## Public

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Health check. |
| `GET` | `/auth/phone-exists?phone=<E164_PHONE>` | Check whether a Firebase phone number exists before OTP. |
| `POST` | `/create-super-admin?secret=<SUPER_ADMIN_SECRET>` | Create a platform admin user when bootstrapping. Authenticated platform admins may call this without the secret. |
| `POST` | `/webhooks/mpesa/callback` | M-Pesa billing callback. |
| `POST` | `/webhooks/stripe` | Stripe billing webhook. |
| `POST` | `/api/mpesa/callback` | Compatibility M-Pesa billing callback alias. |
| `POST` | `/api/stripe/webhook` | Compatibility Stripe billing webhook alias. |

## Auth And Onboarding

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/me` | Current Firebase user, internal user, business membership, branch access, subscription, and onboarding status. |
| `GET` | `/onboarding/status` | Current onboarding state only. |
| `PUT` | `/onboarding/progress` | Save draft onboarding progress. |
| `POST` | `/onboarding/skip` | Mark onboarding skipped without creating a business. |
| `POST` | `/onboarding/business` | Create business account, first branch, owner membership, settings, and optional staff invitations. |

### `PUT /onboarding/progress`

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

### `POST /onboarding/business`

Required:

- `business.businessName`
- `business.businessType`
- `business.country`
- `business.currency`
- `branch.name`
- `branch.location.address`

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
      "country": "Kenya"
    },
    "contact": {
      "phone": "+254700000000",
      "email": "branch@example.com"
    },
    "branchCode": "MAIN",
    "branchType": "MAIN",
    "currency": "KES"
  },
  "staffInvitations": [
    {
      "email": "manager@example.com",
      "role": "manager",
      "branchIds": ["mongo-branch-id"],
      "permissions": ["inventory:read"]
    }
  ]
}
```

### `POST /create-super-admin`

Requires either a platform-admin bearer token or `?secret=<SUPER_ADMIN_SECRET>`.

```json
{
  "email": "admin@example.com",
  "password": "strong-password",
  "displayName": "Platform Admin"
}
```

## Branches

All branch routes require an authenticated user with business context.
Write routes also require account write access.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/branches` | List active branches visible to the current user. |
| `POST` | `/branches` | Create branch within plan limit. |
| `GET` | `/branches/:branchId/dashboard` | Branch dashboard summary. |
| `GET` | `/branches/:branchId` | Get branch by ID. |
| `PATCH` | `/branches/:branchId` | Update branch. |
| `POST` | `/branches/:branchId/disable` | Disable branch (soft delete); requires recent Firebase auth. |
| `POST` | `/branches/:branchId/enable` | Re-enable branch. |
| `DELETE` | `/branches/:branchId` | **Permanently** delete a branch and cascade-delete all its records (inventory, stock movements, sales, refunds, expenses, debtors + payments, suppliers + payments/ledger, purchase orders, alerts, and stock transfers to/from it); also strips it from staff assignments and pending invitations. Owner-only and irreversible. Rejected with `409 last_active_branch` if it is the only active branch. |

### `POST /branches`

```json
{
  "name": "Second Branch",
  "branchCode": "BR002",
  "branchType": "BRANCH",
  "description": "Second branch",
  "currency": "KES",
  "location": {
    "address": "Second Branch Address",
    "city": "Nairobi",
    "country": "Kenya"
  },
  "contact": {
    "phone": "+254711111111",
    "email": "branch@example.com"
  }
}
```

## Staff

Mounted under `/staff`.

All staff routes require an authenticated user with business context. Staff management writes require account write access and owner/manager role. Two-factor endpoints operate on the caller's current membership.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/staff?branchId=<id>&status=<status>` | List business staff memberships. |
| `POST` | `/staff` | Create a staff user/membership. |
| `GET` | `/staff/invitations?status=<status>` | List staff invitations. |
| `POST` | `/staff/invitations` | Create or replace a pending staff invitation and return an invite link. |
| `POST` | `/staff/invitations/:invitationId/cancel` | Cancel a pending staff invitation. |
| `POST` | `/staff/invitations/accept` | Accept an invitation after Firebase sign-in. |
| `GET` | `/staff/:staffId` | Get staff member. |
| `PUT` | `/staff/:staffId` | Update staff member. |
| `PATCH` | `/staff/:staffId` | Partially update staff member. |
| `DELETE` | `/staff/:staffId` | Deactivate staff member. |
| `POST` | `/staff/:staffId/activate` | Reactivate staff member. |
| `GET` | `/staff/logs?staffId=<id>&limit=50` | List staff activity logs. |
| `POST` | `/staff/logs` | Create staff activity log. |
| `POST` | `/staff/2fa/setup` | Create a TOTP secret for the current membership. |
| `POST` | `/staff/2fa/verify` | Verify a TOTP token and enable 2FA. |
| `PUT` | `/staff/2fa/verify` | Same as `POST /staff/2fa/verify`. |
| `POST` | `/staff/2fa/disable` | Disable 2FA for the current membership. |

### `POST /staff`

```json
{
  "firebaseUid": "optional-existing-firebase-uid",
  "email": "manager@example.com",
  "fullName": "Manager User",
  "phone": "+254700111222",
  "role": "manager",
  "branchIds": ["mongo-branch-id"],
  "permissions": ["inventory:read", "sales:read"],
  "employeeId": "EMP-001",
  "salary": 25000,
  "emergencyContact": {
    "name": "Emergency Contact",
    "phone": "+254700222333",
    "relationship": "Sibling"
  }
}
```

`role` is `manager` or `cashier` for staff creation.

### `POST /staff/invitations`

Creates a pending invitation. The backend stores only a token hash and returns the raw token inside `inviteUrl`.
If another pending invite exists for the same business/email, it is cancelled and replaced.

```json
{
  "email": "cashier@example.com",
  "role": "cashier",
  "branchIds": ["mongo-branch-id"],
  "permissions": ["sales:read"]
}
```

Response:

```json
{
  "data": {
    "id": "mongo-invitation-id",
    "email": "cashier@example.com",
    "sourceRole": "cashier",
    "role": "cashier",
    "status": "pending",
    "expiresAt": "2026-06-10T10:00:00.000Z",
    "assignedBranchIds": ["mongo-branch-id"],
    "permissions": ["sales:read"],
    "inviteUrl": "https://app.example.com/staff/invite?token=raw-token"
  }
}
```

Invite links use `NEXT_PUBLIC_BASE_URL` when configured, otherwise `APP_BASE_URL`, and expire after 7 days.

### `POST /staff/invitations/accept`

Requires a Firebase bearer token. The signed-in Firebase email must match the invited email.

```json
{
  "token": "raw-token-from-invite-url"
}
```

Response:

```json
{
  "data": {
    "businessAccountId": "mongo-business-id",
    "role": "cashier",
    "assignedBranchIds": ["mongo-branch-id"],
    "membership": {
      "id": "mongo-membership-id",
      "role": "cashier",
      "assignedBranchIds": ["mongo-branch-id"]
    }
  }
}
```

After accepting, refresh `/me`; the new membership is used for dashboard routing and branch-limited access.

Invitation errors include `invitation_not_found`, `invitation_expired`, `invitation_cancelled`, `invitation_email_mismatch`, `invitation_already_accepted`, and `staff_already_exists`.

### `PATCH /staff/:staffId`

```json
{
  "fullName": "Updated Name",
  "phone": "+254700333444",
  "role": "cashier",
  "status": "active",
  "branchIds": ["mongo-branch-id"],
  "permissions": ["sales:read"],
  "twoFactorEnabled": false
}
```

### `POST /staff/logs`

```json
{
  "staffId": "mongo-membership-id",
  "action": "staff_note",
  "description": "Completed training",
  "severity": "info",
  "metadata": {}
}
```

### `POST /staff/2fa/verify`

```json
{
  "token": "123456"
}
```

## Branch Products

Mounted under `/branches/:branchId/products`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/branches/:branchId/products?search=<term>` | List/search branch products. |
| `POST` | `/branches/:branchId/products` | Create or attach product to branch inventory. |
| `POST` | `/branches/:branchId/products/bulk-upload` | Reserved import workflow; currently returns `501 bulk_upload_not_implemented`. |
| `GET` | `/branches/:branchId/products/export` | Export products. |
| `GET` | `/branches/:branchId/products/:productId` | Get product detail. |
| `PATCH` | `/branches/:branchId/products/:productId` | Update product or branch inventory settings. |
| `DELETE` | `/branches/:branchId/products/:productId` | Delete product. |

### `POST /branches/:branchId/products`

Either provide `productId` to attach an existing product, or provide `name` to create one.

```json
{
  "name": "Sugar 1kg",
  "description": "Packed sugar",
  "images": [
    "https://firebasestorage.googleapis.com/v0/b/example.appspot.com/o/businesses%2F...%2Fproducts%2Fimage.webp?alt=media&token=..."
  ],
  "barcode": "123456789",
  "sku": "SUGAR-1KG",
  "category": "Groceries",
  "unitOfMeasure": "piece",
  "isPerishable": false,
  "inventory": {
    "initialQuantity": 20,
    "initialStockReason": "opening_stock",
    "reorderLevel": 5,
    "costPrice": 90,
    "sellingPrice": 120,
    "batchNumber": "BATCH-1",
    "binLocation": "A1"
  }
}
```

## Assets

Mounted under `/assets`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/assets/product-images` | Upload one product image to Firebase Storage. |

### `POST /assets/product-images`

Requires owner or manager write access. Send `multipart/form-data` with a single `image` file. Supported types are JPEG, PNG, and WebP, up to 5 MB.

Response:

```json
{
  "data": {
    "url": "https://firebasestorage.googleapis.com/v0/b/example.appspot.com/o/businesses%2F...%2Fproducts%2Fimage.webp?alt=media&token=...",
    "storagePath": "businesses/mongo-business-id/products/image.webp",
    "contentType": "image/webp",
    "size": 12345
  }
}
```

## Inventory

Mounted under `/branches/:branchId/inventory`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/branches/:branchId/inventory?search=<term>` | List branch inventory. |
| `POST` | `/branches/:branchId/inventory/adjustments` | Adjust stock with movement record. |
| `GET` | `/branches/:branchId/inventory/movements?productId=<id>` | List stock movements. |
| `GET` | `/branches/:branchId/inventory/alerts` | List inventory alerts. |

### `POST /branches/:branchId/inventory/adjustments`

```json
{
  "productId": "mongo-product-id",
  "adjustmentType": "increase",
  "quantity": 5,
  "reason": "stock_count",
  "notes": "Manual count correction",
  "unitCostPrice": 90
}
```

`adjustmentType` is `increase`, `decrease`, or `set`.

## Sales

Mounted under `/branches/:branchId/sales`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/branches/:branchId/sales` | List sales. |
| `POST` | `/branches/:branchId/sales` | Create sale and deduct stock. |
| `GET` | `/branches/:branchId/sales/:saleId` | Get sale. |
| `PATCH` | `/branches/:branchId/sales/:saleId` | Update customer/notes only. |
| `DELETE` | `/branches/:branchId/sales/:saleId` | Delete sale. |

### `POST /branches/:branchId/sales`

```json
{
  "items": [
    {
      "productId": "mongo-product-id",
      "quantity": 2,
      "unitPrice": 120,
      "discount": 10,
      "discountType": "percentage"
    }
  ],
  "customer": {
    "name": "Customer Name",
    "phone": "+254700000000",
    "email": "customer@example.com",
    "debtorId": "mongo-debtor-id"
  },
  "paymentMethod": "cash",
  "tax": 0,
  "discount": 5,
  "discountType": "fixed",
  "notes": "Counter sale"
}
```

`paymentMethod` is `cash`, `mpesa`, `bank_transfer`, `card`, `credit`, `cheque`, or `other`.
For `credit`, `customer.debtorId` is required.

Discounts can be applied per item and to the whole cart:

- `discountType: "fixed"` treats `discount` as a currency amount.
- `discountType: "percentage"` treats `discount` as a percentage from `0` to `100`.
- If `discountType` is omitted, it defaults to `"fixed"` for backward compatibility.
- Item percentage discounts are calculated from `quantity * unitPrice`.
- Cart percentage discounts are calculated from `subtotal + tax`, after item-level discounts.
- Responses include `discountAmount`, the computed currency amount applied.

## Expenses

Mounted under `/branches/:branchId/expenses`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/branches/:branchId/expenses` | List expenses. |
| `POST` | `/branches/:branchId/expenses` | Create expense. |
| `PATCH` | `/branches/:branchId/expenses/:expenseId` | Update expense. |
| `DELETE` | `/branches/:branchId/expenses/:expenseId` | Delete expense. |

### `POST /branches/:branchId/expenses`

```json
{
  "amount": 2500,
  "category": "Rent",
  "description": "Monthly shop rent",
  "paymentMethod": "bank_transfer",
  "vendor": "Landlord",
  "receiptNumber": "REC-001",
  "attachmentUrl": "https://example.com/receipt.jpg",
  "date": "2026-05-25T00:00:00.000Z"
}
```

## Debtors

Mounted under `/branches/:branchId/debtors`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/branches/:branchId/debtors` | List debtors. |
| `POST` | `/branches/:branchId/debtors` | Create debtor. |
| `GET` | `/branches/:branchId/debtors/:debtorId` | Get debtor. |
| `PATCH` | `/branches/:branchId/debtors/:debtorId` | Update debtor. |
| `POST` | `/branches/:branchId/debtors/:debtorId/payments` | Record debtor payment. |

### `POST /branches/:branchId/debtors`

```json
{
  "name": "Customer Name",
  "phone": "+254700000000",
  "email": "customer@example.com",
  "creditLimit": 10000,
  "dueDate": "2026-06-25T00:00:00.000Z"
}
```

### `POST /branches/:branchId/debtors/:debtorId/payments`

```json
{
  "amount": 1000,
  "paymentMethod": "mpesa",
  "reference": "MPESA-REF"
}
```

## Suppliers

Mounted under `/branches/:branchId/suppliers`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/branches/:branchId/suppliers` | List suppliers. |
| `POST` | `/branches/:branchId/suppliers` | Create supplier. |
| `GET` | `/branches/:branchId/suppliers/:supplierId` | Get supplier. |
| `PATCH` | `/branches/:branchId/suppliers/:supplierId` | Update supplier. |
| `DELETE` | `/branches/:branchId/suppliers/:supplierId` | Delete supplier. |
| `GET` | `/branches/:branchId/suppliers/:supplierId/ledger` | Supplier ledger. |
| `GET` | `/branches/:branchId/suppliers/:supplierId/payments` | Supplier payments. |
| `POST` | `/branches/:branchId/suppliers/:supplierId/payments` | Record supplier payment. |

### `POST /branches/:branchId/suppliers`

```json
{
  "name": "Supplier Ltd",
  "contactPerson": "Supplier Contact",
  "phone": "+254700000000",
  "email": "supplier@example.com",
  "address": "Supplier address",
  "openingBalance": 0,
  "paymentTerms": "net_30",
  "notes": "Preferred supplier"
}
```

### `POST /branches/:branchId/suppliers/:supplierId/payments`

```json
{
  "purchaseOrderId": "mongo-purchase-order-id",
  "amount": 5000,
  "paymentMethod": "bank_transfer",
  "reference": "BANK-REF",
  "notes": "Partial payment"
}
```

## Purchase Orders

Mounted under `/branches/:branchId/purchase-orders`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/branches/:branchId/purchase-orders` | List purchase orders. |
| `POST` | `/branches/:branchId/purchase-orders` | Create purchase order. |
| `GET` | `/branches/:branchId/purchase-orders/:purchaseOrderId` | Get purchase order. |
| `POST` | `/branches/:branchId/purchase-orders/:purchaseOrderId/approve` | Approve purchase order. |
| `POST` | `/branches/:branchId/purchase-orders/:purchaseOrderId/receive` | Receive purchase order and increase stock. |
| `POST` | `/branches/:branchId/purchase-orders/:purchaseOrderId/cancel` | Cancel purchase order. |

### `POST /branches/:branchId/purchase-orders`

```json
{
  "supplierId": "mongo-supplier-id",
  "items": [
    {
      "productId": "mongo-product-id",
      "quantityOrdered": 10,
      "unitCostPrice": 90
    }
  ],
  "taxAmount": 0,
  "shippingCost": 0,
  "amountPaid": 0,
  "paymentTerms": "net_30",
  "expectedDeliveryDate": "2026-06-01T00:00:00.000Z"
}
```

### `POST /branches/:branchId/purchase-orders/:purchaseOrderId/receive`

```json
{
  "items": [
    {
      "productId": "mongo-product-id",
      "quantityReceived": 10
    }
  ]
}
```

## Transfers

Mounted under `/transfers`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/transfers` | List stock transfers for the business. |
| `POST` | `/transfers` | Create transfer request. |
| `GET` | `/transfers/:transferId` | Get transfer. |
| `POST` | `/transfers/:transferId/approve` | Approve transfer. |
| `POST` | `/transfers/:transferId/ship` | Mark transfer shipped. |
| `POST` | `/transfers/:transferId/receive` | Receive transfer and move stock. |
| `POST` | `/transfers/:transferId/cancel` | Cancel transfer. |
| `POST` | `/transfers/:transferId/reject` | Reject transfer. |

### `POST /transfers`

```json
{
  "fromBranchId": "mongo-source-branch-id",
  "toBranchId": "mongo-destination-branch-id",
  "items": [
    {
      "productId": "mongo-product-id",
      "quantity": 3
    }
  ],
  "priority": "normal",
  "notes": "Rebalance stock"
}
```

`priority` is `low`, `normal`, or `high`.

## Reports

Mounted under `/reports`.

All report endpoints accept optional query parameters:

```text
branchId=<mongo-branch-id-or-all>&from=<date>&to=<date>
```

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/reports/dashboard` | Business dashboard report. |
| `GET` | `/reports/sales` | Sales report. |
| `GET` | `/reports/inventory-valuation` | Inventory valuation report. |
| `GET` | `/reports/low-stock` | Low-stock report. |
| `GET` | `/reports/suppliers` | Supplier report. |
| `GET` | `/reports/expenses` | Expense report. |
| `GET` | `/reports/branch-performance` | Branch performance report. |

## Settings

Mounted under `/settings`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/settings` | Get business settings. |
| `PATCH` | `/settings` | Update business settings. |

### `PATCH /settings`

```json
{
  "businessProfile": {},
  "receiptSettings": {},
  "notificationSettings": {},
  "deviceSettings": {},
  "syncSettings": {}
}
```

## Billing

Mounted under `/billing`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/billing/plans` | Available subscription plans. |
| `GET` | `/billing/subscription` | Current business subscription. |
| `GET` | `/billing/history` | Billing/payment history. |
| `GET` | `/billing/receipts/:subscriptionId` | Subscription receipt. |
| `GET` | `/billing/checkout-status/:subscriptionId` | Poll checkout/subscription status. |
| `POST` | `/billing/subscription/activate` | Activate the current owner's business on a monthly plan. |
| `POST` | `/billing/mpesa/stk-push` | Start M-Pesa checkout. |
| `POST` | `/billing/stripe/checkout-session` | Start Stripe checkout. |

### `POST /billing/subscription/activate`

Creates a zero-amount manual monthly subscription for the current owner's business and marks the business subscription active.

```json
{}
```

### `POST /billing/mpesa/stk-push`

```json
{
  "planType": "monthly",
  "phoneNumber": "+254700000000"
}
```

### `POST /billing/stripe/checkout-session`

```json
{
  "planType": "yearly",
  "successUrl": "https://example.com/billing/success",
  "cancelUrl": "https://example.com/billing/cancel"
}
```

`planType` is `monthly` or `yearly`.

### `GET /billing/checkout-status/:subscriptionId`

Returns the scoped subscription payment status for polling:

```json
{
  "subscriptionId": "mongo-subscription-id",
  "status": "pending",
  "transactionId": null,
  "planType": "monthly",
  "amount": 2000,
  "currency": "KSH"
}
```

## Platform Admin

Mounted under `/admin`.

These routes require platform admin authorization from Firebase custom claims.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/admin/businesses?q=<term>&status=<status>` | List businesses. |
| `GET` | `/admin/businesses/:businessAccountId` | Business detail. |
| `POST` | `/admin/businesses/:businessAccountId/pause` | Pause business. |
| `POST` | `/admin/businesses/:businessAccountId/resume` | Resume business. |
| `POST` | `/admin/businesses/:businessAccountId/revoke` | Revoke business. |
| `POST` | `/admin/businesses/:businessAccountId/branch-limit` | Set branch limit override. |
| `POST` | `/admin/businesses/:businessAccountId/subscriptions/extend` | Extend subscription. |
| `POST` | `/admin/businesses/:businessAccountId/subscriptions/manual-activate` | Manually activate subscription. |
| `POST` | `/admin/payment-events/:eventId/retry` | Retry failed payment event. |
| `GET` | `/admin/audit-logs` | Audit logs. |
| `GET` | `/admin/payments` | Payment events. |
| `GET` | `/admin/auth-users` | List account-backed local/auth users with stats. |
| `GET` | `/admin/firebase-auth-users?email=<email>&includeFirestore=true` | List account-backed users enriched with Firebase Auth data when Firebase Admin is configured; falls back to Mongo users. |
| `GET` | `/admin/user-stats` | Account-backed user totals and activity breakdown. |
| `POST` | `/admin/users/:userId/disable` | Disable or re-enable a user and suspend/reactivate memberships. |
| `GET` | `/admin/settings/platform` | Get platform settings. |
| `POST` | `/admin/settings/platform` | Update platform settings. |
| `GET` | `/admin/settings/notifications` | Get platform notification settings. |
| `POST` | `/admin/settings/notifications` | Update platform notification settings. |
| `GET` | `/admin/settings/integrations` | Get integration settings. |
| `POST` | `/admin/settings/integrations` | Update integration settings. |
| `GET` | `/admin/settings/admin-users` | List platform admin users. |
| `POST` | `/admin/settings/admin-users` | Create, update, or delete a platform admin-user record. |
| `GET` | `/admin/settings/test` | Lightweight settings route health check. |
| `GET` | `/admin/check-branches` | Compatibility check endpoint for branch tooling. |
| `GET` | `/admin/check-security-alerts` | Compatibility check endpoint for security-alert tooling. |
| `GET` | `/admin/crashlytics` | Compatibility endpoint; returns empty issues unless Crashlytics integration is added. |
| `POST` | `/admin/notifications/send` | Send/store platform announcement. |
| `GET` | `/admin/notifications/send?announcementId=<id>` | List announcements or fetch one announcement. |
| `GET` | `/admin/notifications/recipients?audience=<audience>` | List notification recipients. |

Notification routes are also mounted under `/notifications` for client compatibility:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/notifications/send` | Send/store platform announcement. |
| `GET` | `/notifications/send?announcementId=<id>` | List announcements or fetch one announcement. |
| `GET` | `/notifications/recipients?audience=<audience>` | List notification recipients. |

### `POST /admin/businesses/:businessAccountId/branch-limit`

```json
{
  "branchLimitOverride": 10
}
```

Set `branchLimitOverride` to `null` to clear the override.

### `POST /admin/businesses/:businessAccountId/subscriptions/extend`

```json
{
  "days": 30,
  "reason": "Support adjustment"
}
```

### `POST /admin/businesses/:businessAccountId/subscriptions/manual-activate`

```json
{
  "planType": "monthly",
  "days": 30,
  "reason": "Manual payment confirmed"
}
```

### `POST /admin/users/:userId/disable`

`userId` may be the Mongo user ID or Firebase UID.

```json
{
  "disabled": true
}
```

### `POST /admin/settings/platform`

```json
{
  "platformName": "FahamPesa",
  "timezone": "Africa/Nairobi",
  "defaultLanguage": "English",
  "dataRetentionDays": 365,
  "backupFrequency": "Daily"
}
```

`backupFrequency` is `Hourly`, `Daily`, `Weekly`, or `Monthly`.

### `POST /admin/settings/notifications`

```json
{
  "emailEnabled": true,
  "pushEnabled": true,
  "slackEnabled": false,
  "webhookUrl": "",
  "alertThresholds": {
    "userDropPercentage": 20,
    "errorRatePercentage": 5,
    "crashRatePercentage": 2
  }
}
```

### `POST /admin/settings/integrations`

```json
{
  "firebase": {
    "enabled": true,
    "projectId": "fahampesa-8c514"
  },
  "mixpanel": {
    "enabled": false,
    "projectToken": ""
  },
  "posthog": {
    "enabled": false,
    "apiKey": "",
    "hostUrl": "https://app.posthog.com"
  }
}
```

### `POST /admin/settings/admin-users`

Create:

```json
{
  "action": "create",
  "name": "Viewer User",
  "email": "viewer@example.com",
  "role": "viewer"
}
```

Update:

```json
{
  "action": "update",
  "id": "mongo-admin-user-id",
  "status": "inactive"
}
```

Delete:

```json
{
  "action": "delete",
  "id": "mongo-admin-user-id"
}
```

### `POST /notifications/send`

```json
{
  "announcementId": "release-1",
  "announcement": {
    "title": "Release",
    "message": "New release is available",
    "type": "info",
    "channel": "email",
    "targetAudience": "all"
  }
}
```

Supported audience filters currently include `all`, `all_users`, `subscribed`, `paid_users`, `free`, `free_users`, and `disabled`.

## Authorization Notes

- Owner sees all active branches in the business.
- Manager and cashier are restricted to assigned branches.
- Staff management routes require owner or manager role.
- Platform admin routes require `platformRole: "admin"` or equivalent admin/super-admin claims from the verified Firebase Auth token.
- Cashier responses hide cost, profit, margin, and valuation-sensitive fields.
- Write routes are blocked when the account is paused, revoked, or read-only because of subscription state.
- `POST /branches/:branchId/disable` requires recent Firebase reauthentication.
- Inventory quantity is not directly patchable; stock changes go through sales, purchases, transfers, and inventory adjustments.
