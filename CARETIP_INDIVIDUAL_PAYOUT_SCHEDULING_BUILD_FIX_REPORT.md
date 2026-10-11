# CareTip — Individual Payout Scheduling — Build Fix & Scheduler Hardening Report

**Date:** 2026-09-28  
**Reference:** `CARETIP_INDIVIDUAL_PAYOUT_SCHEDULING_FINAL_VERIFICATION.md`

---

## Task 1 — Backend TypeScript build

**Issue:** `businessBankPayoutSchedule.service.ts` used `Stripe.Account.Settings.Payouts.Schedule` (response type with required `delay_days`) for `accounts.update`.

**Fix:** Introduced `StripePayoutScheduleUpdate = Stripe.AccountUpdateParams.Settings.Payouts.Schedule` for `syncStripePayoutSchedule` and the test hook.

**Result:** `npm run build` (backend) — **PASS**  
**Result:** `npx tsc --noEmit` (backend) — **PASS**

---

## Task 2 — Multi-instance P2002 hardening

**File:** `backend/src/services/businessScheduledBankPayout.service.ts`

| Change | Purpose |
|--------|---------|
| `createScheduledPayoutLedgerRowOrGetExisting` | On `P2002`, reload by `(businessId, scheduleWindowKey)` or `idempotencyKey` with short retries |
| `ledgerCreated === false` + `pending` | Return `blocked` — loser does not call Stripe |
| Post-create status checks | `submitted` / `skipped_zero_balance` / `failed` handled before Stripe |
| `tickScheduledBankPayouts` per-business `try/catch` | Unexpected errors log + increment `blocked`; batch continues |
| `scheduledBankPayoutStripeIdempotencyKey()` | Exported deterministic key helper (unchanged format) |

**Preserved:** DB unique constraints, Stripe idempotency key, advancement rules, product cadence.

---

## Task 3 — Tests

| Command | Result |
|---------|--------|
| `npm run test:business-bank-payout-schedule` | **PASS** |
| `npm run test:business-scheduled-bank-payout` | **PASS** (DB-backed) |

`business-scheduled-bank-payout-runtime.ts` covers:

1. P2002 concurrent ledger insert → single row, one creator  
2. Concurrent `runScheduledBankPayoutForBusiness` → one Stripe create  
3. Success → schedule advanced  
4. Zero balance → no Stripe, `skipped_zero_balance`  
5. Failed Stripe create → `failed` ledger, window not advanced  
6. `tickScheduledBankPayouts` → multiple businesses processed  
7. Static idempotency key contract  

---

## Task 4 — Cron documentation

**Updated:** `CARETIP_SCHEDULED_BANK_PAYOUT_CRON_SETUP.md`  
**Blueprint:** `render.yaml` → `caretip-scheduled-bank-payout-tick` (`*/5 * * * *`, Render Cron → POST API with `x-cron-secret`).

**Not created:** Production cron job (operator action after deploy).

**Note:** Production API returned **404** for this route until the backend containing `scheduled-bank-payout-tick` is deployed; after deploy expect **401** without secret.

---

## Task 5 — Verification runs

| Check | Result |
|-------|--------|
| Backend `npm run build` | **PASS** |
| Frontend `npm run build` | **PASS** |
| `test:business-bank-payout-schedule` | **PASS** |
| `test:business-scheduled-bank-payout` | **PASS** |
| Backend `npx tsc --noEmit` | **PASS** |

### Git scope (this remediation)

**Modified for blocker/hardening/tests/docs:**

- `backend/src/services/businessBankPayoutSchedule.service.ts`
- `backend/src/services/businessScheduledBankPayout.service.ts`
- `backend/scripts/business-scheduled-bank-payout-runtime.ts`
- `backend/scripts/business-bank-payout-schedule-runtime.ts`
- `backend/package.json` (test scripts)
- `render.yaml` (cron blueprint)
- `CARETIP_SCHEDULED_BANK_PAYOUT_CRON_SETUP.md`
- `CARETIP_INDIVIDUAL_PAYOUT_SCHEDULING_BUILD_FIX_REPORT.md`

**Not modified in this pass:** tip distribution, employee transfers, refunds, instant payout fee logic, ledger calculations.

---

## Remaining operational steps (not code)

1. Deploy backend to Render (route live, 401 without cron secret).  
2. Create Render Cron `caretip-scheduled-bank-payout-tick` per `CARETIP_SCHEDULED_BANK_PAYOUT_CRON_SETUP.md`.  
3. Align `CRON_SECRET` on web + cron services.  
4. Monitor first `every_3_days` payout in Stripe + CareTip payout history.

---

# FINAL STATUS

## READY FOR CRON SETUP
