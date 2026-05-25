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
| `POST` | `/webhooks/mpesa/callback` | M-Pesa billing callback. |
| `POST` | `/webhooks/stripe` | Stripe billing webhook. |

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
      "role": "manager"
    }
  ]
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
| `POST` | `/branches/:branchId/disable` | Disable branch; requires recent Firebase auth. |
| `POST` | `/branches/:branchId/enable` | Re-enable branch. |

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
      "discount": 0
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
  "discount": 0,
  "notes": "Counter sale"
}
```

`paymentMethod` is `cash`, `mpesa`, `bank_transfer`, `card`, `credit`, `cheque`, or `other`.
For `credit`, `customer.debtorId` is required.

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
| `POST` | `/billing/mpesa/stk-push` | Start M-Pesa checkout. |
| `POST` | `/billing/stripe/checkout-session` | Start Stripe checkout. |

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

## Authorization Notes

- Owner sees all active branches in the business.
- Manager and cashier are restricted to assigned branches.
- Cashier responses hide cost, profit, margin, and valuation-sensitive fields.
- Write routes are blocked when the account is paused, revoked, or read-only because of subscription state.
- `POST /branches/:branchId/disable` requires recent Firebase reauthentication.
- Inventory quantity is not directly patchable; stock changes go through sales, purchases, transfers, and inventory adjustments.
