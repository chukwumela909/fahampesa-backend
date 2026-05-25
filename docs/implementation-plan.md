    # FahamPesa Backend Implementation Plan

Business-side branch, inventory, and supplier behavior must remain aligned with [FahamPesa Core User Modules](./core-user-modules.md).

## Summary

Build the separated FahamPesa backend as an Express, TypeScript, Mongoose, and MongoDB REST API. Implement the foundation first, then vertical slices through onboarding, branches, inventory, sales, suppliers, sync, billing, and admin. The system must not require cron jobs for correctness.

## Current Implementation Status

Use `docs/api-reference.md` as the source of truth for endpoints implemented in the current codebase.
Use this implementation plan as roadmap/context, not as proof that every listed future item exists.

Current code status:

- Implemented: foundation, Firebase auth middleware, onboarding, business accounts, branches, branch products, inventory, sales, expenses, debtors, suppliers, purchase orders, transfers, reports, settings, billing placeholders/webhooks, and platform admin APIs.
- Implemented auth/onboarding additions: phone existence lookup, onboarding status, onboarding progress save, onboarding skip, legal company fields, owner personal profile updates, and staff invitation capture.
- Partially implemented: billing provider integration is represented by service abstractions and webhook/payment-event flows, but the project currently depends only on local service code and does not include Stripe/Daraja SDK packages.
- Partially implemented: settings supports `businessProfile`, `receiptSettings`, `notificationSettings`, `deviceSettings`, and `syncSettings` as flexible objects.
- Placeholder: `POST /branches/:branchId/products/bulk-upload` exists but returns `501 bulk_upload_not_implemented`.
- Not implemented yet: Offline Sync routes and sync device/change-log/conflict APIs from Phase 7.
- Not implemented yet: Phase 10 hardening items such as rate limiting, seed scripts, deployment notes, backup/export notes, and full OpenAPI-style generated documentation.
- Not currently present: a dedicated `serializers` folder, request ID middleware, idempotency key storage for general retried writes, or public sync APIs.

## Phase 1: Project Foundation

- Scaffold TypeScript Express app with structured folders for `config`, `middleware`, `models`, `routes`, `controllers`, `services`, `validators`, `serializers`, `tests`, and `utils`.
- Add environment validation for MongoDB, Firebase Admin, Firebase Storage, Stripe, Daraja, and app URLs.
- Configure Mongoose connection and transaction helper.
- Add sync-ready model conventions from day one: `version`, `createdAt`, `updatedAt`, command-based writes, and delete change events for hard-deletable entities.
- Add standard error handling, request logging, request IDs, DTO validation, and JSON response conventions.
- Add Firebase Auth verification middleware.
- Add test framework, in-memory or test Mongo setup, and basic health/auth tests.

Acceptance:

- App boots locally.
- Health endpoint works.
- Auth middleware rejects invalid tokens and accepts mocked verified tokens in tests.
- Database connection and transaction helper are testable.

## Phase 2: Tenancy, Accounts, Roles, and Onboarding

- Implement `users`, `business_accounts`, `business_memberships`, `branches`, `settings`, and `audit_logs` models.
- Implement onboarding endpoint that creates user profile, business account, owner membership, first branch, and default settings transactionally.
- Implement request context resolution from Firebase UID to business membership.
- Implement subscription effective-access middleware using `subscriptionEndsAt` request-time logic.
- Implement role and branch permission guards.
- Implement branch limit enforcement: free 1, paid 6, super-admin override.
- Implement branch disabling and re-enabling instead of physical branch deletion, guarded by recent Firebase reauthentication.

Acceptance:

- Users cannot access another business account.
- Expired or paused accounts can read but cannot write business data.
- Managers/cashiers only access assigned branches.
- Branch limit tests pass for free, paid, and override cases.

## Phase 3: Branch Products and Inventory

- Implement shared product catalog model, branch inventory item model, stock movement model, and alert model.
- Implement product CRUD, branch product/inventory linking, search, bulk upload skeleton, and export endpoint.
- Implement inventory adjustment service with movement ledger and reason/user/timestamp.
- Do not expose direct stock quantity editing. All inventory changes must go through business commands and stock movements.
- Make stock movements append-only; corrections use reversal or adjustment movements.
- Implement role-aware serializers that hide cost, profit, valuation, and supplier cost data from cashiers.
- Update low-stock alerts during inventory-changing actions.

Acceptance:

- Product identity is scoped by `businessAccountId`; stock, pricing, valuation, and movement data are always scoped by `businessAccountId` and `branchId`.
- Adjustments update inventory and create immutable stock movements.
- Cashier product/inventory responses hide sensitive fields.
- Low-stock alerts update without cron.

## Phase 4: Sales, Expenses, and Debtors

- Implement sales model and multi-item sale creation.
- Implement transactional sale creation that verifies stock, records sale, deducts inventory, creates stock movements, and updates alerts.
- Implement sale read/update/delete rules, including soft delete where needed.
- Implement expenses CRUD by branch.
- Implement debtors and debtor payments, including credit sales updating debtor balances.
- Keep all business payment methods record-only.

Acceptance:

- Sale creation cannot oversell stock.
- Sales with `mpesa` or `card` payment method do not call payment providers.
- Expenses and debtors are branch scoped.
- Reports can read these records per branch.

## Phase 5: Suppliers, Purchases, and Transfers

- Implement branch-specific suppliers, supplier payments, supplier ledger entries, and purchase orders.
- Implement supplier dashboard/detail data from branch-specific records.
- Implement purchase approval and receiving workflows.
- On purchase receiving, transactionally increase inventory, create stock movements, update supplier balance, and create ledger entries.
- Make supplier ledger entries append-only; corrections use reversal or adjustment entries.
- Implement stock transfers with request, approve, ship, receive, cancel, and reject workflows.
- Require every transferred product to already exist in both source and destination branches.
- On transfer receive, transactionally move stock and create paired stock movements.

Acceptance:

- Supplier balances are branch-specific.
- Purchase receiving updates inventory and supplier ledger atomically.
- Transfers never mix branches or businesses.
- Transfer stock movements are traceable by reference ID.

## Phase 6: Reports and Settings

- Implement dashboard, sales, inventory valuation, low-stock, supplier, expense, and branch performance report endpoints.
- Support `branchId` and owner-only `all` reports.
- Enforce role-aware field filtering in report responses.
- Implement business, receipt, notification, device, and sync settings endpoints.

Acceptance:

- Owners can view all-branch reports.
- Managers/cashiers are restricted to assigned branches.
- Cashiers do not see cost/profit/valuation reports.
- Settings remain functional and role scoped.

## Phase 7: Offline Sync

- Implement sync device registration.
- Implement server change log creation for syncable entity changes.
- Retain hard-delete events for at least 90 days and return `cursor_expired` when a desktop cursor is older than retention.
- Implement pull endpoint with cursor pagination and branch filtering.
- Implement push endpoint that applies queued client commands through service-layer methods.
- Enforce `baseVersion` checks and reject stale writes with conflict records.
- Enforce 24-hour offline write session limit.
- Keep branch creation, staff/admin changes, transfer workflow actions, and subscription actions online-only in v1.
- Implement conflict list and rebase-complete endpoints.
- Add idempotency keys with TTL indexes for sync retries.

Acceptance:

- Desktop can pull all business data it is allowed to access.
- Replayed commands are idempotent.
- Stale stock/sale/supplier writes are rejected with conflict details.
- Client can rebase and retry with a new version.

## Phase 8: Subscription Billing

- Implement plan pricing: monthly `KSH 2000 / USD 10`, yearly `KSH 20000 / USD 100`.
- Determine billing region from onboarding country, with IP as supporting metadata.
- Implement M-Pesa STK push for Kenya subscription checkout.
- Implement Stripe checkout for non-Kenya subscription checkout.
- Implement payment history and receipt data.
- Implement M-Pesa callback and Stripe webhook processing with event logging and idempotency.
- Update `business_accounts.subscriptionEndsAt` on successful subscription activation.
- Store failed payment events for manual retry.

Acceptance:

- Kenya accounts receive M-Pesa subscription checkout.
- Non-Kenya accounts receive Stripe card checkout.
- Webhooks activate subscriptions idempotently.
- Subscription expiry is enforced without cron.
- Business sales never invoke M-Pesa or Stripe.

## Phase 9: Super Admin Portal APIs

- Implement platform-admin authorization.
- Implement business search/detail APIs.
- Implement pause, resume, revoke, branch-limit override, subscription extend, and manual activation.
- Implement payment event retry endpoint.
- Implement platform audit logs and payment event views.

Acceptance:

- Admin actions update account state safely.
- Pause makes the business read-only.
- Manual subscription activation updates subscription and account access.
- Every admin action creates an audit log.

## Phase 10: Hardening and Release Readiness

- Add rate limits for auth-sensitive, billing, webhook, and admin routes.
- Add integration tests for core vertical slices.
- Add API documentation for web and desktop clients.
- Add deployment notes for serverless-compatible hosting.
- Add seed scripts for local development only.
- Add backup/export strategy notes for MongoDB Atlas.

Acceptance:

- Test suites pass.
- API documentation covers request/response shapes and error codes.
- Environment variables are documented.
- No route depends on cron or persistent workers for correctness.

## No-Cron Design Checklist

- Subscription access is computed from `subscriptionEndsAt` on every request.
- Webhooks and manual admin tools handle billing state changes.
- TTL indexes handle short-lived technical cleanup.
- Stock alerts update during stock-changing operations.
- Failed payment events remain visible and manually retryable.
- Reports compute live or from action-updated aggregates, not scheduled jobs.
- Stock quantity is never directly edited.
- Branches are disabled, not deleted.
- Audit-sensitive ledgers and events are append-only.
