# FahamPesa Backend Low Level Design

Business-side branch, inventory, and supplier behavior must remain aligned with [FahamPesa Core User Modules](./core-user-modules.md).

## 1. Architecture Summary

FahamPesa backend is an Express, TypeScript, Mongoose, and MongoDB REST API. Firebase Auth remains the identity provider. Every API request with user context verifies a Firebase ID token, resolves the internal user membership, resolves the active business account, then enforces subscription, role, and branch access rules before reaching controllers.

The system is designed to run without cron jobs or persistent workers. Correctness comes from request-time subscription checks, MongoDB transactions, webhook processing, idempotency keys, manual admin overrides, TTL indexes, and updates performed during user actions.

## 2. Runtime and Infrastructure

- Runtime: Node.js with TypeScript.
- API framework: Express.
- Persistence: MongoDB via Mongoose.
- Transactions: required for production; use MongoDB Atlas or a replica set.
- Auth provider: Firebase Auth ID tokens.
- File assets: Firebase Storage for product images, receipt assets, and attachments.
- API style: REST JSON under `/api/v1`.
- Deployment target: serverless-compatible Express handler, with no required persistent background process.

## 3. Cross-Cutting Middleware

### Request Context

`authMiddleware` verifies `Authorization: Bearer <firebaseIdToken>`, then loads:

- `authUid`
- `userId`
- `businessAccountId`
- `role`
- `assignedBranchIds`
- `subscriptionStatus`
- `subscriptionEndsAt`
- `branchLimit`
- `isSuperAdmin`

### Subscription Enforcement

No cron is needed to expire accounts. Every protected request computes effective access:

- Active if `accountStatus=active`, `subscriptionStatus=active`, and `subscriptionEndsAt > now`.
- Read-only if subscription is expired by date, subscription status is expired, or account is paused.
- Billing and account routes remain available in read-only mode.
- Business write routes reject with `402 PAYMENT_REQUIRED` or `423 ACCOUNT_RESTRICTED`.
- Business read routes remain available.

### Authorization

- Owner can access all business branches and all business modules.
- Manager can access assigned branches and manager permissions.
- Cashier can create/read assigned-branch sales, read basic account/support settings, and cannot see cost price, profit, stock valuation, supplier balances, or purchase cost data.
- Super-admin routes use separate platform-admin authorization and never derive authority from business membership.

### Tenant Guard

All service queries include `businessAccountId`. Client-provided business or user IDs are ignored for tenancy unless the caller is super-admin and the route explicitly accepts target account IDs.

### Idempotency

Write routes that can be retried accept `Idempotency-Key`. The backend stores request fingerprint and response summary in `idempotency_keys` with a TTL index. Repeated matching requests return the stored result.

## 4. Core Collections

### business_accounts

Purpose: tenant root and subscription enforcement.

Fields:

- `_id`
- `businessName`
- `businessType`
- `country`
- `billingRegion`: `KENYA` or `OTHER`
- `currency`
- `accountStatus`: `active`, `paused`, `revoked`
- `planTier`: `free`, `paid`
- `planType`: `monthly`, `yearly`, `manual`
- `subscriptionStatus`: `none`, `pending`, `active`, `expired`, `failed`, `cancelled`
- `subscriptionStartsAt`
- `subscriptionEndsAt`
- `branchLimitOverride`
- `settings`
- `createdByUserId`
- `createdAt`
- `updatedAt`

Indexes:

- `{ createdByUserId: 1 }`
- `{ subscriptionEndsAt: 1 }`
- `{ accountStatus: 1, subscriptionStatus: 1 }`

### users

Purpose: internal profile mapped from Firebase Auth.

Fields:

- `_id`
- `firebaseUid`
- `email`
- `phone`
- `fullName`
- `country`
- `lastLoginAt`
- `createdAt`
- `updatedAt`

Indexes:

- unique `{ firebaseUid: 1 }`
- unique sparse `{ email: 1 }`
- sparse `{ phone: 1 }`

### business_memberships

Purpose: user role inside a business.

Fields:

- `_id`
- `businessAccountId`
- `userId`
- `role`: `owner`, `manager`, `cashier`
- `status`: `active`, `inactive`, `suspended`
- `assignedBranchIds`
- `permissions`
- `twoFactorEnabled`
- `employeeId`
- `createdBy`
- `createdAt`
- `updatedAt`

Indexes:

- unique `{ businessAccountId: 1, userId: 1 }`
- `{ businessAccountId: 1, role: 1 }`
- `{ businessAccountId: 1, assignedBranchIds: 1 }`

### branches

Purpose: physical store.

Fields:

- `_id`
- `businessAccountId`
- `name`
- `branchCode`
- `branchType`
- `location`
- `contact`
- `openingHours`
- `managerUserId`
- `status`
- `currency`
- `taxSettings`
- `createdBy`
- `createdAt`
- `updatedAt`

Indexes:

- `{ businessAccountId: 1, status: 1 }`
- unique `{ businessAccountId: 1, branchCode: 1 }`

Branch creation service checks effective branch limit:

- free plan: 1
- paid plan: 6
- override: `branchLimitOverride` if present

Branches are not physically deleted in v1. Delete-like owner actions set `status=disabled` after recent Firebase reauthentication, and disabled branches can be re-enabled by the owner.

### products

Purpose: shared business-level product catalog for product identity.

Fields:

- `_id`
- `businessAccountId`
- `name`
- `description`
- `images`
- `barcode`
- `sku`
- `category`
- `unitOfMeasure`
- `isPerishable`
- `isActive`
- `createdBy`
- `createdAt`
- `updatedAt`
- `version`

Indexes:

- `{ businessAccountId: 1, isActive: 1 }`
- sparse `{ businessAccountId: 1, barcode: 1 }`
- sparse `{ businessAccountId: 1, sku: 1 }`
- text index on `name`, `barcode`, `sku`, `category`

Branch isolation is enforced through `inventory_items`, stock movements, purchases, transfers, sales, and reports. Product identity is shared so product detail can show stock per branch without guessing whether branch-local products are the same item.

### inventory_items

Purpose: stock state for one product in one branch.

Fields:

- `_id`
- `businessAccountId`
- `branchId`
- `productId`
- `quantity`
- `reservedQuantity`
- `availableQuantity`
- `reorderLevel`
- `averageCostPrice`
- `lastCostPrice`
- `costPrice`
- `sellingPrice`
- `stockValue`
- `status`
- `supplierId`
- `expiryDate`
- `batchNumber`
- `binLocation`
- `lastMovementAt`
- `version`
- `createdAt`
- `updatedAt`

Indexes:

- unique `{ businessAccountId: 1, branchId: 1, productId: 1 }`
- `{ businessAccountId: 1, branchId: 1, quantity: 1 }`
- `{ businessAccountId: 1, branchId: 1, reorderLevel: 1 }`

Inventory quantity is not directly editable by public APIs. There is no route that allows `PATCH inventory.quantity`. Stock changes only through service commands: sale creation, purchase receiving, stock adjustment with reason, transfer receive, customer return, damage, wastage, theft, or initial stock setup.

Cashier read serializers remove `costPrice`, valuation, margin, supplier cost fields, and any stock value fields derived from cost. Product detail for owner/manager joins `products` with all accessible `inventory_items` to show stock per branch.

### stock_movements

Purpose: immutable stock ledger.

Fields:

- `_id`
- `businessAccountId`
- `branchId`
- `productId`
- `movementType`: `sale`, `purchase`, `transfer_out`, `transfer_in`, `adjustment`, `wastage`, `return`, `damage`, `theft`, `initial`
- `quantity`
- `direction`: `in`, `out`
- `previousQuantity`
- `newQuantity`
- `unitCostPrice`
- `totalValue`
- `referenceType`
- `referenceId`
- `reason`
- `notes`
- `createdBy`
- `createdAt`

Indexes:

- `{ businessAccountId: 1, branchId: 1, productId: 1, createdAt: -1 }`
- `{ businessAccountId: 1, referenceType: 1, referenceId: 1 }`

Stock movements are append-only. Incorrect movements are corrected with reversal or adjustment movements; they are not deleted.

### stock_transfers

Purpose: branch-to-branch stock workflow.

Fields:

- `_id`
- `businessAccountId`
- `transferNumber`
- `fromBranchId`
- `toBranchId`
- `items`
- `status`: `requested`, `approved`, `in_transit`, `received`, `cancelled`, `rejected`
- `priority`
- `requestedBy`
- `approvedBy`
- `shippedBy`
- `receivedBy`
- timestamps for each workflow step
- `notes`
- `createdAt`
- `updatedAt`

Receiving a transfer runs in one transaction:

- verify permissions and status
- verify every item already has a destination branch product
- decrement source inventory on ship or receive, depending configured workflow
- increment destination inventory on receive
- create paired stock movements
- update alert records for affected products

Transfers cannot create destination inventory automatically in v1. If the destination branch does not already have an inventory record for the product, the API returns a validation error and the user must add the product to that branch before requesting or approving the transfer.

### suppliers

Purpose: branch-specific supplier record.

Fields:

- `_id`
- `businessAccountId`
- `branchId`
- `name`
- `contactPerson`
- `phone`
- `email`
- `address`
- `openingBalance`
- `paymentTerms`
- `currentBalance`
- `status`
- `notes`
- `createdBy`
- `createdAt`
- `updatedAt`

Indexes:

- `{ businessAccountId: 1, branchId: 1, status: 1 }`
- `{ businessAccountId: 1, branchId: 1, name: 1 }`

### purchase_orders

Purpose: purchase tracking and receiving.

Fields:

- `_id`
- `businessAccountId`
- `branchId`
- `supplierId`
- `poNumber`
- `items`
- `subtotal`
- `taxAmount`
- `shippingCost`
- `totalAmount`
- `amountPaid`
- `outstandingAmount`
- `paymentTerms`
- `expectedDeliveryDate`
- `status`: `draft`, `pending`, `approved`, `sent`, `partially_received`, `received`, `cancelled`, `rejected`
- approval fields
- receiving fields
- `createdAt`
- `updatedAt`

Receiving purchase items runs in one transaction:

- update received quantities
- increase inventory
- create stock movements
- update product cost cache
- update supplier balance if unpaid or partially paid
- create supplier ledger entries
- update alerts

### supplier_payments

Purpose: payments made to suppliers.

Fields:

- `_id`
- `businessAccountId`
- `branchId`
- `supplierId`
- `purchaseOrderId`
- `amount`
- `paymentMethod`
- `reference`
- `notes`
- `recordedBy`
- `createdAt`

### supplier_ledger_entries

Purpose: immutable supplier financial ledger.

Fields:

- `_id`
- `businessAccountId`
- `branchId`
- `supplierId`
- `entryType`: `opening_balance`, `purchase`, `payment`, `adjustment`
- `debit`
- `credit`
- `balanceAfter`
- `referenceType`
- `referenceId`
- `notes`
- `createdBy`
- `createdAt`

Supplier ledger entries are append-only. Corrections use adjustment or reversal entries and update supplier balance transactionally.

### sales

Purpose: recorded business sales. Payment methods are record-only.

Fields:

- `_id`
- `businessAccountId`
- `branchId`
- `saleNumber`
- `items`
- `customer`
- `paymentMethod`: `cash`, `mpesa`, `bank_transfer`, `card`, `credit`, `cheque`, `other`
- `subtotal`
- `tax`
- `discount`
- `totalAmount`
- `totalCost`
- `profit`
- `notes`
- `createdBy`
- `isDeleted`
- `deletedAt`
- `createdAt`
- `updatedAt`
- `version`

Creating a sale with product items runs in one transaction:

- verify branch access
- verify available stock
- create sale
- decrement inventory
- create stock movements
- update low stock alerts

M-Pesa and card values here are labels only; no merchant payment processing occurs.

### expenses

Purpose: branch-specific business expense records.

Fields:

- `_id`
- `businessAccountId`
- `branchId`
- `amount`
- `category`
- `description`
- `paymentMethod`
- `vendor`
- `receiptNumber`
- `attachmentUrl`
- `date`
- `createdBy`
- `createdAt`
- `updatedAt`

### debtors and debtor_payments

Purpose: branch/customer credit records.

Debtor fields:

- `_id`
- `businessAccountId`
- `branchId`
- `name`
- `phone`
- `email`
- `creditLimit`
- `currentDebt`
- `totalPurchases`
- `totalPayments`
- `paymentStatus`
- `dueDate`
- `isActive`
- `createdAt`
- `updatedAt`

Debtor payment fields:

- `_id`
- `businessAccountId`
- `branchId`
- `debtorId`
- `amount`
- `paymentMethod`
- `reference`
- `outstandingBalance`
- `recordedBy`
- `createdAt`

### settings

Purpose: account, business, receipt, device, notification, and sync settings.

Fields:

- `_id`
- `businessAccountId`
- `businessProfile`
- `receiptSettings`
- `notificationSettings`
- `deviceSettings`
- `syncSettings`
- `createdAt`
- `updatedAt`

Cashiers only read account/support-safe fields.

### alerts

Purpose: low stock, expiry, and operational alerts.

Fields:

- `_id`
- `businessAccountId`
- `branchId`
- `alertType`
- `productId`
- `severity`
- `message`
- `status`: `active`, `acknowledged`, `resolved`
- `metadata`
- `createdAt`
- `updatedAt`
- `resolvedAt`

Alerts are updated during stock-changing actions, not by cron.

### subscriptions

Purpose: FahamPesa billing records.

Fields:

- `_id`
- `businessAccountId`
- `userId`
- `provider`: `mpesa`, `stripe`, `manual`
- `planType`: `monthly`, `yearly`
- `status`: `pending`, `active`, `expired`, `failed`, `cancelled`
- `amount`
- `currency`: `KSH`, `USD`
- `checkoutRequestId`
- `stripeCheckoutSessionId`
- `transactionId`
- `phoneNumber`
- `startDate`
- `endDate`
- `createdAt`
- `updatedAt`

Subscription expiry is evaluated from `endDate` and mirrored to `business_accounts.subscriptionEndsAt`.

### payment_events

Purpose: webhook and manual payment event log.

Fields:

- `_id`
- `provider`
- `eventId`
- `businessAccountId`
- `subscriptionId`
- `eventType`
- `rawPayload`
- `processingStatus`: `received`, `processed`, `failed`, `ignored`
- `errorMessage`
- `processedAt`
- `createdAt`

Indexes:

- unique sparse `{ provider: 1, eventId: 1 }`
- `{ processingStatus: 1, createdAt: -1 }`

Failed payment events can be retried manually by admin.

Payment events are append-only and are never deleted by application workflows.

### sync_devices

Purpose: registered desktop devices.

Fields:

- `_id`
- `businessAccountId`
- `userId`
- `deviceId`
- `deviceName`
- `platform`
- `lastSeenAt`
- `lastPullCursor`
- `status`
- `createdAt`
- `updatedAt`

### sync_changes

Purpose: server change log for pull sync.

Fields:

- `_id`
- `businessAccountId`
- `branchId`
- `entityType`
- `entityId`
- `operation`: `create`, `update`, `delete`
- `version`
- `changedAt`
- `changedBy`
- `payload`

Indexes:

- `{ businessAccountId: 1, changedAt: 1, _id: 1 }`
- `{ businessAccountId: 1, branchId: 1, changedAt: 1 }`

Hard-deleted syncable entities emit delete events. Delete events are retained for at least 90 days so offline desktop clients can remove local copies after reconnecting. If a device cursor is older than the retention window, the server returns `cursor_expired` and the desktop must perform a full resync.

### sync_conflicts

Purpose: rejected stale writes requiring client rebase.

Fields:

- `_id`
- `businessAccountId`
- `deviceId`
- `entityType`
- `entityId`
- `clientVersion`
- `serverVersion`
- `clientCommand`
- `serverSnapshot`
- `status`: `open`, `rebased`, `discarded`
- `createdAt`
- `updatedAt`

### idempotency_keys

Purpose: safe retries.

Fields:

- `_id`
- `businessAccountId`
- `key`
- `route`
- `requestHash`
- `statusCode`
- `responseBody`
- `expiresAt`
- `createdAt`

TTL index on `expiresAt`.

### audit_logs

Purpose: immutable business and admin audit trail.

Fields:

- `_id`
- `scope`: `business`, `platform`
- `businessAccountId`
- `actorUserId`
- `actorRole`
- `action`
- `targetType`
- `targetId`
- `branchId`
- `metadata`
- `ipAddress`
- `userAgent`
- `createdAt`

## 5. API Design

All routes are under `/api/v1`.

### Auth and Session

- `GET /me`: current user, business memberships, role, accessible branches, effective subscription access.
- `POST /onboarding/business`: create business account, owner membership, and first branch.
- `PATCH /me/profile`: update user profile.

### Branches

- `GET /branches`
- `POST /branches`
- `GET /branches/:branchId`
- `PATCH /branches/:branchId`
- `DELETE /branches/:branchId`
- `GET /branches/:branchId/dashboard`

Writes enforce plan branch limit and role permissions.

### Products and Inventory

- `GET /branches/:branchId/products`
- `POST /branches/:branchId/products`
- `GET /branches/:branchId/products/:productId`
- `PATCH /branches/:branchId/products/:productId`
- `DELETE /branches/:branchId/products/:productId`
- `POST /branches/:branchId/products/bulk-upload`
- `GET /branches/:branchId/products/export`
- `GET /branches/:branchId/inventory`
- `POST /branches/:branchId/inventory/adjustments`
- `GET /branches/:branchId/inventory/movements`
- `GET /branches/:branchId/inventory/alerts`

### Transfers

- `GET /transfers`
- `POST /transfers`
- `GET /transfers/:transferId`
- `POST /transfers/:transferId/approve`
- `POST /transfers/:transferId/ship`
- `POST /transfers/:transferId/receive`
- `POST /transfers/:transferId/cancel`

Transfer services validate access to both branches.

### Suppliers and Purchases

- `GET /branches/:branchId/suppliers`
- `POST /branches/:branchId/suppliers`
- `GET /branches/:branchId/suppliers/:supplierId`
- `PATCH /branches/:branchId/suppliers/:supplierId`
- `DELETE /branches/:branchId/suppliers/:supplierId`
- `GET /branches/:branchId/suppliers/:supplierId/ledger`
- `GET /branches/:branchId/suppliers/:supplierId/payments`
- `POST /branches/:branchId/suppliers/:supplierId/payments`
- `GET /branches/:branchId/purchase-orders`
- `POST /branches/:branchId/purchase-orders`
- `GET /branches/:branchId/purchase-orders/:purchaseOrderId`
- `POST /branches/:branchId/purchase-orders/:purchaseOrderId/approve`
- `POST /branches/:branchId/purchase-orders/:purchaseOrderId/receive`
- `POST /branches/:branchId/purchase-orders/:purchaseOrderId/cancel`

### Sales, Expenses, Debtors

- `GET /branches/:branchId/sales`
- `POST /branches/:branchId/sales`
- `GET /branches/:branchId/sales/:saleId`
- `PATCH /branches/:branchId/sales/:saleId`
- `DELETE /branches/:branchId/sales/:saleId`
- `GET /branches/:branchId/expenses`
- `POST /branches/:branchId/expenses`
- `PATCH /branches/:branchId/expenses/:expenseId`
- `DELETE /branches/:branchId/expenses/:expenseId`
- `GET /branches/:branchId/debtors`
- `POST /branches/:branchId/debtors`
- `GET /branches/:branchId/debtors/:debtorId`
- `POST /branches/:branchId/debtors/:debtorId/payments`

### Reports

- `GET /reports/sales`
- `GET /reports/inventory-valuation`
- `GET /reports/low-stock`
- `GET /reports/suppliers`
- `GET /reports/expenses`
- `GET /reports/dashboard`

Query params accept `branchId` or `all`. Owners may request all. Managers and cashiers are limited to assigned branches, and cashiers receive reduced financial fields.

### Settings and Assets

- `GET /settings`
- `PATCH /settings`
- `POST /assets/product-images`

### Offline Sync

- `POST /sync/devices/register`
- `GET /sync/pull?cursor=<cursor>&branchId=<optional>`
- `POST /sync/push`
- `GET /sync/conflicts`
- `POST /sync/conflicts/:conflictId/rebase-complete`

Push request shape:

- `deviceId`
- `baseCursor`
- `commands[]`
- each command includes `commandId`, `entityType`, `entityId`, `operation`, `baseVersion`, `payload`, and `clientTimestamp`

Push response shape:

- `accepted[]`
- `rejected[]`
- `conflicts[]`
- `newCursor`
- `serverChanges[]`

Conflict rule:

- If `baseVersion` does not match the current server entity version, reject the command and create a conflict record.
- Client pulls latest server state, rebases locally, then pushes a new command.
- Last write wins is not used for inventory, sales, supplier balances, purchases, transfers, or subscriptions.
- Push accepts business commands, not raw database patches. Examples are `CREATE_SALE`, `ADJUST_STOCK`, `RECEIVE_PURCHASE`, and `UPDATE_PRODUCT`.
- Offline write commands are accepted only when created during a valid cached-session write window, currently 24 hours. Branch creation, staff/admin changes, transfer workflow actions, and subscription actions are online-only in v1.

### Subscriptions

- `GET /billing/plans`
- `GET /billing/subscription`
- `GET /billing/history`
- `POST /billing/mpesa/stk-push`
- `POST /billing/stripe/checkout-session`
- `POST /webhooks/mpesa/callback`
- `POST /webhooks/stripe`

M-Pesa callback:

- verify expected payload fields
- log payment event
- find pending subscription by `CheckoutRequestID`
- idempotently activate on success
- mark failed on payment failure
- update business account subscription fields

Stripe webhook:

- verify signature using raw body
- log payment event with unique provider event ID
- idempotently activate subscription on checkout completion
- mark failed or ignored for unsupported events

### Super Admin

- `GET /admin/businesses`
- `GET /admin/businesses/:businessAccountId`
- `POST /admin/businesses/:businessAccountId/pause`
- `POST /admin/businesses/:businessAccountId/resume`
- `POST /admin/businesses/:businessAccountId/revoke`
- `POST /admin/businesses/:businessAccountId/branch-limit`
- `POST /admin/businesses/:businessAccountId/subscriptions/extend`
- `POST /admin/businesses/:businessAccountId/subscriptions/manual-activate`
- `POST /admin/payment-events/:eventId/retry`
- `GET /admin/audit-logs`
- `GET /admin/payments`

Manual admin actions always create audit logs.

## 6. Service Layer

Controllers only parse input and return responses. Business rules live in services:

- `AccountService`: onboarding, business account status, plan limits, membership resolution.
- `BranchService`: branch CRUD, limit enforcement, branch access.
- `ProductService`: shared product catalog CRUD, branch inventory linking, cashier-safe serializers.
- `InventoryService`: stock state, stock movements, adjustment validation, alert updates.
- `TransferService`: transfer workflow and transactional stock movement.
- `SupplierService`: suppliers, payments, ledgers, balances.
- `PurchaseOrderService`: PO workflow and transactional receiving.
- `SalesService`: sales creation, stock deduction, debtor credit handling.
- `ExpenseService`: expense records.
- `DebtorService`: debtor balances and payments.
- `ReportService`: branch and all-branch aggregations.
- `SyncService`: pull cursors, push command application, stale-write conflict creation.
- `BillingService`: plan pricing, M-Pesa STK, Stripe checkout, subscription activation.
- `WebhookService`: payment event verification, logging, idempotent processing.
- `AdminService`: platform account actions and overrides.
- `AuditService`: immutable audit logging.

## 7. No-Cron Correctness Rules

### Subscription Expiry

Every protected request checks `subscriptionEndsAt` against current server time. If expired, effective access becomes read-only even if `subscriptionStatus` has not been physically updated to `expired`.

Offline writes created after `subscriptionEndsAt`, account pause, branch disablement, or staff suspension are rejected during sync once the server has that state. The desktop may remain read-only after its offline write window expires.

### Payment State

Webhooks are the primary automatic payment state transition. Manual admin endpoints handle missing callbacks, failed processing, or support cases.

### Cleanup

Use MongoDB TTL indexes for:

- idempotency keys
- expired sync technical records where safe
- short-lived device heartbeats if introduced later

Allowed hard deletes, such as product, sale, or purchase deletes, are represented in sync through retained delete events. Audit-sensitive records are append-only.

### Alerts

Low stock and stock status alerts update inside the same service path that changes inventory.

### Failed Payment Events

Failed webhook processing stores `payment_events.processingStatus=failed`. Super-admin can inspect and retry the event manually.

## 8. Validation and Error Rules

- Use DTO validation for every request body and query.
- Use standardized error response shape: `{ error: { code, message, details } }`.
- Use `401` for missing or invalid auth.
- Use `403` for insufficient role or branch permission.
- Use `402` for expired subscription write attempts.
- Use `409` for sync version conflicts and stock concurrency conflicts.
- Use `422` for validation errors.
- Use `429` for rate-limited auth/payment sensitive routes.

## 9. Security Rules

- Secrets are read from environment variables only.
- Daraja, Stripe, and Firebase Admin keys are never returned to clients.
- Webhooks verify provider signatures or provider-specific identifiers where available.
- Super-admin actions require platform-admin role and audit logging.
- Cashier responses are serialized through role-aware response mappers.
- All object IDs are validated and scoped by `businessAccountId`.

## 10. Test Coverage

Required test suites:

- Auth context and tenant resolution.
- Branch limit enforcement.
- Role and branch permissions.
- Cashier hidden-cost serializers.
- Product and inventory CRUD.
- Sale transaction stock deduction.
- Purchase receiving stock and supplier balance updates.
- Stock transfer workflow.
- Supplier ledger correctness.
- Expired and paused account read-only enforcement without cron.
- Sync pull and push.
- Sync stale-write conflict rejection and rebase flow.
- M-Pesa callback idempotency.
- Stripe webhook signature and idempotency.
- Manual admin subscription override.
- Audit log creation for sensitive actions.
