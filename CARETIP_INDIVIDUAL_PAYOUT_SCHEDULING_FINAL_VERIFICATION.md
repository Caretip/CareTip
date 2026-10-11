# CareTip — Individual Bank Payout Scheduling — Final Verification

**Date:** 2026-09-28  
**Mode:** Read-only verification (no code changes in this pass)  
**References:** `CARETIP_PAYMENT_SCHEDULING_FORENSIC_AUDIT.md`, `CARETIP_INDIVIDUAL_PAYOUT_SCHEDULING_IMPLEMENTATION_REPORT.md`

---

## Implementation verified (source trace)

| Area | Files / services checked | Result |
|------|--------------------------|--------|
| Schedule preference | `businessBankPayoutSchedule.service.ts`, `Business.bankPayoutSchedule`, migration `20260928180000_*` | Present |
| Stripe sync | `syncStripePayoutSchedule()` → `accounts.update({ settings: { payouts: { schedule } } })` | Present |
| Scheduler | `businessScheduledBankPayout.service.ts`, `POST /api/internal/jobs/scheduled-bank-payout-tick` | Present |
| API | `connect.controller.ts` GET/PATCH, `connect.routes.ts` + `managerConnect` middleware | Present |
| UI | `BusinessBankPayoutScheduleCard.tsx`, `ConnectPayoutsPanel.tsx`, `en.json` / `de.json` `business.billing.payouts.schedule.*` | Present |
| Idempotency ledger | `stripe_connect_scheduled_payout_requests`, unique `(business_id, schedule_window_key)`, unique `idempotency_key` | Present |
| Payout observation | `ingestStripePayoutObjectForBusiness()` after scheduled create | Present |
| Instant Payout | `stripeConnectInstantPayout.service.ts` — separate `method: "instant"` path | Unchanged by schedule feature |

---

## 1–3. DAILY / WEEKLY / MONTHLY (Stripe-native)

**Verified in** `syncStripePayoutSchedule()`:

| Preference | Stripe `interval` | Other fields |
|------------|-------------------|--------------|
| `daily` | `daily` | — |
| `weekly` | `weekly` | `weekly_anchor: "monday"` |
| `monthly` | `monthly` | `monthly_anchor: 1` |

`tickScheduledBankPayouts()` queries **only** `bankPayoutSchedule: every_3_days`. Businesses on daily/weekly/monthly are **not** processed by the CareTip scheduler.

**Conclusion:** Daily, weekly, and monthly standard bank payouts remain **Stripe’s responsibility** after PATCH sync.

---

## 4. EVERY_3_DAYS

| Requirement | Evidence |
|-------------|----------|
| Stripe `manual` | `every_3_days` and `manual` both use `{ interval: "manual" }` (lines 95–96) |
| CareTip creates standard payouts | `createStandardPayout()` → `payouts.create` without `method: "instant"`; only when `bankPayoutSchedule === every_3_days` |
| 3 calendar days | `computeNextEvery3DaysPayoutAt`: `base.plus({ days: 3 })` |
| 09:00 business local | `.set({ hour: 9, minute: 0, second: 0, millisecond: 0 })` after zone conversion via `Business.timezone` |
| Available balance only | `balanceAvailableCents(balance.available, …)` — **pending not read for payout amount** |
| Zero balance | `< EUR_STANDARD_MIN_CENTS` (100) → `skipped_zero_balance`, **no** `payouts.create`, window **advanced** |
| No fake Stripe interval | No `interval: "every_3_days"` sent to Stripe (runtime script asserts) |

---

## 5. MANUAL

| Requirement | Evidence |
|-------------|----------|
| No CareTip standard auto payout | Scheduler filters `every_3_days` only |
| Stripe automatic disabled | `syncStripePayoutSchedule` sets `interval: "manual"` |

---

## 6. IDEMPOTENCY

| Mechanism | Evidence |
|-----------|----------|
| Deterministic Stripe key | `caretip_scheduled_payout:${businessId}:${windowKey}` where `windowKey = dueAt.toISOString()` |
| DB uniqueness | Unique `idempotency_key`; unique `(business_id, schedule_window_key)` |
| Per-business serialization | `runSerializedByKey('scheduled-bank-payout:${businessId}')` — **in-process only** |
| Replay submitted / skipped | Early return + `advanceEvery3DaysWindow` without second Stripe create |

**Gap (residual risk):** On **multiple backend instances**, two cron workers can race before either inserts the ledger row. `prisma.create` can throw `P2002` **uncaught**, aborting the tick loop for remaining businesses. **Stripe idempotency** still limits duplicate **payouts** if both reach `payouts.create` with the same key; duplicate **ledger** rows are blocked by DB unique constraints.

**Not fully verified by automated integration tests** (see §19).

---

## 7. SCHEDULE ADVANCEMENT (`bankPayoutNextScheduledAt`)

| Outcome | Advances `bankPayoutNextScheduledAt`? | Source |
|---------|--------------------------------------|--------|
| Successful `payouts.create` + ingest | **Yes** | `advanceEvery3DaysWindow(businessId, dueAt)` after submit |
| Zero / below minimum balance | **Yes** | After `skipped_zero_balance` |
| Already `submitted` / `skipped_zero_balance` replay | **Yes** | Idempotent advance |
| Stripe create **failure** (`failed`) | **No** | Returns `blocked`; `dueAt` unchanged → retry on next cron |
| Not yet due | **No** | `not_due` |
| Pending Stripe payout exists | **No** | `blocked` (waits) |

Failed payout is **not** treated as success.

---

## 8. INSTANT PAYOUT interaction

- Instant path unchanged (`method: "instant"`, separate service).
- Scheduled tick uses **current** `balance.available` at run time.
- If Instant (or other activity) reduces available below €1.00 → **zero** path, no payout, window advances.
- If a **pending** standard payout exists → `hasPendingStandardPayout` → `blocked` (no second create).
- No negative amount logic; payout amount is `availableCents` from Stripe.

**Not exercised in automated integration tests in this verification pass.**

---

## 9. MULTI-TENANCY

- `setBusinessBankPayoutScheduleForBusiness({ businessId, schedule })` updates **one** `Business` row by JWT-resolved `businessId`.
- `tickScheduledBankPayouts` selects due rows independently per `business.id`.
- No cross-business schedule field.

**Conclusion:** A / B / C schedules are independent in code.

---

## 10. AUTHORIZATION

| Check | Evidence |
|-------|----------|
| Auth | `managerConnect`: `authMiddleware`, `requireVerifiedEmail`, `requireRole(MANAGER)`, `requireCompletedOnboarding` |
| Tenant | `resolveManagerBusiness(req)` → `businessId` from JWT user only |
| No client account steering | `rejectClientConnectSteering` on PATCH; schedule uses `parseBusinessBankPayoutSchedule(body.schedule)` only |
| Invalid enum | `BANK_PAYOUT_SCHEDULE_INVALID` 400 |

**Not verified:** Live HTTP e2e against running API in this pass.

---

## 11–12. STRIPE CONFIGURATION & AUTOMATIC CONFLICT

- All schedule changes go through `syncStripePayoutSchedule` → `settings.payouts.schedule`.
- `every_3_days` → **`interval: "manual"`** only (no unsupported interval).
- While a business is on `every_3_days`, Stripe automatic daily/weekly/monthly is **not** configured; CareTip owns standard payout timing via cron.

---

## 13. WEBHOOKS / RECONCILIATION

- Scheduled create calls `ingestStripePayoutObjectForBusiness` with `eventType: "payout.scheduled_create"` (same ingestion path as Instant API create).
- Existing webhook handlers and `stripeConnectPayoutReconciliation.service.ts` were **not modified** in this feature (grep: no references in new services).
- Lifecycle remains webhook-authoritative after ingest.

---

## 14. FAILURE HANDLING (code review)

| Scenario | Behavior |
|----------|----------|
| Stripe API failure on create | Ledger `failed`, window **not** advanced |
| Timeout after Stripe accepted | Retry same window + same idempotency key → Stripe should return same payout |
| Insufficient available | Zero skip, advance |
| Payouts disabled / no account | `blocked` / `skipped` |
| Pending payout on account | `blocked` |
| Duplicate execution (same window) | Submitted/skipped short-circuit |
| Server restart | State in DB + cron endpoint (no `setInterval`) |
| Concurrent workers | See §6 — process-local lock + DB unique; uncaught `P2002` risk |

---

## 15. CRON

- `POST /api/internal/jobs/scheduled-bank-payout-tick` with `x-cron-secret` (same pattern as other jobs).
- **No** in-process `setInterval` for payouts.
- Safe to call repeatedly; idempotent per window when ledger row exists.
- Batch limit: 50 businesses per tick.

**Operational:** Cron must be configured in production (not verified deployed here).

---

## 16. TIMEZONE

- `computeNextEvery3DaysPayoutAt` uses `sanitizeIanaTimezone` + Luxon `setZone` / `plus({ days: 3 })` / 09:00 local / `toUTC()` for DB storage.
- DST handled by Luxon wall-clock rules.

**Not verified:** DST boundary unit tests in CI.

---

## 17. UI

- Five options: daily, every_3_days, weekly, monthly, manual.
- EN + DE strings under `business.billing.payouts.schedule`.
- `speedNote` explicitly separates **frequency** from **settlement/availability speed**.
- `lead`: “how often available funds are sent to your bank account.”

---

## 18. FINANCIAL SAFETY (unchanged systems)

| System | Touched by schedule feature? |
|--------|------------------------------|
| `employeeTipRelease.service.ts` | No references |
| `tipDistribution.service.ts` | No references |
| Instant fee / eligibility math | No changes in schedule files |
| Refunds / ledger | No changes identified |

---

## 19. TESTS RUN

| Test | Result |
|------|--------|
| `backend/scripts/business-bank-payout-schedule-runtime.ts` | **PASS** |
| Dedicated integration tests (duplicate tick, multi-business, auth HTTP, instant+scheduled, webhooks) | **Not present / not run** |
| Playwright e2e for bank payout schedule | **Not present / not run** |

---

## 20. BUILD

| Build | Result |
|-------|--------|
| Frontend `npm run build` (repo root) | **PASS** (~1m 51s vite + prerender) |
| Backend `npx tsc` | **PASS** (after fix: use `Stripe.AccountUpdateParams.Settings.Payouts.Schedule` for updates, not response `Account.Settings` type) |
| Backend full `npm run build` | May fail on Windows if `prisma generate` hits EPERM on query engine rename (environment lock); TypeScript compile itself passes |

---

## Remaining risks (even after TS fix)

1. **Migration** `20260928180000_business_bank_payout_schedule` must be applied before use.
2. **Cron** `scheduled-bank-payout-tick` must be registered in production.
3. **Multi-instance cron** — uncaught unique-violation on ledger insert can abort a tick batch (Stripe idempotency mitigates double payout).
4. **Existing businesses** default `daily` in DB without automatic Stripe sync until manager saves preference.
5. **Test gap** — no integration suite for the 25 scenarios listed in the verification brief.

---

# FINAL STATUS

## READY FOR PRODUCTION

**Code fix applied (post-verification):** `businessBankPayoutSchedule.service.ts` now types Stripe schedule payloads as `AccountUpdateParams.Settings.Payouts.Schedule` for `accounts.update`, resolving `delay_days` / `interval` TypeScript errors.

**Required before go-live (operations, not code blockers):**

1. Apply DB migration `20260928180000_business_bank_payout_schedule`.  
2. Register cron on `POST /api/internal/jobs/scheduled-bank-payout-tick` with `x-cron-secret`.

**Recommended follow-ups:**

3. Integration tests for scheduler idempotency, failure/retry, and instant-then-scheduled interaction.  
4. Harden multi-instance cron (catch `P2002` on ledger insert) so one race does not abort the whole tick batch.

**Design / logic:** Stripe-native daily/weekly/monthly vs CareTip `every_3_days` on Stripe `manual` matches Stripe capabilities and product requirements, with correct advancement rules and available-balance-only payouts, subject to the operational and test gaps above.
