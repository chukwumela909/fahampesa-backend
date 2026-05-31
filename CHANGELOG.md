# Changelog

All notable backend planning and implementation changes for FahamPesa will be tracked here.

This file follows a lightweight chronological format during active development.

## 2026-05-29

### Added

- Wired live subscription billing providers for M-Pesa Daraja STK push and Stripe Checkout/Webhooks.
- Added an owner billing endpoint to activate the current business on a manual monthly subscription.
- Added signed Stripe raw-body webhook handling, real M-Pesa callback parsing, callback compatibility aliases, and checkout status polling.
- Added production payment environment validation and placeholder deployment docs.

## 2026-05-08

### Added

- Created backend PRD in `docs/prd.md`.
- Created low-level design in `docs/lld.md`.
- Created phased implementation plan in `docs/implementation-plan.md`.
- Added canonical user-side core module reference in `docs/core-user-modules.md`.
- Added this changelog to track backend implementation changes.
- Added test flow tracker in `TEST_FLOW.md`.
- Added endpoint and implementation testing guide in `docs/testing-guide.md`.
- Added simplified API request/response test flow in `docs/api-test-flow.md`.
- Added backend environment setup guide in `docs/env-setup.md`.
- Added Firebase browser token test client in `test-clients/firebase-token-client.html`.
- Added Firebase token client config paste/save flow to avoid stale hard-coded Web SDK keys during manual testing.

### Decided

- Backend stack: Express, TypeScript, Mongoose, MongoDB.
- Authentication: Firebase Auth ID token verification.
- Backend-owned authorization: business accounts, memberships, roles, branch access, subscription access.
- Roles: owner, manager, cashier.
- Branch limit: free plan allows 1 branch, paid plan allows 6 branches, super-admin may override.
- Branches are disabled/re-enabled, not physically deleted.
- Product identity uses a shared business-level product catalog.
- Branch isolation lives in branch inventory, sales, expenses, suppliers, purchases, transfers, reports, and stock movements.
- Stock quantity is never directly edited; it changes only through business actions.
- No cron is required for correctness; subscription access uses request-time `subscriptionEndsAt` logic.

### Implementation Scope Next

- Scaffold the backend project foundation.
- Implement authentication context resolution.
- Implement business account and membership models.
- Implement branch model, branch creation, branch listing, branch access rules, and branch disabling/re-enabling.

### Implemented

- Scaffolded TypeScript Express backend with build and test scripts.
- Added MongoDB/Mongoose connection and transaction helper.
- Added Firebase Admin token verifier abstraction.
- Added auth middleware that maps Firebase UID to internal user and resolves business membership context.
- Added subscription read-only write guard using request-time account state.
- Added recent reauthentication guard using Firebase token `auth_time`.
- Added models for users, business accounts, business memberships, branches, settings, and audit logs.
- Added onboarding endpoint for business account, owner membership, first branch, and default settings.
- Added branch list, create, get, update, disable, and enable endpoints.
- Added branch limit enforcement for free, paid, and override cases.
- Added branch action audit logging.
- Added Phase 1 integration tests using an in-memory MongoDB replica set.

### Verified

- `npm.cmd run build` passes.
- `npm.cmd test` passes with 10 Phase 1 tests.

## 2026-05-21

### Implemented

- Added shared business-level product catalog model.
- Added branch-scoped inventory item model.
- Added append-only stock movement model.
- Added low-stock alert model updated during stock-changing actions.
- Added branch product routes for list, create, detail, update, delete, bulk-upload skeleton, and CSV export.
- Added branch inventory routes for inventory list, stock adjustments, movements, and alerts.
- Added inventory adjustment command flow that updates stock and writes movement history transactionally.
- Added cashier-safe serializers that hide cost, stock value, margin, supplier, and movement value fields.

### Verified

- `npm.cmd run build` passes.
- `npm.cmd test` passes with 15 tests across Phase 1 and Phase 3 coverage.

### Implemented

- Added branch-scoped sales model and APIs.
- Added transactional multi-item sale creation with stock verification and stock deduction.
- Added sale stock movement creation and low-stock alert updates during sale creation.
- Added cashier-safe sale serialization that hides total cost, profit, line cost, and line profit.
- Added branch-scoped expense model and CRUD APIs.
- Added branch-scoped debtor and debtor payment models and APIs.
- Added credit-sale debtor balance updates and debtor payment balance reduction.

### Verified

- `npm.cmd run build` passes.
- `npm.cmd test` passes with 19 tests across Phase 1, Phase 3, and Phase 4 coverage.

### Implemented

- Added branch-scoped supplier model and APIs.
- Added append-only supplier ledger entries and supplier payment recording.
- Added purchase order model and APIs with approve, receive, and cancel workflow.
- Added purchase receiving flow that increases branch inventory, creates purchase stock movements, updates product cost cache, updates low-stock alerts, and increases supplier payable balance.
- Added stock transfer model and APIs with request, approve, ship, receive, cancel, and reject workflow.
- Added transfer validation requiring product inventory in both source and destination branches.
- Added transfer receive flow that creates paired traceable `transfer_out` and `transfer_in` stock movements.
- Serialized integration tests by setting Vitest `fileParallelism: false` so MongoDB replica-set integration tests run reliably.

### Verified

- `npm.cmd run build` passes.
- `npm.cmd test` passes with 22 tests across Phase 1, Phase 3, Phase 4, and Phase 5 coverage.

### Implemented

- Added live report APIs for dashboard, sales, inventory valuation, low stock, suppliers, expenses, and branch performance.
- Added owner-only all-branch report support and assigned-branch restrictions for managers and cashiers.
- Added cashier-safe report filtering and blocked cashier access to financial valuation reports.
- Added branch dashboard endpoint at `GET /api/v1/branches/:branchId/dashboard`.
- Added settings read and update APIs with cashier-safe reads and owner/manager update scope.

### Verified

- `npm.cmd run build` passes.
- `npm.cmd test` passes with 26 tests across Phase 1, Phase 3, Phase 4, Phase 5, and Phase 6 coverage.

### Decided

- Phase 7 offline sync is intentionally skipped temporarily while placeholder subscription billing is implemented first.
- M-Pesa Daraja and Stripe are represented by deterministic placeholder providers until live credentials are provided.

### Implemented

- Added subscription and payment event models.
- Added placeholder M-Pesa STK checkout flow for Kenya accounts.
- Added placeholder Stripe checkout session flow for non-Kenya accounts.
- Added billing plans, current subscription, history, and receipt endpoints.
- Added M-Pesa callback and Stripe webhook endpoints with payment event logging.
- Added idempotent webhook activation that updates `business_accounts.subscriptionEndsAt` and paid plan state.
- Added failed payment event logging for manual retry visibility.
- Preserved business sale payment methods as record-only labels separate from subscription billing.

### Verified

- `npm.cmd run build` passes.
- `npm.cmd test` passes with 30 tests across Phase 1, Phase 3, Phase 4, Phase 5, Phase 6, and placeholder Phase 8 coverage.

### Implemented

- Added platform-admin authorization from Firebase auth context.
- Added super-admin business search and detail APIs.
- Added pause, resume, revoke, and branch-limit override admin actions.
- Added subscription extension and manual activation admin actions.
- Added payment event list and retry-request APIs.
- Added platform audit log listing.
- Ensured manual admin actions create platform-scoped audit logs.

### Verified

- `npm.cmd run build` passes.
- `npm.cmd test` passes with 34 tests across Phase 1, Phase 3, Phase 4, Phase 5, Phase 6, placeholder Phase 8, and Phase 9 coverage.

## 2026-05-24

### Implemented

- Added public phone-existence check for phone-login OTP flows.
- Added Firebase custom-claim mapping for platform admin authorization.
- Added onboarding progress persistence, status lookup, and skip support.
- Extended business onboarding to capture personal profile data, legal company fields, and staff invitations.
- Added onboarding completion tracking when a business account is created.

### Verified

- `npm.cmd run build` passes.
- `npm.cmd test` passes with 37 tests across Phase 1, Phase 3, Phase 4, Phase 5, Phase 6, placeholder Phase 8, and Phase 9 coverage.
