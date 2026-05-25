# FahamPesa Backend Test Flow

This file tracks the test plan for each backend implementation phase. Each module should add tests here before or alongside implementation.

## Test Conventions

- Test external behavior through API and service boundaries.
- Verify tenant isolation on every module that touches business data.
- Verify branch isolation on every branch-scoped module.
- Verify role-based field filtering, especially cashier restrictions.
- Verify subscription read-only enforcement on write routes.
- Prefer deterministic fixtures for business accounts, branches, memberships, and Firebase-authenticated users.

## Phase 1: Foundation, Auth, Business Account, Branch

### Auth Context

- [x] Reject requests without `Authorization` header.
- [x] Reject requests with invalid Firebase ID token.
- [x] Accept valid Firebase ID token and resolve internal user.
- [x] Create or load internal user mapped by Firebase UID.
- [x] Resolve active business membership for authenticated user.
- [x] Return consistent request context: `userId`, `businessAccountId`, `role`, `assignedBranchIds`, `subscriptionEndsAt`.

### Onboarding / Business Account

- [x] Create business account for first-time owner.
- [x] Store optional personal profile details during onboarding.
- [x] Store optional legal company details during onboarding.
- [x] Save and resume onboarding progress before final business creation.
- [x] Allow onboarding setup to be skipped while preserving explicit status.
- [x] Capture staff invitations during onboarding.
- [x] Create owner membership transactionally with business account.
- [x] Create first branch transactionally during onboarding.
- [x] Create default settings transactionally during onboarding.
- [x] Prevent duplicate active owner onboarding for the same Firebase UID unless explicitly supported.
- [x] Check phone existence before phone-login OTP flow.

### Subscription Access Middleware

- [ ] Allow reads when subscription is active.
- [x] Allow writes when subscription is active.
- [x] Allow reads when subscription is expired.
- [x] Reject business writes when `subscriptionEndsAt` is in the past.
- [x] Reject business writes when account is paused.
- [ ] Allow billing/account routes while account is expired or paused.

### Branch Module

- [x] Owner can create a branch within plan limit.
- [x] Free plan cannot create more than 1 branch.
- [x] Paid plan cannot create more than 6 branches unless override is set.
- [x] Super-admin branch limit override is honored by branch creation service.
- [x] Owner can list all branches for the business account.
- [x] Manager can list only assigned branches.
- [x] Cashier can list only assigned branches.
- [x] User cannot access branches from another business account.
- [x] Branch create validates required fields from the existing branch structure.
- [x] Branch update preserves `businessAccountId`.
- [x] Branch disabling requires recent reauthentication.
- [x] Disabled branch is excluded from normal active branch selectors.
- [x] Owner can re-enable a disabled branch.
- [x] Branch actions write audit logs.

## Phase 2: Product Catalog and Branch Inventory

- [x] Shared product catalog is scoped by `businessAccountId`.
- [x] Branch inventory is scoped by `businessAccountId` and `branchId`.
- [x] Product detail shows stock per accessible branch.
- [x] Cashier responses hide cost price, stock value, and profit/margin.
- [x] Stock quantity cannot be patched directly.
- [x] Stock adjustment creates stock movement with quantity, reason, user, timestamp.

## Phase 3: Sales and Stock Deduction

- [x] Sale requires `branchId`.
- [x] Sale decreases branch inventory through stock movement.
- [x] Sale payment method is record-only.
- [x] Sale cannot oversell available stock.
- [x] Cashier can create assigned-branch sale.
- [x] Cashier cannot see cost/profit fields.

## Phase 4: Suppliers and Purchases

- [x] Supplier requires `branchId`.
- [x] Supplier balance is branch-specific.
- [x] Creating a purchase increases selected branch inventory.
- [x] Unpaid purchase creates payable / supplier ledger balance.
- [x] Supplier ledger entries are append-only.

## Phase 5: Transfers

- [x] Transfer requires source and destination branch IDs.
- [x] Transfer requires product inventory to exist in both branches.
- [x] Transfer deducts source branch and adds destination branch.
- [x] Transfer creates paired stock movements.
- [x] Transfer rejects cross-business branch IDs.

## Phase 6: Reports and Settings

- [x] Owners can view all-branch reports.
- [x] Managers are restricted to assigned-branch reports.
- [x] Cashiers cannot see cost/profit/valuation reports.
- [x] Dashboard, sales, inventory valuation, low-stock, supplier, expense, and branch performance reports are available.
- [x] Settings can be read and updated with role scoping.

## Phase 7: Offline Sync

- [ ] Skipped temporarily; to be implemented after placeholder subscription billing.
- [ ] Push accepts business commands, not raw database patches.
- [ ] Stale `baseVersion` creates conflict.
- [ ] Delete events are returned to clients.
- [ ] Cursor older than retention returns `cursor_expired`.
- [ ] Offline write window is enforced.

## Phase 8: Billing and Admin

- [x] Kenya account uses M-Pesa subscription checkout.
- [x] Non-Kenya account uses Stripe checkout.
- [x] Webhooks activate subscriptions idempotently.
- [x] Failed webhook events are logged for manual retry.
- [x] Manual admin activation updates business subscription state.
- [x] Pause makes business read-only.
