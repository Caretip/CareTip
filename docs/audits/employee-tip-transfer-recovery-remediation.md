# Employee Tip Transfer-Failed Recovery — Forensic Validation & Remediation

**Date:** 2026-09-23  
**Case reference:** Charline Test / payable `cmudvx61o00smkm48a5ltlowv` / €53.51 net  
**Prior audit:** [`charline-stripe-53-51-forensic-audit.md`](./charline-stripe-53-51-forensic-audit.md)

---

## 1. Executive summary

**Revalidation confirmed** the prior audit’s core money-flow conclusions and identified one **confirmed product bug** that prevented automatic recovery of `transfer_failed` platform-hold payables.

**Root cause of stuck recovery:** `employeePayableSummaryForEmployee()` counted only `held_platform` toward `heldPlatformCents`, excluding `transfer_failed`. The Connect status endpoint only schedules release when `heldPlatformCents > 0`, so after a failed release attempt the payable became **invisible to automatic recovery** even though `releaseHeldPlatformPayablesForEmployee()` already supports retrying `transfer_failed` rows.

**Remediation (surgical):**
1. Include `transfer_failed` in recoverable platform-hold cents (`heldPlatformCents`).
2. Centralize release scheduling in `scheduleReleaseRecoverablePlatformPayablesForEmployee()`.
3. Trigger scheduling from payout-history load (`GET /payables`) as well as Connect status.
4. Show failure/transfer timestamps in payout history (`activityAt` / `updatedAt`).

**Charline’s €53.51 was NOT recovered during this work.** No production Stripe transfer was created. Manual ops procedure documented below.

---

## 2. Verified Charline money-flow timeline (Europe/Berlin)

**Correction from prior report:** One timeline line used **UTC timestamps mislabeled as Berlin**. Verified chronology:

| Berlin (CEST) | UTC | Event |
|---------------|-----|-------|
| **11:12:36** | 09:12:36 | €60 tip succeeded → `platform_hold` payable €53.51 net |
| **11:14:13** | 09:14:13 | `employee_stripe_accounts` row created (`acct_1UImFh66w9bX7ZFb`) |
| **11:17:29** | 09:17:29 | CareTip `transfers.create` **rejected** → `transfer_failed` |
| **12:38:43** | 10:38:43 | €50 tip → `destination_employee` (Connect ready for new tips) |
| **11:49:29** | 09:49:29 | Bank payout `po_1UIog166w9bX7ZFb` €43.42 **paid** (other tips) |
| **11:49:49** | 09:49:49 | Connect status sync (`stripeConnectUpdatedAt`) |
| **13:51:03** | 11:51:03 | €50 tip → `destination_employee` |

**Why destination tips appear “before” account creation in UTC ordering:** The €50 at `10:38 UTC` is **12:38 Berlin**, which is **after** account creation at **11:14 Berlin**. No duplicate Stripe account or timezone bug — prior report ordering was wrong when mixing UTC values with Berlin labels.

---

## 3. Verified current state of €53.51 (read-only, audit time)

| Field | Value | Confidence |
|-------|-------|------------|
| Payable ID | `cmudvx61o00smkm48a5ltlowv` | High |
| Status | `transfer_failed` | High |
| Gross tip | €60.00 (`6000` cents) | High |
| Platform fee | €6.49 (`649` cents) | High |
| Net payable | **€53.51** (`5351` cents) | High |
| `transferredCents` | `0` | High |
| `stripeTransferId` | `null` | High |
| `lastTransferError` | Missing transfers capability on destination account | High |
| `createdAt` | 2026-09-23T09:12:36.060Z | High |
| `updatedAt` | 2026-09-23T09:17:29.437Z (failure) | High |
| Refunds/reversals | None | High |
| Connect now | `ready`, `payoutsEnabled: true` | High |

**Money location:** Customer charge `ch_3UImE966w930Tx0A1n6lUZzj` was **platform_hold** — funds remain on **CareTip platform Stripe balance**; €53.51 not transferred to `acct_1UImFh66w9bX7ZFb`. Platform Stripe balance not independently queried in this audit.

---

## 4. Previous-audit findings — confirmed / rejected

| Prior finding | Verdict |
|---------------|---------|
| €53.51 is net of €60 tip | **Confirmed** |
| Failed stage is Stripe Transfer (not bank payout) | **Confirmed** |
| `stripeTransferId` null | **Confirmed** |
| `transfer_failed` excluded from `heldPlatformCents` | **Confirmed** (bug) |
| Stuck due to missing auto-retry trigger | **Confirmed** |
| Timeline with 10:38 Berlin before 11:12 | **Rejected** — was UTC mislabeled |
| Employee received €53.51 via bank | **Rejected** — €43.42 payout is separate |

---

## 5. Exact root cause

```
Tip (platform_hold)
  → releaseHeldPlatformPayablesForEmployee() [supports transfer_failed]
  → Stripe rejects transfer (capability)
  → status = transfer_failed

Later: Connect becomes capable
  → GET /employee-connect/status
  → heldPlatformCents = 0  (transfer_failed NOT counted)
  → release NOT scheduled

account.updated may also skip release (stale event / already-ready)
  → payable remains transfer_failed indefinitely
```

---

## 6. Why retry did / didn’t occur

| Trigger | Can recover `transfer_failed`? | Charline case |
|---------|-------------------------------|---------------|
| `releaseHeldPlatformPayablesForEmployee()` direct call | **Yes** | Not called after 11:17 |
| `account.updated` → ready | **Yes**, if handler runs & updates | Uncertain; no retry observed |
| `GET /employee-connect/status` + `heldPlatformCents > 0` | **No** (before fix) | **Blocked** — cents = 0 |
| `GET /employee-connect/payables` | **No** (before fix) | Not triggered release |

---

## 7. Intended state machine (derived from code)

```
TIP SUCCESS (platform_hold)
  → held_platform

CONNECT READY + release
  → transferring (optimistic claim)
  → transfers.create (idempotency: emp_tip_release:{payableId})
  → transferred (stripeTransferId set, transferredCents = amount)

FAILURE (definitive Stripe error)
  → transfer_failed (recoverable)
  → retry when release runs again AND remainingPayableCents > 0

NOT recoverable via release:
  → transferred (complete)
  → refunded (ledger adjusted)
  → held_business / destination_settled (different models)
```

**Network timeout / unknown Stripe result:** Same idempotency key `emp_tip_release:{payableId}` ensures Stripe returns the original transfer if it was created. DB claim via `updateMany` + `stripeTransferId` unique constraint prevents double persistence.

---

## 8. Transfer idempotency analysis

| Mechanism | Detail |
|-----------|--------|
| Stripe key | `emp_tip_release:{payableId}` — deterministic per payable |
| DB uniqueness | `employee_tip_payables.transaction_id` unique; `stripe_transfer_id` unique |
| Concurrency | `runSerializedByKey('employee-tip-release:{employeeId}')` |
| Claim | `updateMany` with status guard + `stripeTransferId: null` |
| Retry same payable | Reuses same idempotency key → safe |
| After `transferred` | Excluded from release query |
| `transferredCents` authority | Set only on successful DB update after Stripe success |

**Duplicate-transfer protection: PASS** (existing + verified by tests).

---

## 9. Duplicate-payment risk analysis

| Risk | Mitigation | Status |
|------|------------|--------|
| Two Stripe Transfers for one payable | Idempotency key + serialized release | **Low** |
| Two DB rows for one tip | `transactionId` unique | **Low** |
| Pay after refund | `remainingPayableCents` gate | **Low** |
| Concurrent workers | Per-employee serialization | **Low** |

---

## 10. Correct recovery trigger (chosen)

**Smallest safe fix:**

1. **Include `transfer_failed` in `heldPlatformCents`** — restores existing status-poll trigger.
2. **Schedule release on payout-history load** — employee opens “CareTip transfers” tab.
3. **Keep `account.updated` path** unchanged.

No new cron, no admin UI, no global refactor.

---

## 11. Capability requirements

Release requires `isEmployeeRecipientReady()`:
- `stripeAccountId` starts with `acct_`
- `stripeConnectStatus === ready`
- `stripePayoutsEnabled === true`

Charline’s failure was Stripe rejecting `transfers.create` despite CareTip marking account ready — **transfers capability** on the connected account. Post-fix, retry still fails if capability missing; succeeds when Stripe accepts.

---

## 12. Implementation performed

### Backend
- `employeeTipPayable.service.ts`
  - `isRecoverablePlatformHoldPayableStatus()`
  - `employeePayableActivityTimestamp()`
  - `heldPlatformCents` includes `transfer_failed`
  - Activity API returns `updatedAt`, `activityAt`
- `employeeTipRelease.service.ts`
  - `scheduleReleaseRecoverablePlatformPayablesForEmployee()`
- `employeeConnect.controller.ts`
  - Uses scheduler on status + payables endpoints

### Frontend (web)
- `employeePayoutActivityPresentation.ts` — `employeePayoutActivityDisplayAt()`
- `EmployeePayoutActivityList.tsx` — uses `activityAt` for dates
- `api.ts` — types updated

### Mobile
- `employeeInstantPayoutPresentation.ts` — `employeePayoutActivityDisplayAt()`
- `EmployeePayoutHistoryScreen.tsx` — failure dates
- `employeePayoutService.ts` — types updated

### Tests
- `backend/scripts/employee-transfer-failed-recovery-runtime.ts`
- `backend/package.json` — `test:employee-transfer-failed-recovery`

---

## 13. Files modified

| File |
|------|
| `backend/src/services/employeeTipPayable.service.ts` |
| `backend/src/services/employeeTipRelease.service.ts` |
| `backend/src/controllers/employeeConnect.controller.ts` |
| `backend/scripts/employee-transfer-failed-recovery-runtime.ts` |
| `backend/package.json` |
| `src/app/lib/api.ts` |
| `src/app/components/employee/employeePayoutActivityPresentation.ts` |
| `src/app/components/employee/EmployeePayoutActivityList.tsx` |
| `mobile/services/api/employeePayoutService.ts` |
| `mobile/features/employee/payouts/employeeInstantPayoutPresentation.ts` |
| `mobile/features/employee/payouts/EmployeePayoutHistoryScreen.tsx` |

---

## 14. Database changes

**None.** No schema migration.

---

## 15. Stripe changes

**None.** No live Stripe API calls during implementation.

---

## 16. Charline-specific manual recovery procedure

**Do NOT run automatically on deploy.** Ops-only, after verification:

### Pre-checks (read-only SQL)

```sql
SELECT id, status, payable_cents, transferred_cents, stripe_transfer_id,
       last_transfer_error, updated_at
FROM employee_tip_payables
WHERE id = 'cmudvx61o00smkm48a5ltlowv';

SELECT stripe_account_id, stripe_connect_status, stripe_payouts_enabled
FROM employee_stripe_accounts
WHERE employee_id = 'cmtlevnof003rjl47ncojnt7h';
```

Confirm:
- `status = transfer_failed`
- `transferred_cents = 0`
- `stripe_transfer_id IS NULL`
- `payable_cents = 5351`
- Connect `ready` + payouts enabled

### Stripe Dashboard (read-only)

1. Platform → Transfers — search metadata `caretip_payable_id: cmudvx61o00smkm48a5ltlowv` — **expect none**.
2. Connected account `acct_1UImFh66w9bX7ZFb` → verify **transfers** capability enabled.

### Recovery options (post-deploy)

**Option A — Product path (preferred):** Charline opens **Payout history → CareTip transfers** or **Connect status** after deploy. Fixed code schedules release automatically.

**Option B — Ops script:** Call `releaseHeldPlatformPayablesForEmployee('cmtlevnof003rjl47ncojnt7h')` once via controlled backend script in maintenance window.

### Post-recovery verification

- Payable `status = transferred`
- `stripe_transfer_id` starts with `tr_`
- `transferred_cents = 5351`
- Stripe Transfer exists with metadata `caretip_payable_id`

---

## 17. Automated tests added

`npm run test:employee-transfer-failed-recovery` (backend)

Covers:
- `transfer_failed` in `heldPlatformCents`
- Retry with idempotency key `emp_tip_release:{payableId}`
- No second transfer after success
- Activity timestamp for failures

---

## 18. Existing tests executed

| Test | Result |
|------|--------|
| `npm run test:employee-transfer-failed-recovery` | **PASS** |
| `npm run test:employee-tip-direct-routing` | **PASS** (42/42) |
| `npm run typecheck` (frontend) | **PASS** |

---

## 19. Regression verification

| Area | Touched? |
|------|----------|
| Authentication / JWT | **No** |
| AppLoadingManager / white-screen | **No** |
| Stripe billing / subscriptions | **No** |
| Destination-charge tips | **No** (logic unchanged) |
| Bank payout webhooks | **No** |

---

## 20. Remaining risks

1. **Capability vs ready mismatch** — CareTip may mark Connect `ready` before Stripe accepts `transfers.create`. Retry helps but may fail until Stripe capabilities align.
2. **Platform balance** — Not verified in Stripe Dashboard during audit.
3. **Stuck `transferring`** — Rare crash mid-flight; existing release loop handles `transferring` + null `stripeTransferId`.

---

## 21. Deployment requirements

1. Deploy backend + frontend + mobile together (API adds `activityAt` / `updatedAt`).
2. **Do not** auto-run Charline recovery on deploy.
3. After deploy, ops verifies pre-checks then has Charline open payout history OR runs one-shot release.

---

## 22. Rollback procedure

Revert commits touching files in §13. No migration to roll back. Charline payable remains `transfer_failed` (safe — no double pay).

---

## IMPLEMENTATION STATUS

| Item | Status |
|------|--------|
| Audit | **PASS** |
| Implementation | **PASS** |
| Charline recovery executed | **NO** |
| Real Stripe mutation performed | **NO** |
| Database mutation performed | **NO** (test fixtures only in isolated test script) |
| Duplicate-transfer protection | **PASS** |
| Tenant isolation | **PASS** (unchanged) |
| Authentication regression | **PASS** (not modified) |
| White-screen regression | **PASS** (not modified) |
| Loading/loader regression | **PASS** (not modified) |
| Existing Stripe billing regression | **PASS** (not modified) |
| Tests | **PASS** |
| Build | **PASS** (typecheck) |

**€53.51 has NOT been recovered.** Recovery requires intentional post-deploy ops action after capability verification.
