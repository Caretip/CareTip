# CARETIP — Employee Pending Balance Semantic / Data Consistency Forensic Audit

**Mode:** Read-only (no code or financial logic changes)  
**Date:** 2026-09-30  
**Observed UI:** Employee Analytics **Pending Release €0.00** vs Employee Stripe Payout **Pending €53.51** (with period **Your Earnings €53.51**)

---

## 1. Executive Summary

CareTip exposes two different “pending” concepts on two employee surfaces:

| Surface | Label | Source | Meaning |
|--------|--------|--------|---------|
| **Employee Analytics** (summary KPI) | Pending release | CareTip `EmployeeTipPayable` ledger | Net amount still owed from CareTip to the employee’s Connect account (`held_platform`, `transfer_failed`, or in-flight `transferring`) |
| **Employee Stripe Payout / Connect** | Pending | Stripe Connect `Balance.pending` (EUR) | Funds already on the employee Connect account that Stripe has not yet moved to **available** for payout |

These are **not the same financial state**. Analytics **Pending release €0.00** means no direct payables remain in platform-hold / failed / transferring release states. Stripe **Pending €53.51** means Stripe currently reports that amount in the connected account’s **pending** balance (settlement), which only exists **after** CareTip has routed money to Connect (transfer or destination charge).

The coincidence **Your Earnings (period) €53.51** = **Stripe Pending €53.51** is **not** guaranteed by code to be the same field or lifecycle step. Period earnings sum tip-date entitlements from payables; Stripe pending is a live balance snapshot. They can match when recent period net entitlement equals what Stripe is still settling on Connect—but **Pending release** would still be €0 if those tips are already `transferred` / `destination_settled` on the ledger.

**Final status: A — EXPECTED — TWO DIFFERENT FINANCIAL STATES**

(No evidence of a calculation bug from static analysis alone; runtime DB + Stripe corroboration would be needed to prove payables for that €53.51 are still `held_platform` while Stripe shows pending—**that** would be B.)

Secondary finding: labels reuse “Pending” / “not yet transferred” vs “settling with Stripe” in ways that are **semantically correct in copy** but **easy to conflate** (see §9–§11).

---

## 2. Analytics “Pending Release” Source

### UI → API

| Layer | Location |
|-------|----------|
| **Component** | `src/app/pages/employee/EmployeeAnalyticsPage.tsx` — summary cards use `data.lifetimeMetrics.pendingReleaseEur` (not `metrics.*`) |
| **Hook** | `src/app/hooks/useEmployeeAnalytics.ts` → `getEmployeeAnalytics(period)` |
| **API client** | `src/app/lib/api.ts` — `GET /api/me/employee-connect/analytics?period=…` |
| **Route** | `backend/src/routes/employeeConnect.routes.ts` — `GET /employee-connect/analytics` |
| **Controller** | `backend/src/controllers/employeeConnect.controller.ts` — `getMyEmployeeAnalytics` → `loadEmployeeAnalyticsForUser` |
| **Service** | `backend/src/services/employeeAnalytics.service.ts` — `lifetimeMetrics: await loadEmployeeFinancialMetrics(actor.employeeId)` |
| **Metrics** | `backend/src/services/employeeFinancialMetrics.service.ts` — `loadEmployeeFinancialMetrics` |

### i18n

- Label: `employee.analytics.pendingRelease` → “Pending release”
- Hint: `employee.analytics.pendingReleaseHint` → “Earnings not yet transferred to Stripe”

### Database / query

- **Model:** `EmployeeTipPayable` (`employee_tip_payables`), `direct_to_employee` rows only ( `business_distribution` skipped).
- **Not** Stripe balance-derived.
- **Not** `Transaction.payoutStatus` (explicitly documented in `employeeTipPayable.service.ts`).

**Aggregation loop** (`loadEmployeeFinancialMetrics`):

1. **Employee earnings (lifetime):** for each direct payable, `payableCents - refundedCents` (≥ 0).
2. **Pending release:** if status is `held_platform` or `transfer_failed` (`isRecoverablePlatformHoldPayableStatus`) **or** `transferring`, add `remainingPayableCents(row)`.
3. **Paid to Stripe:** if status is `transferred` or `destination_settled`, add `netTransferredCents(row)`.

**`remainingPayableCents`:**  
`payableCents - transferredCents - reversedCents - refundedCents - disputedOpenCents - disputedLostCents` (floored at 0).

**`netTransferredCents`:**  
`transferredCents - reversedCents - refundedCents - open/lost dispute cents` (floored at 0).

### Answers (checklist)

| Question | Answer |
|----------|--------|
| Employee earnings not yet transferred CareTip → Stripe Connect? | **Yes** — that is the product intent of pending release. |
| `EmployeeTipPayable`? | **Yes** — sole source. |
| `platform_hold`? | **Yes** — `held_platform` and failed/in-flight release states. |
| Includes `transfer_failed`? | **Yes** |
| Includes `transferring`? | **Yes** |
| Only currently releasable? | **Remaining** on hold/fail/transfer rows, not “scheduled” separately. |
| Period vs lifetime? | **Lifetime** — always from `lifetimeMetrics`, not period filter. |
| Employee-specific? | **Yes** — `employeeId` on payables + tips. |
| Stripe vs ledger? | **CareTip ledger only** |

**Statuses not counted in pending release or paid to Stripe** (but still in lifetime employee earnings if direct): e.g. `held_business`, `refunded`, and other non-terminal routing states—only the branches above update pending/paid buckets.

---

## 3. Stripe Payout “Pending” Source

### UI → API

| Layer | Location |
|-------|----------|
| **Component** | `src/app/components/employee/EmployeePayoutDashboardMetrics.tsx` — `eligibility.pendingCents` |
| **Page** | `src/app/pages/employee/EmployeePaymentsConnectPage.tsx` — `getEmployeeInstantPayoutEligibility()` on load |
| **API** | `GET /api/me/employee-connect/instant-payout` |
| **Controller** | `employeeConnect.controller.ts` — `getMyEmployeeInstantPayout` |
| **Service** | `employeeInstantPayout.service.ts` — `getEmployeeInstantPayoutEligibilityForUser` → `getEmployeeInstantPayoutEligibilityForStripeAccount` |
| **Stripe evaluation** | `stripeConnectInstantPayout.service.ts` — `evaluateInstantPayoutForStripeAccount` |

### Stripe call

```text
balance.retrieve(
  { expand: ["instant_available.net_available"] },
  { stripeAccount: stripeAccountId }
)
```

- **Pending amount:** `balanceAmount(balance.pending, currency)` — sum for the selected **currency** row in `balance.pending`.
- **Currency selection:** `currencyFromBalance` prefers **EUR** if present in available/pending rows; instant path may use EUR from `instant_available` when eligible.
- **Account:** `EmployeeStripeAccount.stripeAccountId` for the active employee (`resolveActiveEmployeeForConnect`).
- **Employee-specific:** Yes — one Connect account per employee record.
- **Lifetime vs snapshot:** **Current** Connect balance at request time (not tip-date period).
- **Includes funds already transferred by CareTip:** **Yes** — this is balance **on** Connect after routing (transfers / destination charges), not platform hold.
- **Payout-available:** **No** — pending is explicitly “not available for payout yet” in UI copy (`kpiPendingHint`).

### Analytics also shows Stripe pending (different section)

Lower on the same Analytics page: `data.stripe.pendingCents` from the **same** `getEmployeeInstantPayoutEligibilityForStripeAccount` path inside `loadEmployeeAnalyticsForUser` (not the summary KPI card). Label: `employee.analytics.stripePending` under Stripe balance.

---

## 4. Exact Money Flow

| Stage | Meaning | DB / Stripe | Status / object | Amount basis | Source of truth | Current UI |
|-------|---------|-------------|-----------------|--------------|-----------------|------------|
| **Customer tip** | Guest payment succeeded | `Transaction` / `tips` | `status = success` | `amount` (gross) | CareTip DB | Analytics **Gross tips** (period) |
| **CareTip payable** | Net employee entitlement for direct routing | `EmployeeTipPayable` | routing `direct_to_employee` | `payableCents - refundedCents` | CareTip ledger | **Your earnings** (period/lifetime) |
| **Pending release** | Still on CareTip; not fully on Connect per payable state | `EmployeeTipPayable` | `held_platform`, `transfer_failed`, `transferring` | `remainingPayableCents` | CareTip ledger | Analytics KPI **Pending release** (lifetime) |
| **CareTip → Connect transfer** | Platform release or destination charge settlement | Payable + Stripe `Transfer` / PI routing | → `transferred` / `destination_settled` | `transferredCents`, `netTransferredCents` | Payable + Stripe | **Paid to Stripe** (lifetime); transfer list on Analytics |
| **Stripe pending** | Connect balance settling | Stripe `Balance.pending` | N/A (balance bucket) | EUR `amount` | Stripe | Payout dashboard **Pending**; Analytics Stripe section |
| **Stripe available** | Eligible for standard/instant payout | Stripe `Balance.available` | N/A | EUR `amount` | Stripe | Payout **Available**; Analytics Stripe balance |
| **Bank payout** | Stripe → bank | Stripe `Payout` (+ local mirror/list) | `paid`, `in_transit`, etc. | Payout `amount` | Stripe | Bank payout tables on Payout + Analytics pages |

**Release path (platform hold):** `employeeTipRelease.service.ts` — `scheduleReleaseRecoverablePlatformPayablesForEmployee` / `releaseHeldPlatformPayablesForEmployee` when Connect is recipient-ready.

---

## 5. Source-of-Truth Mapping

| Metric | Source of truth | Mutates when |
|--------|-----------------|--------------|
| Gross tips (period) | SQL on `tips` + date range | New tips in period |
| Your earnings (period) | SQL join payables, tip `created_at` in period | Tips in period |
| Your earnings (lifetime) | Sum direct payables entitlements | Any payable change |
| Paid to Stripe (lifetime) | Payables `transferred` / `destination_settled` | Transfer completes / destination settles |
| Pending release (lifetime) | Payables hold/fail/transferring | Release success/failure/state |
| Stripe pending | Stripe Balance API | Stripe settlement timing |
| Stripe available | Stripe Balance API | Pending → available transition |

**Lifetime identity (direct payables only, per regression fixture):**  
`employeeEarningsEur ≈ paidToStripeEur + pendingReleaseEur`  
Stripe pending is **not** part of this equation.

---

## 6. Time-Period Mapping

| Metric | Scope | Implementation |
|--------|--------|----------------|
| Gross tips | Period (or all) | `queryEmployeeAnalyticsPeriodKpis` / lifetime when `period=all` |
| Your earnings | Period (or all) | Same — `metrics.employeeEarningsEur` |
| Paid to Stripe | **Lifetime always** | `lifetimeMetrics.paidToStripeEur` |
| Pending release | **Lifetime always** | `lifetimeMetrics.pendingReleaseEur` |
| Stripe available/pending | **Current** | Live Stripe balance at fetch |
| Bank payouts list | Recent history | List services (not period-filtered like tips) |

**UI disclosure:** When `period !== "all"`, Analytics shows:  
“Period based on tip date · Paid and pending are lifetime totals” (`paidPendingLifetime`).  
**Verified:** Implementation matches — paid/pending use `lifetimeMetrics`; gross/earnings use `metrics` with period SQL on `t.created_at`.

**Reconciliation flow diagram** on Analytics mixes period gross/earnings with lifetime paid/pending — consistent with the footnote, but visually easy to misread.

**Status section** at bottom uses **lifetime** for earnings, transferred, and pending release (`lifetimeMetrics.*`), not period KPIs.

---

## 7. €53.51 Trace

### Code-level relationships

1. **€53.51 as pending release (ledger):**  
   `backend/scripts/employee-financial-metrics-runtime.ts` asserts `pendingReleaseEur === 53.51` for a synthetic payable with `payableCents: 5351`, `status: transfer_failed`, `platform_hold` — **still on CareTip**, not transferred.

2. **€0 pending release + €53.51 Stripe pending (observed UI):**  
   Implies direct payables contributing to that money are **not** in `held_platform` / `transfer_failed` / `transferring` with remaining balance; they are likely **`transferred` or `destination_settled`** (counted in **Paid to Stripe** lifetime €483.25, not pending release).

3. **Your earnings €53.51 (period):**  
   Sum of `GREATEST(0, payable_cents - refunded_cents)` for direct payables on tips whose **tip date** falls in the selected period — independent of Stripe pending cents.

4. **Stripe pending €53.51:**  
   `balance.pending` EUR on `acct_*` at eligibility fetch — independent of CareTip period filters.

### Same amount, same state?

**Not necessarily.** Equality is possible when:

- Period net entitlement equals Stripe’s current pending bucket (e.g. recent tips just transferred and still settling), **while** ledger pending release is 0.

They are **not** wired to the same variable. Analytics does **not** set `pendingReleaseEur` from Stripe.

### Should €53.51 appear in Analytics pending release?

| Case | Pending release | Stripe pending |
|------|-----------------|----------------|
| **A. Already transferred / destination settled** | **€0 (correct)** | **Can be €53.51 (correct)** |
| **B. Still `held_platform` / `transfer_failed` with €53.51 remaining** | **Should be €53.51** | May be €0 or lower until transfer lands |

For the **observed** numbers (0 vs 53.51), **scenario A is consistent with code** without invoking a bug.

**To confirm A vs B for a real user:** inspect `employee_tip_payables` for that employee (status + `remainingPayableCents`) and compare to Stripe balance at the same timestamp.

---

## 8. Whether the Discrepancy Is Expected

**Yes — expected** when platform release is complete (ledger pending release 0) but Stripe still holds funds in **pending** settlement.

- Analytics **Pending release** answers: “What does CareTip still owe to move to Connect?”
- Payout **Pending** answers: “What is on Connect but not payout-available yet?”

Different questions → different numbers allowed (including 0 vs positive).

---

## 9. Terminology / UX Findings

| Term | Implementation match | Clarity |
|------|----------------------|--------|
| **Pending release** | Matches CareTip-not-transferred ledger definition | Hint is accurate; word “release” helps |
| **Pending** (payout KPI) | Matches Stripe `Balance.pending` | Accurate hint about settling |
| **Paid to Stripe** | `netTransferredCents` on settled/transferred payables | Means routed to Connect, not bank |
| **Available** (payout) | Stripe `Balance.available` | Correct |
| **Bank payout** | Stripe Payout objects | Distinct from “paid to Stripe” |

**Friction:**

- Both surfaces use **“Pending”** without always prefixing **“at Stripe”** vs **“release”**.
- Summary grid places **period** earnings beside **lifetime** pending release without reading the footnote.
- Analytics **Stripe** section shows the same Stripe pending as Payout page but summary KPI does not — users comparing top cards to Payout page miss that Analytics lower section aligns with Payout.

**Do not change labels in this audit** — implementation matches intended definitions; UX can still confuse.

---

## 10. Confirmed Bugs

**None confirmed from static analysis.**

| Hypothesis | Verdict |
|------------|---------|
| Wrong API wired to Analytics pending KPI | **No** — uses `loadEmployeeFinancialMetrics` |
| Stripe pending used for pending release | **No** |
| Period filter applied to pending release | **No** |
| Missing `transfer_failed` in pending release | **No** — included |

**Would be B only if** runtime data shows €53.51 still in recoverable platform-hold payables while UI shows pending release €0.

---

## 11. Recommended UI Clarification (no implementation)

1. Rename or qualify payout KPI: e.g. “Pending at Stripe” vs “Pending release (CareTip)”.
2. In summary grid, visually group lifetime cards or repeat “lifetime” on Paid / Pending release chips.
3. Cross-link: “See Stripe balance below” when `stripe.readable && stripe.pendingCents > 0 && pendingReleaseEur === 0`.
4. Dashboard hero (`EmployeeHeroFinancialPanel`) uses same `pendingReleaseEur` from dashboard APIs — same semantics as Analytics.

---

## 12. Files / Routes / Services Inspected

**Frontend**

- `src/app/pages/employee/EmployeeAnalyticsPage.tsx`
- `src/app/pages/employee/EmployeePaymentsConnectPage.tsx`
- `src/app/components/employee/EmployeePayoutDashboardMetrics.tsx`
- `src/app/hooks/useEmployeeAnalytics.ts`
- `src/app/lib/api.ts` (analytics + instant-payout)
- `src/i18n/locales/en.json` (analytics + payout strings)

**Backend**

- `backend/src/routes/employeeConnect.routes.ts`
- `backend/src/controllers/employeeConnect.controller.ts`
- `backend/src/services/employeeAnalytics.service.ts`
- `backend/src/services/employeeFinancialMetrics.service.ts`
- `backend/src/services/employeeTipPayable.service.ts`
- `backend/src/services/employeeInstantPayout.service.ts`
- `backend/src/services/stripeConnectInstantPayout.service.ts`
- `backend/src/services/employeeTipRelease.service.ts`
- `backend/prisma/schema.prisma` (`EmployeeTipPayableStatus`)

**Routes**

- `GET /api/me/employee-connect/analytics`
- `GET /api/me/employee-connect/instant-payout`

---

## 13. Tests Reviewed

| Test / script | Relevance |
|---------------|-----------|
| `backend/scripts/employee-financial-metrics-runtime.ts` (`npm run test:employee-financial-metrics`) | Pending release €53.51 on `transfer_failed`; lifetime reconcile identity |
| `backend/scripts/business-logic-pentest.ts` | References `loadEmployeeFinancialMetrics` |
| `e2e/employee-analytics-mobile-overflow.spec.ts` | Mocked analytics bundle with `pendingReleaseEur` |
| `e2e/employee-transfer-status.spec.ts` | Analytics route + reconciliation UI |

No unit test found that asserts Stripe `pendingCents` equals `pendingReleaseEur` (appropriately absent).

---

## Final Status

**A — EXPECTED — TWO DIFFERENT FINANCIAL STATES**

Financial logic treats Analytics pending release and Stripe balance pending as distinct layers of the tip lifecycle. The observed **€0.00 vs €53.51** pattern matches funds already released on the CareTip ledger while Stripe is still settling on Connect. Terminology overlap warrants UX clarification (§11) but does not by itself indicate a data bug.

**D — INCONCLUSIVE** would apply only if production payables for the specific €53.51 could not be inspected and ledger state contradicted scenario A.
