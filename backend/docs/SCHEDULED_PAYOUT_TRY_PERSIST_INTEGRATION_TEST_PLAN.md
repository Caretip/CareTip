# `tryPersistReconcileMatch` — integration test plan

**Status:** Plan only. **Do not run** against development or production databases without a dedicated isolated URL.

## Goal

Exercise **production** `tryPersistReconcileMatch` Prisma `updateMany` paths (employee + business tables), not in-memory test hooks.

## Prerequisites (not verified in repo)

1. **Dedicated database** — empty schema or disposable database instance used only for CI/staging integration tests. Must not share `DATABASE_URL` with developer laptops or production.
2. **Explicit env** — e.g. `SCHEDULED_PAYOUT_INTEGRATION_DATABASE_URL` documented in CI secrets; tests **refuse to start** if URL matches known prod/dev patterns (team-defined allowlist).
3. **Migrations applied** — both `20261010180000_scheduled_payout_recovery_fields` and `20261010210000_scheduled_payout_claim_token`.
4. **Seed fixtures** — minimal `Business`, `Employee`, `EmployeeStripeAccount` / business Connect account rows with fake `stripeAccountId` (no Stripe calls).
5. **No Stripe** — tests must not call `getStripeClient()`; pass synthetic `Stripe.Payout` objects into `tryPersistReconcileMatch` only.

## Harness sketch

- **Runner:** `backend/scripts/scheduled-payout-try-persist-integration.ts` (to be added when DB is available).
- **Pattern:** Follow `employee-scheduled-bank-payout-runtime.ts` (uses `prisma` + fixtures) but scope only to `tryPersistReconcileMatch`.
- **Teardown:** Delete fixture ledgers by id prefix `integ_try_persist_` in `after` block.
- **Parallel:** Run cases sequentially per ledger id to avoid cross-test races.

## Cases

| # | Scenario | Setup | Action | Assert |
|---|----------|-------|--------|--------|
| 1 | Fresh claim blocks admin | `processingClaimToken` set, `processingClaimedAt` = now | `tryPersistReconcileMatch` | `{ ok: false, reason: processing_claim_held }`; claim unchanged |
| 2 | Stale claim allows attach | `processingClaimedAt` older than `SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS` | `tryPersistReconcileMatch` | `{ ok: true }`; claim cleared; `stripePayoutId` set |
| 3 | Conflicting `po_` | Ledger has `po_other` | `tryPersist` with `po_new` | `payout_id_conflict`; row unchanged |
| 4 | Zero-row race | Second call after first succeeded | Two persists different `po_` | Second returns `concurrent_update_conflict` or `payout_id_conflict` |
| 5 | Idempotent reattach | Same `po_`, `submitted` | `tryPersist` same payout | `{ ok: true, idempotent: true }`; no duplicate side effects |
| 6 | Competing reconciles | Two parallel `tryPersist` same ledger | `Promise.all` | Exactly one `ok: true`; other conflict |
| 7 | Audit failure messaging | Mock audit failure after persist (service-level) | `reconcileScheduledPayoutOpsLedger` with audit stub | Response `ledgerMutationMayHaveOccurred: true`; ledger still submitted |

## Employee / business parity

Duplicate cases 1–5 for `stripe_connect_scheduled_payout_requests` (business ledger).

## Audit + blind retry (case 7)

Document expected operator behavior: after `audit_log_failed` with `ledgerMutationMayHaveOccurred: true`, integration test asserts ledger row has `submitted` and **does not** call reconcile again without reading state (simulate operator refresh via `findUnique`).

## What isolated runtime scripts already cover

- `platform-scheduled-payout-ops-runtime.ts` — `reconcileScheduledPayoutOpsLedger` with **mocked** `loadLedger` / `tryPersistReconcileMatch` (no Prisma).
- `scheduled-bank-payout-recovery-runtime.ts` — reconciliation list semantics, not `tryPersist`.

## Execution command (when prerequisites exist)

```bash
cd backend
# Example only — replace with approved integration URL
SCHEDULED_PAYOUT_INTEGRATION_DATABASE_URL="..." npx tsx scripts/scheduled-payout-try-persist-integration.ts
```

**Not executed** as part of this release-prep task.
