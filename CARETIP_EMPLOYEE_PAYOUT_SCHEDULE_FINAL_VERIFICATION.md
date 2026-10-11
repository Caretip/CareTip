# CareTip — Employee Payout Schedule — Final Pre-Deployment Verification

**Date:** 2026-09-28  
**Mode:** Read-only verification (no code or infrastructure changes)  
**Reference:** `CARETIP_EMPLOYEE_PAYOUT_SCHEDULE_AUDIT_AND_IMPLEMENTATION_REPORT.md`

---

## 1. Stripe account model (code + SDK)

| Check | Evidence | Result |
|-------|----------|--------|
| Employee bank payouts use `EmployeeStripeAccount.stripeAccountId` | `employeeBankPayoutSchedule.service.ts` reads/updates schedule via `employeeStripeAccount`; `employeeScheduledBankPayout.service.ts` calls `balance.retrieve` and `payouts.create` with `{ stripeAccount: stripeAccountId }` from that row | **Verified** |
| Same account as instant payout / bank history | `employeeStripeBankPayouts.service.ts`, `employeeInstantPayout.service.ts` resolve account via `employeeStripeAccount` | **Verified** |
| `accounts.update` `settings.payouts.schedule` | `connectBankPayoutSchedule.core.ts` uses `Stripe.AccountUpdateParams.Settings.Payouts.Schedule` (installed Stripe SDK typing) | **Verified** |
| Daily / weekly / monthly | `stripePayoutScheduleUpdateForPreference`: `daily`, `weekly` + `weekly_anchor: monday`, `monthly` + `monthly_anchor: 1` | **Verified** |
| Every 3 days + manual | Both map to `{ interval: "manual" }` (no fake `every_3_days` interval) | **Verified** |

**Note:** Employee accounts are Express **recipient** (`employeeStripeConnect.service.ts`, `stripe_transfers` capability). Payout schedule is applied to that connected account ID—the same object Stripe uses for employee `payouts.create` in scheduled and instant flows. This is not the business merchant `Business.stripeAccountId`.

---

## 2. Money-flow verification

| Path | Mechanism | Touched by schedule feature? |
|------|-----------|------------------------------|
| CareTip → employee Connect | `employeeTipRelease.service.ts` → `transfers.create` | **No** (no imports/references to employee schedule services) |
| Employee Connect → bank | `payouts.create` (standard scheduled / Stripe auto / instant) | **Yes** (schedule + scheduler only) |

Confirmed the new code does **not**:

- Replace or call `employeeTipRelease`
- Delay transfer release (no hooks in release path)
- Create transfers (only `payouts.create` in `employeeScheduledBankPayout.service.ts`, no `method: "instant"`)
- Use `Business.stripeAccountId` for employee payouts
- Modify `EmployeeTipPayable` calculations

---

## 3. Cron verification

| Item | Result |
|------|--------|
| Endpoint | `POST /api/internal/jobs/scheduled-bank-payout-tick` → `tickScheduledBankPayouts()` (`internalJobs.routes.ts`) |
| Business batch | `tickBusinessScheduledBankPayouts()` — unchanged selection rules |
| Employee batch | `tickEmployeeScheduledBankPayouts()` — `every_3_days`, due `bankPayoutNextScheduledAt`, active employee filters |
| Second cron required? | **No** — single tick returns aggregated counts plus `business` / `employee` objects |
| Duplicate employee per tick | `runSerializedByKey('scheduled-bank-payout:employee:{id}')` + ledger unique `(employeeId, scheduleWindowKey)` + unique `idempotencyKey` + Stripe idempotency key + P2002 reload (same pattern as business) |
| Loser concurrent worker | `ledgerCreated === false` + `pending` → `blocked` (no second `payouts.create`) |

---

## 4. Every 3 days — end-to-end trace

1. Employee selects **Every 3 days** → `PATCH /api/me/employee-connect/bank-payout-schedule`
2. `setEmployeeBankPayoutScheduleForUser` → DB `bankPayoutSchedule`, `bankPayoutNextScheduledAt` via `computeNextEvery3DaysPayoutAt` (employer `Business.timezone`, 09:00 local)
3. `syncStripeConnectAccountPayoutSchedule` → Stripe `interval: manual`
4. Render cron `scheduled-bank-payout-tick` → `tickEmployeeScheduledBankPayouts` finds due rows
5. `balance.available` only (not pending); min €1.00 standard threshold
6. `payouts.create` with `caretip_employee_scheduled_payout:{employeeId}:{windowIso}`
7. Ledger `employee_stripe_scheduled_payout_requests`; `persistEmployeePayoutFromStripeObject`
8. **Advance** `bankPayoutNextScheduledAt` on success or zero-balance skip / idempotent replay

**Failure behavior (code):**

| Case | Advance schedule? |
|------|-------------------|
| Stripe `payouts.create` failure | **No** — ledger `failed`, outcome `blocked` |
| Insufficient available (&lt; 100 cents) | **Yes** — `skipped_zero_balance`, no payout |
| Duplicate tick / replay submitted or zero | **Yes** — idempotent |
| Concurrent tick / P2002 on ledger insert | Handled — reload row; pending loser → `blocked` |
| Pending standard payout on account | **No** advance — `blocked` |

**Gap:** No dedicated DB integration test script for **employee** scheduled payout (business has `business-scheduled-bank-payout-runtime.ts`). Static contract covered by `employee-bank-payout-schedule-runtime.ts`.

---

## 5. Manual verification

| Requirement | Result |
|-------------|--------|
| No CareTip automatic standard payout | Scheduler filters `bankPayoutSchedule === every_3_days` only |
| Stripe automatic disabled for bank cadence | `manual` → `interval: "manual"` on employee Connect account |
| Instant / on-demand unchanged | `employeeInstantPayout.service.ts` separate; schedule UI hidden in business-distribution mode only |

---

## 6. Business regression

| Test | Result |
|------|--------|
| `npm run test:business-bank-payout-schedule` | **PASS** (asserts shared `connectBankPayoutSchedule.core.ts`) |
| `npm run test:business-scheduled-bank-payout` | **PASS** (business paths; uses `tickBusinessScheduledBankPayouts` for multi-business tick) |

Shared extraction did not change business schedule semantics; business still uses `syncStripeConnectAccountPayoutSchedule` via `businessBankPayoutSchedule.service.ts`.

---

## 7. Build results

| Command | Result | Notes |
|---------|--------|-------|
| `cd backend && npx tsc` | **PASS** | (run with payout tests in this session) |
| `cd backend && npm run build` | **FAIL** | `prisma generate` **EPERM** renaming `query_engine-windows.dll.node` — typical Windows lock when a local Node process (e.g. `npm run dev` / Vite) holds the Prisma engine. **Not a TypeScript defect.** `tsc` succeeds when generate is skipped. |
| `npm run build` (frontend) | **PASS** | Full Vite + prerender completed in this session |
| `npm run typecheck` | **PASS** |

**Recommendation before release build on Windows:** stop local dev servers using Prisma, then rerun `npm run build` in `backend/`. No unsafe workarounds applied.

---

## 8. Test results (executed)

| Command | Result |
|---------|--------|
| `cd backend && npx tsc` | **PASS** |
| `npm run test:business-bank-payout-schedule` | **PASS** |
| `npm run test:employee-bank-payout-schedule` | **PASS** |
| `npm run test:business-scheduled-bank-payout` | **PASS** |
| `npm run test:employee-transfer-failed-recovery` | **PASS** |
| `npm run test:employee-transfer-recovery-generalized` | **PASS** |
| `npm run typecheck` | **PASS** |
| `npm run build` (frontend) | **PASS** |

---

## 9. UI review (code)

| Check | Result |
|-------|--------|
| Schedule card on `EmployeePaymentsConnectPage` | `EmployeeBankPayoutScheduleCard` in payout rail |
| Hidden in business distribution | `{!businessDistribution ? <EmployeeBankPayoutScheduleCard /> : null}` |
| EN/DE | `employee.payouts.schedule.*` in `en.json` / `de.json` |
| Mobile web layout | Pill buttons `flex-col` → `sm:flex-row flex-wrap`, `min-w-0`, `PayoutWorkspacePanel` |
| Instant / account / history | Unchanged components still rendered |

**Mobile native app:** not updated (out of scope).

---

## 10. Remaining limitations

1. **Migration** `20260928193000_employee_bank_payout_schedule` must be applied in **staging/production** before employee tick queries new columns (local `db:migrate:deploy` was run in operator environment; not verified here against remote staging DB).
2. **No employee scheduled-payout DB integration test** equivalent to business scheduled runtime (recommended post-staging).
3. **Backend full `npm run build`** blocked locally by Prisma EPERM until dev processes stopped.
4. **Cron** must already be configured per `CARETIP_SCHEDULED_BANK_PAYOUT_CRON_SETUP.md` (no second job).
5. **Native mobile** schedule UI not implemented.

---

## Deployment prerequisites (staging)

1. Deploy backend + frontend artifacts that include employee schedule code.
2. Run migration `20260928193000_employee_bank_payout_schedule` on staging database.
3. Confirm `POST /api/internal/jobs/scheduled-bank-payout-tick` returns **401** without secret (not **404**) after deploy.
4. Ensure existing Render cron `caretip-scheduled-bank-payout-tick` is active (`*/5 * * * *`, `CRON_SECRET`, `x-cron-secret`).
5. Smoke: employee PATCH schedule → Stripe Dashboard shows expected payout interval on **employee** Connect account.
6. Optional: one staging employee on `every_3_days` with available balance — monitor single standard payout + ledger row.

---

# FINAL STATUS

## READY FOR STAGING

Subject to applying the employee migration in the target staging database and confirming the scheduled-bank-payout cron is live after backend deploy.
