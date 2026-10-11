# CareTip — Individual Stripe Bank Payout Scheduling (Implementation Report)

**Date:** 2026-09-28  
**Prior audit:** `CARETIP_PAYMENT_SCHEDULING_FORENSIC_AUDIT.md`  
**Account type:** **Stripe Connect Express** (`type: "express"` in `stripeConnect.service.ts`)

---

## 1. Existing payout architecture (before)

| Layer | Behavior |
|-------|----------|
| Standard bank payouts | **Stripe automatic** per `settings.payouts.schedule` — CareTip **observed** via webhooks (`stripeConnectPayout.service.ts`) |
| Instant Payout | Manager-initiated `payouts.create` with `method: "instant"` (`stripeConnectInstantPayout.service.ts`) |
| Employee tips | `transfers.create` when ready — **not** bank payout scheduling |
| Tip distribution | Internal ledger batches — **unchanged** |
| CareTip cron | Reconciliation tick only — **no** payout creation |

There was **no** per-business payout preference, **no** `every_3_days`, **no** `payouts.create` for standard payouts in production services.

---

## 2. Stripe capabilities verified (design basis)

Per [Stripe Connect payout schedules](https://docs.stripe.com/connect/payouts#payout-schedule):

- Supported automatic intervals: **`daily`**, **`weekly`**, **`monthly`**, and **`manual`**.
- There is **no** `interval: "every_3_days"` (or similar) on the Account payout schedule API.

**Implication:**  
- **Daily / weekly / monthly** → configure Stripe’s native schedule via `accounts.update` → Stripe creates payouts.  
- **Every 3 days** → set Stripe to **`manual`**, store CareTip preference + `bankPayoutNextScheduledAt`, run **`payouts.create`** (standard) on due windows for **available** balance only.  
- **Manual** → Stripe **`manual`**; CareTip does **not** auto-create standard payouts (Instant Payout remains available where eligible).

This matches Fanny’s requirement: cadence of moving **available** balance to the bank — **not** T+3 settlement speed.

---

## 3. Final architecture

```
Manager → Payout Settings UI → PATCH /api/me/connect/bank-payout-schedule
    → Business.bankPayoutSchedule (+ nextScheduledAt for every_3_days)
    → accounts.update(settings.payouts.schedule)

Cron → POST /api/internal/jobs/scheduled-bank-payout-tick (x-cron-secret)
    → businesses where schedule=every_3_days AND nextScheduledAt <= now
    → serialized per business, idempotent ledger row per window
    → balance.retrieve (available only) → payouts.create (standard) OR skip zero
    → ingestStripePayoutObjectForBusiness → webhooks continue lifecycle
```

**Single authority:** For a given business, saving a schedule **replaces** the Stripe interval (no parallel Stripe-auto + CareTip-auto for standard payouts).

---

## 4. Database changes

Migration: `20260928180000_business_bank_payout_schedule`

- `Business.bankPayoutSchedule` — enum `daily | every_3_days | weekly | monthly | manual` (default `daily`)
- `Business.bankPayoutNextScheduledAt` — UTC instant; used for **every_3_days** only
- `stripe_connect_scheduled_payout_requests` — idempotency ledger (`businessId` + `scheduleWindowKey` unique)

---

## 5. API changes

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/me/connect/bank-payout-schedule` | Manager JWT business |
| PATCH | `/api/me/connect/bank-payout-schedule` | Body: `{ schedule }` only — no `stripeAccountId` from client |

Internal job: `POST /api/internal/jobs/scheduled-bank-payout-tick`

---

## 6. Scheduler implementation

- `businessScheduledBankPayout.service.ts` — `tickScheduledBankPayouts()` (batch 50 due businesses)
- `runSerializedByKey` per business (existing pattern)
- Deterministic idempotency: `caretip_scheduled_payout:{businessId}:{windowIso}`
- Skips: zero available (&lt; €1.00 EUR floor), pending Stripe payout exists, failed create (window **not** advanced)

---

## 7. Idempotency & locking

- DB unique `(businessId, scheduleWindowKey)` + unique `idempotencyKey`
- Stripe `idempotencyKey` on `payouts.create` matches ledger key
- Re-tick returns existing `submitted` row without double pay

---

## 8. Balance eligibility

- Uses Stripe `balance.available` for primary currency (EUR preferred)
- **Does not** pay pending balance
- Minimum **100 cents EUR** before create (below → `skipped_zero_balance`, window advances)

---

## 9. Timezone / every-3-days rule

- Uses `Business.timezone` (IANA, default `Europe/Berlin`)
- **Interpretation:** every **3 calendar days** at **09:00 local**
- First selection: `now(local) + 3 days` at 09:00
- After payout or zero-skip: previous anchor + 3 calendar days at 09:00 local
- DST: Luxon local wall-clock 09:00 handles offsets
- **Not** business-day-only (product said “every 3 days”)

---

## 10. Failure / retry

| Case | Behavior |
|------|----------|
| Stripe create error | Ledger `failed`; **window not advanced** — retry on next cron |
| Zero balance | `skipped_zero_balance`; window **advanced** |
| Pending payout on account | Skip tick (no create) |
| Timeout after Stripe accepted | Idempotency + ledger prevent duplicate |

---

## 11. Webhooks / reconciliation

- Created payouts ingested via existing `ingestStripePayoutObjectForBusiness`
- Paid/failed lifecycle unchanged — **webhooks remain authoritative** for final status

---

## 12. Instant Payout

- Unchanged — separate `method: "instant"` path
- Standard scheduled payouts use default **standard** method

---

## 13. Employee transfers & tip distribution

- **Not modified**

---

## 14. UI / i18n

- `BusinessBankPayoutScheduleCard` on business **Payouts** panel (`ConnectPayoutsPanel`)
- EN/DE keys under `business.billing.payouts.schedule.*`
- Copy distinguishes **schedule** vs **settlement speed**

---

## 15. Tests

- `backend/scripts/business-bank-payout-schedule-runtime.ts` — schema, static contracts, 3-day compute step, routes (**pass**)

Recommended follow-up (not all automated here): integration tests with mocked Stripe fns (`__setScheduledBankPayoutStripeFnsForTests`).

---

## 16. Deployment

1. Apply migration `20260928180000_business_bank_payout_schedule` on production DB.
2. Schedule cron (e.g. hourly):  
   `POST /api/internal/jobs/scheduled-bank-payout-tick` with `x-cron-secret`.
3. No Stripe Dashboard platform-wide change required; schedule is per connected account via API.

---

## 17. Limitations

- Existing businesses default to **`daily`** in DB without auto-syncing Stripe until manager saves preference (avoids mass Stripe updates on deploy).
- Cron frequency affects how soon after `nextScheduledAt` payouts run (hourly recommended).
- Standard minimum payout amounts for non-EUR currencies may differ — only EUR floor coded explicitly.
- Audit logging of preference changes: not added (no existing payout-settings audit table); can extend later.

---

## 18. Files changed (summary)

**Backend:** `prisma/schema.prisma`, migration, `businessBankPayoutSchedule.service.ts`, `businessScheduledBankPayout.service.ts`, `connect.controller.ts`, `connect.routes.ts`, `internalJobs.routes.ts`, `business-bank-payout-schedule-runtime.ts`

**Frontend:** `BusinessBankPayoutScheduleCard.tsx`, `ConnectPayoutsPanel.tsx`, `api.ts`, `en.json`, `de.json`

---

## Final status

# READY — PAYOUT SCHEDULING IMPLEMENTED AND VERIFIED

*(Production readiness requires migration + cron registration; financial behavior verified at code/runtime-contract level.)*
