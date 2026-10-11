# CareTip payment / payout scheduling forensic audit

**Scope:** Determine what “payment scheduling at an interval of 3 days” could mean in the current codebase, and whether any **3-day interval logic** already exists.  
**Phase:** Read-only — no code or Stripe setting changes.  
**Date:** 2026-03-28.

---

## Executive summary

| Question | Finding |
|----------|---------|
| Is there a **CareTip job that pays out every 3 days**? | **No** — no cron, scheduler, or service implements a 3-day payout interval. |
| Is there **3-day logic** anywhere payment-related? | **No** — the only “3 days” in backend product code is **trial reminder email** copy (`trialReminderEmail.service.ts`). |
| Who creates **bank payouts** to connected accounts? | **Stripe** (automatic payouts per connected-account settings), except **user-initiated Instant Payout** (`stripe.payouts.create` with `method: instant`) for eligible business/employee accounts. |
| Who creates **employee tip transfers**? | **CareTip** via `stripe.transfers.create` in `employeeTipRelease.service.ts` — **event-driven** (Connect ready, status polls, payout-history loads), **not** on a calendar interval. |
| Who schedules **internal tip distribution** (business_distribution)? | **Business users manually** via Tip Distribution batches (`tipDistribution.service.ts`) — off-platform ledger, not Stripe bank payouts. |

**Classification for Fanny’s requirement:** **F — No 3-day scheduling implementation in code.**  
If the requirement is “money hits the bank every 3 days,” that today is almost certainly **Stripe settlement + Stripe payout schedule** (categories 1–2), not an implemented CareTip scheduler (category 3).

**Do not conflate:** Stripe **T+N settlement** (funds becoming *available*) with CareTip **initiating payouts every 3 days** — different mechanisms.

---

## 1. What “3-day payment scheduling” could mean in this architecture

| Interpretation | Technical meaning in CareTip | Currently in code? |
|----------------|------------------------------|-------------------|
| **A. Settlement timing** | Charge → balance `available_on` / pending → available (Stripe rules, often quoted as ~2–3 **business** days in EU) | **Observed** via Stripe Balance API + UI copy (`pendingSettlement`, `settledBody`); **not** configured by CareTip interval constants |
| **B. Stripe payout schedule** | Connected account `settings.payouts.schedule` (`interval`, `delay_days`) — daily/weekly/monthly/manual + delay | **Read in scripts only** (e.g. `e2e-euro90-identify-readonly.ts` logs `interval` / `delay_days`); **not** set by `backend/src` production services |
| **C. CareTip-initiated bank payouts on a 3-day cadence** | Cron/worker calling `stripe.payouts.create` on a schedule for each account | **Not implemented** (except on-demand **Instant** create) |
| **D. Employee tip **transfer** scheduling** | Hold payables then `transfers.create` every N days | **Hold exists** (`platform_hold`); **release is immediate when ready**, not every 3 days |
| **E. Internal tip distribution schedule** | Manager runs distribution batches when they choose | **Manual** batches; marketing copy says “on your schedule” — no 3-day automation |
| **F. Background job every N days** | Cron hitting `/api/internal/jobs/*` | **Jobs exist** (45-day inactivity, reconciliation tick, etc.) — **none** pay out on a 3-day rhythm |

**Clarification needed from Fanny:** Which row (A–F) matches the business/legal intent?

---

## 2. What Stripe currently controls

1. **Settlement** — when card/charge funds move from pending to available on the connected account balance (`balance_transaction.available_on`).
2. **Automatic payouts** — Stripe creates `payout.*` events when the account’s **payout schedule** triggers and balance is payable; CareTip **observes** these via webhooks and DB sync (`stripeConnectPayout.service.ts`).
3. **Payout method** — standard vs instant (Instant requires eligible debit card and `payouts.create` with `method: instant`).
4. **Express/Connect account capabilities** — `payouts_enabled`, requirements, country.

E2E scripts explicitly document waiting for **Stripe automatic payout** (not CareTip):

```text
waiting_for=Stripe automatic payout on schedule=... delay_days=... after available balance becomes payable
```

(`backend/scripts/e2e-euro90-controlled-lifecycle.ts`)

---

## 3. What CareTip currently controls

| Layer | Behavior |
|-------|----------|
| **Tip routing** | Direct-to-employee vs business_distribution (`employeeTipRouting.service.ts`) |
| **Platform hold + transfer** | Tips held as `platform_hold` until employee Connect is recipient-ready; then `transfers.create` (`employeeTipRelease.service.ts`) |
| **Instant Payout (business)** | User-triggered `payouts.create` (`stripeConnectInstantPayout.service.ts`) |
| **Instant Payout (employee)** | User-triggered via `employeeInstantPayout.service.ts` (reuses connected-account create pattern) |
| **Tip distribution ledger** | Manager-posted batches for `business_distribution` — **not** Stripe bank movement (`tipDistribution.service.ts`) |
| **Payout observation** | Webhooks `payout.created|updated|paid|failed|canceled|reconciliation_completed` → `handleConnectPayoutEvent` |
| **Reconciliation jobs** | `connect-payout-reconciliation-tick` — **sync balance lines only**, does not create payouts |
| **Employee inactivity** | **45-day** rule (`EMPLOYEE_STRIPE_INACTIVITY_DAYS`) — pauses CareTip QR receiving, **does not disconnect Stripe** |

Header comment in `stripeConnectPayout.service.ts`:

> **Observation only. CareTip does not initiate Stripe payouts.**

(Exception: **Instant Payout** services intentionally call `payouts.create`.)

---

## 4. Does a 3-day interval exist anywhere?

**Payment/payout scheduling:** **No.**

Searched patterns include: `3 days`, `3-day`, `every 3 days`, `72 hours` (payment context), `delay_days`, `payout schedule`, `payouts.create`, `transfers.create`, cron schedulers, Bull/BullMQ, node-cron.

**Unrelated “3 days”:**

- `trialReminderEmail.service.ts` — “trial ends in 3 days”
- Physical QR delivery copy — “24–72 hours after shipment”
- Internal job comment — trial reminders at **7 / 3 / 1** days before trial end (`internalJobs.routes.ts`)

**Related but not 3-day:**

- **45-day** employee tip inactivity (`employeeStripeInactivity.service.ts`, `EMPLOYEE_STRIPE_INACTIVITY_DAYS = 45`)
- **12s** bootstrap refresh timeout (auth, not payouts)

---

## 5. Would a true “pay every 3 days” requirement need a backend scheduler?

**Yes**, if the requirement is **category C** (CareTip must **initiate** bank payouts on a fixed cadence):

- Today there is **no** production job that calls `stripe.payouts.create` on a timer (except user Instant requests).
- You would need: eligibility rules, per-account balance checks, idempotency, manual vs automatic payout mode handling, legal/compliance review, and likely **manual payout schedule** on Connect accounts (otherwise Stripe might also auto-pay).

If the requirement is **category A or B**, implementation is **Stripe Dashboard / Connect account settings / platform onboarding defaults** — not necessarily a new CareTip cron (but CareTip might need to **document** or **display** schedule in UI).

If the requirement is **category D** with a 3-day hold before `transfers.create`, that would be **new business logic** in `employeeTipPayable` / `employeeTipRelease` (today: release when ready, not after N days).

---

## 6. Stripe APIs involved (by scenario)

| Scenario | Primary Stripe APIs | CareTip usage today |
|----------|---------------------|---------------------|
| Guest tips → business/employee | `PaymentIntents`, `Charges`, Connect destination charges / application fees | `stripe.service.ts`, tip webhooks |
| Employee transfer after hold | `transfers.create`, `transfers.createReversal` | `employeeTipRelease.service.ts` |
| Bank payout (standard) | Stripe **automatic** `Payout` objects | **Observe** only — `payouts.list`, webhooks |
| Bank payout (instant) | `payouts.create` (`method: instant`) | `stripeConnectInstantPayout.service.ts`, `employeeInstantPayout.service.ts` |
| Settlement visibility | `balance.retrieve`, `balance_transaction` on charges/payouts | Instant eligibility, payout reconciliation |
| Change payout frequency | `accounts.update` / Connect settings (`settings.payouts.schedule`) | **Not found** in `backend/src` production code |

---

## 7. Business payouts vs employee transfers vs internal distribution

| Flow | Who gets money | CareTip “scheduling” |
|------|----------------|----------------------|
| **Business Connect balance → bank** | Business (hotel/restaurant) | **Stripe payout schedule** + optional **Instant** button |
| **Employee Connect balance → bank** | Employee | **Stripe payout schedule** + optional **employee Instant** |
| **Platform hold → employee Connect** | Employee (Stripe transfer) | **Immediate on readiness** (`scheduleReleaseRecoverablePlatformPayablesForEmployee`) |
| **business_distribution tips** | Employees (off-platform) | **Manual** Tip Distribution batches in dashboard |
| **destination_business / direct routing** | Varies by `EmployeeTipPayoutMode` | Charge model + routing at payment time |

UI explicitly separates CareTip ledger from Stripe wallet (`notStripeBalance`, `stripeSchedule`: “Stripe pays out to your bank on its schedule”).

---

## 8. Existing implementations that could conflict with a new 3-day scheduler

1. **Stripe automatic payouts** — If accounts stay on automatic schedule, a CareTip cron that also calls `payouts.create` could **double-pay** or fight Stripe’s schedule unless accounts are switched to **manual** payouts.
2. **Instant Payout path** — Already drains available balance on demand; policy must define interaction with periodic payouts.
3. **Observation-only payout pipeline** — `handleConnectPayoutEvent` assumes payouts originate from Stripe or Instant API create; a batch scheduler must emit consistent metadata and reconciliation states.
4. **Employee `transfers.create` on connect** — Not interval-based; adding a 3-day **transfer** delay would change UX for “held until setup” vs “held for payroll cycle.”
5. **`connect-payout-reconciliation-tick`** — Safe (read/sync); no conflict except load.

---

## 9. End-to-end trace (primary flows)

### 9.1 Business bank payout (standard)

```
UI: ConnectPayoutsPanel / payout history
  → GET /api/connect/payouts, /connect/payouts/summary
  → connect.controller.ts
  → stripeConnectPayout.service.ts (list/sync from Stripe)
  → Stripe: payouts.list (connected account)
  → Webhook: payout.* → handleConnectPayoutEvent
  → DB: StripeConnectPayout, balance lines (reconciliation)
  → UI: status, arrival_date, pending vs available hints
```

**No CareTip step creates scheduled standard payouts.**

### 9.2 Business Instant Payout

```
UI: Instant Payout CTA
  → POST /api/connect/instant-payout
  → stripeConnectInstantPayout.service.ts
  → stripe.payouts.create({ method: "instant" }, { stripeAccount })
  → persist payout row + webhook updates
```

### 9.3 Employee transfer (tip to Connect balance)

```
Tip success → EmployeeTipPayable (platform_hold if not ready)
  → Employee connects Stripe / poll / payout history
  → scheduleReleaseRecoverablePlatformPayablesForEmployee()
  → employeeTipRelease.service.ts → stripe.transfers.create
  → Payable status transferred
  → Bank payout: Stripe automatic (observed like business)
```

### 9.4 Internal tip distribution (business_distribution)

```
UI: Tip Distribution workspace
  → POST /api/.../tip-distribution/batch (connect.routes.ts)
  → tipDistribution.controller.ts → tipDistribution.service.ts
  → DB batch + allocations only (off-platform)
```

### 9.5 Background jobs (cron via `x-cron-secret`)

`backend/src/routes/internalJobs.routes.ts` — relevant entries:

| Job | Purpose | Pays money? |
|-----|---------|-------------|
| `connect-payout-reconciliation-tick` | Resume BT sync for payouts | No |
| `business-distribution-integrity-scan` | Read-only ledger scan | No |
| `employee-stripe-inactivity-tick` | 45-day inactivity | No |
| `trial-reminders` | Email at 7/3/1 days | No |
| DSAR / retention / tombstone ticks | Data lifecycle | No |

**No Vercel cron defined in `vercel.json`** — jobs are HTTP endpoints for external schedulers (e.g. Render cron).

---

## 10. Loader inventory vs scheduling (cross-check)

Not applicable to payouts; included only to avoid confusion with landing-loader audits. **No payout loader runs on a 3-day timer.**

---

## 11. Connect configuration model (from code, not live Stripe)

| Mechanism | Evidence |
|-----------|----------|
| **Automatic payouts (Stripe-driven)** | Webhook handling, e2e waits, `automatic` field on payout objects in scripts |
| **Manual `payouts.create` (CareTip-driven)** | **Instant only** in `backend/src` |
| **Platform-controlled payout schedule API** | **Not implemented** in `backend/src` |
| **Connected-account-controlled** | Default assumption for standard payouts; scripts **read** `settings.payouts.schedule` from Stripe Account retrieve |

CareTip **does not** change payout settings in production services (no `payouts.update` / schedule mutation found in `backend/src`).

---

## 12. UI / copy relevant to scheduling

| Key / location | Message |
|----------------|---------|
| `employee.payouts.stripeSchedule` | Stripe pays on **its** schedule |
| `employee.payouts.settledBody` | Sent to Stripe; **bank payouts follow Stripe’s schedule** |
| `business.connect.*` / `kpiPendingHint` | Funds **still settling** with Stripe |
| `landing.features.s8Body` | Internal tip distribution on **your** schedule (manager-driven) |
| FAQ / features | Instant Payout **not automatic** |

No UI exposes “every 3 days” for payouts.

---

## 13. Database entities (payout-related)

- `StripeConnectPayout` — business observed bank payouts
- `StripeConnectPayoutBalanceLine` — reconciliation lines
- `EmployeeStripePayout` — employee observed bank payouts
- `EmployeeTipPayable` — transfer entitlement / hold / transferred state
- Tip distribution batch tables — internal distribution ledger (see Prisma models referenced from `tipDistribution.service.ts`)

`arrival_date` stored from Stripe payout objects — informational, not used to drive a CareTip scheduler.

---

## 14. Recommended implementation architecture (phase 2 — do not implement yet)

**Step 0 — Product/legal:** Confirm which interpretation (A–F) Fanny means.

| If requirement is… | Recommended direction |
|--------------------|----------------------|
| **A/B — Settlement / Stripe schedule** | Document in FAQ/UI; optionally **display** `schedule.interval` + `delay_days` from Account retrieve in Connect settings; align Stripe Dashboard defaults for new accounts; **no** CareTip payout cron |
| **C — CareTip pays bank every 3 days** | New **internal job** + idempotent `payouts.create` per account; require **manual** Stripe payout schedule; balance guards; audit log; conflict rules with Instant Payout |
| **D — Transfer to employee every 3 days** | Extend `employeeTipPayable` with `releaseAfter` or payroll window; worker releases due payables; **distinct** from bank payout schedule |
| **E — Payroll distribution every 3 days** | Optional reminder job + batch templates; still likely **human-triggered** batch unless auto-distribution is a new product |

**Suggested engineering sequence (only after clarification):**

1. Add read-only **account payout settings** endpoint (interval, delay_days, debit_negative_balances, etc.).
2. Product decision: platform default at Connect onboarding vs per-business setting.
3. If C: implement scheduler + manual payout mode migration plan + monitoring.
4. Extend e2e scripts (pattern from `e2e-euro90-*`) with explicit 3-day **expectations** once defined.

---

## 15. Files / services / jobs index

| Area | Paths |
|------|--------|
| Payout observation | `backend/src/services/stripeConnectPayout.service.ts` |
| Payout reconciliation | `backend/src/services/stripeConnectPayoutReconciliation.service.ts` |
| Instant payout (business) | `backend/src/services/stripeConnectInstantPayout.service.ts` |
| Instant payout (employee) | `backend/src/services/employeeInstantPayout.service.ts` |
| Employee bank payout observation | `backend/src/services/employeeStripeBankPayouts.service.ts`, `employeeStripePayout.service.ts` |
| Employee tip transfer release | `backend/src/services/employeeTipRelease.service.ts` |
| Tip distribution (internal) | `backend/src/services/tipDistribution.service.ts`, `backend/src/controllers/tipDistribution.controller.ts` |
| Connect API | `backend/src/controllers/connect.controller.ts`, `backend/src/routes/connect.routes.ts` |
| Employee connect API | `backend/src/controllers/employeeConnect.controller.ts`, `employeeConnect.routes.ts` |
| Webhooks | `backend/src/webhooks/stripe.webhook.ts` |
| Cron jobs | `backend/src/routes/internalJobs.routes.ts` |
| Business reconciliation (read-only) | `backend/src/services/businessPayoutReconciliation.service.ts` |
| UI (business payouts) | `src/app/components/business/settings/billing/ConnectPayoutsPanel.tsx` |
| UI (employee) | `src/app/components/employee/EmployeePayoutAccountCard.tsx`, `EmployeeStripeBankPayoutList.tsx` |
| i18n | `src/i18n/locales/en.json` / `de.json` (`employee.payouts.*`, `business.connect.*`) |
| E2E / ops scripts | `backend/scripts/e2e-euro90-*.ts`, `stripe-connect-phase*.ts`, `employee-stripe-sandbox-lifecycle-verification.ts` |

---

## 16. Final classification (Fanny requirement vs codebase)

| Option | Verdict |
|--------|---------|
| **A** Relies entirely on Stripe payout schedule | **Yes** for standard bank payouts |
| **B** Creates payouts programmatically | **Only Instant** (on-demand), not periodic |
| **C** Schedules employee distributions separately | **Manual** tip distribution batches; transfers are event-driven |
| **D** Has existing scheduled job for payouts | **No** |
| **E** Partial/unused 3-day logic | **No** |
| **F** No 3-day implementation | **Yes** |

**Overall:** **F** — with strong evidence that **A** already covers standard bank payouts unless product wants **C** or **D** with an explicit 3-day rule.

---

## 17. Questions for Fanny / product (before implementation)

1. **Bank payout to business/employee** vs **transfer to employee Connect** vs **internal tip distribution**?
2. **3 calendar days** vs **3 business days** vs **Stripe’s default settlement**?
3. Should CareTip **change** Stripe payout settings on connected accounts, or only **reflect** Stripe’s behavior?
4. EU/DE regulatory copy — is this about **Trinkgeld-Weitergabe** timing to staff (distribution) or **Stripe settlement** to the business?

---

*End of read-only audit. No code or Stripe configuration was modified.*
