# CareTip — Manual Payout Schedule Option Removal

**Status: READY — MANUAL REMOVED FROM USER EXPERIENCE**

**Date:** 2026-10-02

---

## 1. Where Manual was exposed in the UI

| Surface | Location | Before |
|--------|----------|--------|
| Business (manager) | `src/app/components/business/settings/billing/BusinessBankPayoutScheduleCard.tsx` | Five radio chips including `manual` |
| Employee | `src/app/components/employee/EmployeeBankPayoutScheduleCard.tsx` | Five radio chips including `manual` |
| EN/DE copy | `business.billing.payouts.schedule.options.manual`, `employee.payouts.schedule.options.manual` | Label "Manual" / "Manuell" |

**Not changed (intentional):** Platform Admin read-only context (`PlatformBusinessPayoutSchedulePanel.tsx`) still labels persisted `manual` for ops visibility (`admin.payoutSchedulePanel.scheduleManual`).

Mobile: no bank payout schedule UI found.

---

## 2. Where Manual exists internally

| Layer | Role |
|-------|------|
| Prisma `BusinessBankPayoutSchedule` enum | Includes `manual` for legacy DB rows |
| `connectBankPayoutSchedule.core.ts` | `stripePayoutScheduleUpdateForPreference()` returns `{ interval: "manual" }` for **every_3_days** and legacy application `manual` |
| `platformAdminPayoutSchedule.service.ts` | `executionLabel: manual_no_caretip_run` when `careTipSchedule === manual` |
| Stripe API | `settings.payouts.schedule.interval === "manual"` |

---

## 3. How Every 3 days depends on Stripe `manual`

Stripe has no native every-3-days interval. CareTip stores **`every_3_days`** on `Business` / `EmployeeStripeAccount`, sets Stripe to **`interval: manual`**, and runs **`POST /api/internal/jobs/scheduled-bank-payout-tick`** to create standard payouts when `bankPayoutNextScheduledAt` is due.

Mapping (unchanged):

| Application value | Stripe `settings.payouts.schedule` | CareTip scheduler |
|-------------------|-------------------------------------|-------------------|
| `daily` | `interval: daily` | No |
| `weekly` | `interval: weekly` (+ anchor) | No |
| `monthly` | `interval: monthly` (+ anchor) | No |
| `every_3_days` | `interval: manual` | Yes (`businessScheduledBankPayout` / `employeeScheduledBankPayout`) |
| `manual` (legacy) | `interval: manual` | No |

---

## 4. Changes made

- **`USER_SELECTABLE_BUSINESS_BANK_PAYOUT_SCHEDULE_VALUES`** (4 values) in `businessBankPayoutSchedule.service.ts`.
- **`parseBusinessBankPayoutSchedule()`** rejects `manual` with `BANK_PAYOUT_SCHEDULE_NOT_AVAILABLE` (PATCH only path).
- **`isCareTipControlledBankSchedule()`** now true **only** for `every_3_days` (legacy `manual` is not CareTip-scheduled).
- Shared **`src/app/lib/bankPayoutScheduleUserOptions.ts`** — single source for UI options.
- Business + Employee cards use four options; legacy `manual` shows **`legacyManualNotice`** (no fifth chip).
- Removed user-facing `options.manual` from EN/DE; kept admin panel strings.
- Runtime tests: `backend/scripts/bank-payout-schedule-manual-removal-runtime.ts`, `scripts/bank-payout-schedule-ui-runtime.ts`.

---

## 5. Business behavior

- UI: Daily, Every 3 days, Weekly, Monthly only.
- PATCH `/api/me/connect/bank-payout-schedule` cannot set `manual`.
- GET still returns `schedule: manual` if stored (legacy); user must pick a supported option.

---

## 6. Employee behavior

- Same four options via `EmployeeBankPayoutScheduleCard`.
- PATCH `/api/me/employee-connect/bank-payout-schedule` uses shared parser (rejects `manual`).

---

## 7. API behavior

- **Selectable:** `daily`, `every_3_days`, `weekly`, `monthly`.
- **Rejected on PATCH:** `manual` → 400 `BANK_PAYOUT_SCHEDULE_NOT_AVAILABLE`.
- **Read responses:** any enum value including legacy `manual`.

---

## 8. Scheduler behavior

Verified unchanged:

- `businessScheduledBankPayout.service.ts` / `employeeScheduledBankPayout.service.ts` filter `bankPayoutSchedule === every_3_days` only.
- Idempotency keys, P2002 handling, zero/insufficient balance skips, and +3-day advancement unchanged.
- Removing user-facing `manual` does not alter tick routing or cron.

---

## 9. Existing-data findings

- Enum `manual` exists in schema/migrations since `20260928180000_business_bank_payout_schedule`.
- **No production row counts** in this repo; cannot confirm live usage.
- **Strategy:** no DB migration. Legacy rows remain readable; users see notice and must select one of four schedules. PATCH to `manual` is blocked going forward.

---

## 10. Tests performed

| Command | Result |
|---------|--------|
| `npm --prefix backend run test:bank-payout-schedule-manual-removal` | **ok** |
| `npm --prefix backend run test:business-bank-payout-schedule` | **ok** |
| `npm --prefix backend run test:employee-bank-payout-schedule` | **ok** |
| `npm --prefix backend run test:business-scheduled-bank-payout` | **ok** (local run may hit live DB fixtures; scheduler logic unchanged) |
| `npm run test:bank-payout-schedule-ui` | **ok** |
| `npx tsc --noEmit` (backend + root) | run in CI / local when `tsc` on PATH |

---

## 11. Regression checks

- Stripe `manual` mapping for `every_3_days` preserved in `connectBankPayoutSchedule.core.ts`.
- Instant Payout, tip transfers, and automatic daily/weekly/monthly Stripe schedules not modified.
- Platform Admin payout context still distinguishes `manual_no_caretip_run` vs `caretip_scheduled`.

---

**READY — MANUAL REMOVED FROM USER EXPERIENCE**
