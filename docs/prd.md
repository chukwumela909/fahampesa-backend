# FahamPesa Backend PRD

Business-side branch, inventory, and supplier behavior must remain aligned with [FahamPesa Core User Modules](./core-user-modules.md).

## Problem Statement

FahamPesa needs a production-ready server-side backend for the web and desktop apps, separated from the current Next.js and Firebase-heavy implementation. The backend must securely isolate each business account's data, support multi-branch retail operations, enable full offline desktop usage with SQLite sync, and manage FahamPesa subscriptions through M-Pesa for Kenya and Stripe for other countries.

The system must not depend on cron jobs or persistent background workers for correctness. Subscription enforcement, stock correctness, sync correctness, alerts, and billing state must be reliable through request-time checks, transactional writes, webhooks, manual admin actions, MongoDB TTL indexes, and action-time updates.

## Solution

Build an Express, TypeScript, and MongoDB backend that verifies Firebase Auth ID tokens, maps authenticated users to a business account, enforces role and branch permissions, and owns all business data. The backend becomes the authority for business records, stock movement, offline sync, subscription status, permissions, audit logs, and admin actions.

## User Stories

1. As an owner, I want to create and manage branches, so that each physical store has isolated data.
2. As an owner, I want free accounts limited to 1 branch and paid accounts limited to 6 branches, so that plan limits are enforced.
3. As a super-admin, I want to override a business branch limit, so that special accounts can be handled manually.
4. As a manager or cashier, I want to see only my assigned branches, so that branch data stays protected.
5. As a cashier, I want to record sales without seeing cost price or profit, so that sensitive financial data is hidden.
6. As a branch user, I want a shared business product catalog with branch-specific stock and pricing, so that product identity is consistent while branch operations remain isolated.
7. As a branch user, I want stock quantity to change only through business actions, so that no one can directly edit inventory numbers without a reason.
8. As a branch user, I want inventory changes to create stock movement records, so that stock history is auditable.
9. As a manager, I want stock transfers to deduct from one branch and add to another, so that inter-branch movement is accurate.
10. As a manager, I want transfers allowed only when both branches already have the product, so that branch catalogs stay deliberate and controlled.
11. As a branch user, I want suppliers and supplier ledgers to be branch-specific, so that balances do not mix across locations.
12. As a manager, I want receiving a purchase to increase inventory and update supplier balance, so that stock and payables stay aligned.
13. As an owner, I want to disable and re-enable branches instead of deleting them, so that branch history remains intact.
14. As an owner, I want reports per branch and across all accessible branches, so that I can track performance centrally.
15. As a desktop user, I want all business data available offline, so that the app works without internet.
16. As a desktop user, I want queued SQLite changes to sync automatically when online, so that local work reaches the server.
17. As the system, I want to reject stale offline writes and require rebase, so that conflicting stock and sales changes stay consistent.
18. As the system, I want offline write permissions to expire after a short window, so that suspended or expired accounts cannot keep writing indefinitely.
19. As a Kenya business owner, I want to pay FahamPesa subscriptions with M-Pesa, so that local payment is easy.
20. As a non-Kenya business owner, I want to pay by Stripe card, so that I can subscribe internationally.
21. As a super-admin, I want to create, extend, pause, revoke, and audit accounts, so that subscriptions can be managed safely.
22. As an expired or paused business user, I want read-only access, so that I can review data and billing while writes are blocked.
23. As an owner, I want subscription expiry enforced live from `subscriptionEndsAt`, so that account access is correct without cron.
24. As a super-admin, I want manual payment and account override tools, so that unresolved webhook or payment cases can be fixed safely.
25. As the system, I want old sync metadata and idempotency records to expire automatically, so that cleanup does not require scheduled jobs.
26. As a manager, I want low stock and inventory alerts updated when stock changes, so that alerts remain useful without batch jobs.
27. As an admin, I want payment events logged even when processing fails, so that failed webhook handling can be retried or overridden manually.

## Implementation Decisions

- Use Express, TypeScript, Mongoose, and REST JSON v1.
- Use MongoDB transactions for stock, purchase receiving, transfer receiving, supplier balances, sales stock deduction, sync command application, and subscription state changes.
- Require MongoDB Atlas or a MongoDB replica set so transactions are available.
- Use Firebase Auth only for identity verification; the backend owns business authorization and data.
- Use `businessAccountId` as the tenant boundary for all business data; never trust client-supplied owner or user IDs for tenancy.
- Roles are `owner`, `manager`, and `cashier`; managers and cashiers can be assigned to multiple branches.
- Branch limit rules are free plan = 1 branch, paid plan = 6 branches, with optional super-admin override per business.
- Products use a shared business-level catalog for identity fields such as name, barcode, category, image, and description.
- Inventory, quantity, reorder level, cost price, selling price, stock value, status, movements, purchases, adjustments, transfers, and sales remain branch-specific through `branch_id`.
- Product detail shows stock per branch using branch inventory records.
- Stock quantity is never edited directly. It changes only through actions such as sale, purchase receiving, stock adjustment, transfer receive, return, damage, wastage, theft, or initial stock setup.
- Transfers require the product to already exist in both source and destination branches.
- Suppliers are per-branch records; supplier balance, purchases, payments, and ledger are branch-specific.
- Branches are disabled and re-enabled, not physically deleted.
- Stock movements, supplier ledger entries, audit logs, and payment events are append-only. Corrections use reversal or adjustment entries.
- Products, sales, and purchases may be hard-deleted when permitted, but sync must emit delete events so desktop clients remove local copies.
- Business sale payments are record-only. M-Pesa and Stripe are only for FahamPesa subscription billing.
- Offline sync covers all business data: branches, products, inventory, sales, expenses, debtors, suppliers, purchases, staff cache, settings, report snapshots, and audit-relevant records.
- Offline business writes are limited to a 24-hour cached-session window. Branch creation, staff/admin changes, transfers, and subscription actions require online access in v1.
- Region is determined from onboarding country with IP as a supporting signal; Kenya sees M-Pesa subscription flow, other countries see Stripe card flow.
- Expired and paused accounts retain read-only access but cannot create, update, or delete business records.
- No cron job is required for core correctness. Subscription expiry is enforced on every request by evaluating `subscriptionEndsAt`, webhook callbacks process payments, manual admin tools resolve exceptions, TTL indexes clean short-lived technical records, and alerts update during stock-changing actions.
- Public backend interfaces include auth/session context, branch-scoped CRUD APIs, inventory movement APIs, transfer workflow APIs, supplier/purchase/payment APIs, sales/expense/debtor APIs, reports APIs, sync pull/push APIs, subscription checkout/webhook APIs, and super-admin account APIs.

## Testing Decisions

- Test external behavior through API and service tests, not internal implementation details.
- Cover tenant isolation, branch isolation, role permissions, cashier cost-price hiding, plan branch limits, expired read-only enforcement, stock movement correctness, purchase receiving, supplier balances, transfer workflows, sync stale-write rejection, M-Pesa callbacks, Stripe webhooks, idempotency, manual admin overrides, and audit logging.
- Include idempotency tests for subscription webhooks and offline sync retries.
- Include authorization tests proving users cannot access another business account or an unassigned branch.
- Include tests proving subscription expiry is enforced without cron by request-time `subscriptionEndsAt` logic.

## Out of Scope

- Migrating existing Firestore data into MongoDB.
- Processing merchant or customer payments for business sales.
- Shared supplier balances across branches.
- Native desktop implementation details beyond the backend sync contract.
- Required cron jobs or persistent worker processes for v1 correctness.
- Full accounting, tax filing, payroll, or external ERP integrations.

## Further Notes

- The old Next.js app remains the behavioral reference, but the new backend becomes the authority.
- Firebase Auth remains in place for v1.
- Admin override for branch limits is required.
- Subscription pricing remains monthly `KSH 2000 / USD 10` and yearly `KSH 20000 / USD 100`.
- If deployment is Vercel, the backend must remain serverless-compatible. Optional maintenance endpoints may exist, but no business-critical rule may depend on scheduled execution.
