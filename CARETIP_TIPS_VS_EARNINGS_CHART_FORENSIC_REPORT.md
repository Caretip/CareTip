# CareTip — Tips over time vs Earnings over time — Data semantics forensic audit

**Date:** 2026-10-03  
**Scope:** Employee Analytics page (`/employee/analytics`) — forensic only, **no code changes**  
**Evidence:** Screenshot hover `2026-06-16` → Tips over time **€34.53**; Earnings over time differs for the same period; tip records show GROSS / CARETIP FEE / YOUR EARNINGS (e.g. €50.00 / €5.49 / €44.51).

---

## Executive summary

Both charts are built from **one** API response (`chartSeries[]`) with **the same calendar bucket label** per point. They differ **only** in which numeric column is plotted (`grossEur` vs `earningsEur`). That is **intentional product semantics**: “Tips over time” is **customer gross tip volume**; “Earnings over time” is **employee direct entitlement** from the payable ledger (excluding business-routed tips, net of refunds).

For the same date, values **should not match** whenever CareTip fees, business routing, missing payables, or refunds apply.

---

## 1. Tips over time — exact definition

| Item | Implementation |
|------|----------------|
| **UI** | `EmployeeAnalyticsPage` → `MiniTrendChart` with `employee.analytics.chartGross` (“Tips over time”) |
| **Frontend mapping** | `(data?.chartSeries ?? []).map(p => ({ time: p.label, amount: p.grossEur }))` |
| **Hook** | `useEmployeeAnalytics` → `getEmployeeAnalytics(period)` |
| **API** | `GET /api/me/employee-connect/analytics?period={today\|week\|month\|year\|all}` |
| **Controller** | `getMyEmployeeAnalytics` → `loadEmployeeAnalyticsForUser` |
| **Service** | `employeeAnalytics.service.ts` — chart SQL (see below) |
| **DB** | Table `tips` (Prisma `Transaction`) |
| **Amount field** | `tips.amount` (Decimal EUR, customer-facing gross tip) |
| **Formula** | `SUM(t.amount)` per business-local calendar day |
| **Date field** | `tips.created_at` (tip creation / success timeline — `periodBasis: "tip_created_at"`) |
| **Timezone** | `Business.timezone` (IANA); bucket via `(created_at AT TIME ZONE 'UTC') AT TIME ZONE {tz}` then `date_trunc('day', …)` → `YYYY-MM-DD` |
| **Status filter** | `t.status = 'success'` only |
| **Employee scope** | `t.employee_id = {authenticated employee}` |
| **Period filter** | `t.created_at >= periodStart AND t.created_at <= periodEnd` (UTC instants from `businessUtcRangeForTimeframe`) |
| **Fee treatment** | **Not deducted** — gross is full tip amount |
| **Refunds** | **Not subtracted** from gross in chart SQL |
| **Disputes** | No separate dispute filter; failed/pending tips excluded by `status = 'success'` |
| **Routing** | **All** successful tips counted (direct + business distribution + legacy without payable) |
| **Payout / transfer** | **Not used** for chart bucketing or amount |
| **Aggregation** | **Daily** buckets (`GROUP BY` local day); **not** cumulative; **no** zero-fill for empty days (only days with ≥1 tip appear) |
| **Frontend transform** | No extra grouping/averaging — raw `grossEur` per label |

**Exact SQL fragment (chart gross):**

```sql
COALESCE(SUM(t.amount), 0)::float AS gross
```

---

## 2. Earnings over time — exact definition

| Item | Implementation |
|------|----------------|
| **UI** | Same page → `MiniTrendChart` with `employee.analytics.chartEarnings` (“Earnings over time”) |
| **Frontend mapping** | `amount: p.earningsEur` (same `p.label` as gross chart) |
| **API / service** | Same bundle as above |
| **DB** | `tips` LEFT JOIN `employee_tip_payables` ON `p.transaction_id = t.id` |
| **Amount field** | `employee_tip_payables.payable_cents` and `refunded_cents` (integer cents) |
| **Formula** | Per tip, **only if** `p.routing_mode = 'direct_to_employee'`: `GREATEST(0, p.payable_cents - p.refunded_cents) / 100.0`; else **0** |
| **Meaning** | **Net employee entitlement** for Stripe-direct routing (ledger), after refunds — **not** payout arrival date and **not** transferred-to-bank amount |
| **Date field** | Same as gross: **`t.created_at`** bucketed in business timezone |
| **Timezone** | Same as gross |
| **Status filter** | `t.status = 'success'` |
| **Fee treatment** | CareTip fee is **already reflected** in `payable_cents` (fee is **not** subtracted again in the chart SQL) |
| **Refunds** | **Subtracted** via `refunded_cents` |
| **Disputes** | `disputed_open_cents` / `disputed_lost_cents` are **not** in the chart CASE (only `refunded_cents`) |
| **Routing** | `business_distribution` → **€0** in earnings series (gross still counts in tips series) |
| **Missing payable** | Gross counts `t.amount`; earnings contribution **0** |
| **Aggregation** | Same daily buckets and period filters as gross |
| **Frontend transform** | None beyond mapping `earningsEur` |

**Exact SQL fragment (chart earnings):**

```sql
COALESCE(SUM(
  CASE
    WHEN p.routing_mode::text = 'direct_to_employee'
      THEN GREATEST(0, p.payable_cents - p.refunded_cents) / 100.0
    ELSE 0
  END
), 0)::float AS earnings
```

**Shared helper (tip records / KPIs):** `directEmployeeEarningsEur(payable)` → `max(0, payableCents - refundedCents) / 100` for direct routing; `null` for business distribution / no payable.

---

## 3. Side-by-side chart semantics

| | **Tips over time** | **Earnings over time** |
|--|-------------------|------------------------|
| **Amount field** | `tips.amount` | `payable_cents - refunded_cents` (direct only) |
| **Meaning** | Customer gross tips | Employee direct ledger entitlement |
| **Formula** | `SUM(amount)` | `SUM(direct entitlement EUR)` |
| **Date field** | `created_at` | `created_at` |
| **Timezone** | Business IANA | Business IANA |
| **Status filter** | `success` | `success` |
| **Fee treatment** | Ignored (gross) | Embedded in payable |
| **Refund treatment** | Ignored | Subtracted |
| **Dispute treatment** | N/A in SQL | Not explicit (refunds only) |
| **Routing** | All tips | Direct only |
| **Granularity** | Daily | Daily (same labels) |

---

## 4. Same-date comparison — 2026-06-16

**Production database access:** Not available in this audit environment. **Exact row-level totals for 2026-06-16 cannot be computed here.**

### How to reproduce locally (read-only)

```sql
-- Replace :employee_id, :periodStart, :periodEnd, :tz from analytics bundle / business
SELECT
  to_char(date_trunc('day', (t.created_at AT TIME ZONE 'UTC') AT TIME ZONE :tz), 'YYYY-MM-DD') AS day,
  COUNT(*) AS tip_count,
  COALESCE(SUM(t.amount), 0) AS gross_eur,
  COALESCE(SUM(p.platform_fee_cents), 0) / 100.0 AS fee_eur,
  COALESCE(SUM(CASE WHEN p.routing_mode::text = 'direct_to_employee'
    THEN GREATEST(0, p.payable_cents - p.refunded_cents) ELSE 0 END), 0) / 100.0 AS earnings_eur
FROM tips t
LEFT JOIN employee_tip_payables p ON p.transaction_id = t.id
WHERE t.employee_id = :employee_id
  AND t.status = 'success'
  AND t.created_at >= :periodStart AND t.created_at <= :periodEnd
  AND to_char(date_trunc('day', (t.created_at AT TIME ZONE 'UTC') AT TIME ZONE :tz), 'YYYY-MM-DD') = '2026-06-16'
GROUP BY 1;
```

### Relating screenshot **€34.53** (tips chart)

That tooltip value is **`chartSeries[].grossEur`** for label `2026-06-16` — i.e. **sum of `tips.amount`** for successful tips whose **business-local tip date** is 2026-06-16.

The **earnings** tooltip for the **same** `label` is the **`earningsEur`** column from the **same SQL row**, typically:

\[
\text{earnings}_{\text{day}} = \sum_{\text{direct tips on day}} \frac{\max(0, \text{payable\_cents} - \text{refunded\_cents})}{100}
\]

\[
\text{gross}_{\text{day}} = \sum_{\text{all success tips on day}} \text{amount}
\]

So **€34.53 gross does not imply €34.53 earnings** unless every euro that day is direct-routed with zero fee and zero refund (unusual).

### Worked example from automated tests (same calendar day, mixed routing)

`employee-analytics-final-closure-runtime.ts` seeds **two tips on the same `createdAt`**:

| Tip | Gross (`amount`) | Routing | Payable / fee | Chart earnings contribution |
|-----|------------------|---------|---------------|-----------------------------|
| A | €50.00 | `direct_to_employee` | fee €5.49, payable €44.51 | €44.51 |
| B | €40.00 | `business_distribution` | payable exists | **€0** |

**Same day bucket:**

| Metric | Value |
|--------|-------|
| Tips chart (gross) | **€90.00** |
| Earnings chart | **€44.51** |
| Tip count | 2 |

This matches KPI `employeeEarningsEur = 44.51` while gross KPI = 90.

The visible **€50 / €5.49 / €44.51** row is tip **A** semantics (`YOUR EARNINGS` = direct entitlement, not gross).

If the user’s **€34.53** is the gross for 2026-06-16, earnings that day are **≤ €34.53**, with equality only in the edge case above; with a normal fee structure, earnings ≈ gross − fee − refunds per direct tips, and **€0** for any business-routed volume that day.

---

## 5. Should the two charts match on the same date?

**Answer: B — NO.** They intentionally represent **different financial metrics** on the **same date axis**.

- **Tips over time** = customer **gross** tip volume (success, by tip date).  
- **Earnings over time** = **direct employee entitlement** from payables (by the **same** tip date), excluding business-routed tips and net of refunds.

They share date bucketing and filters; divergence is **expected** when fees, routing, refunds, or missing payables exist.

**Not C (date/filter mismatch between charts):** Both series come from one query with one `GROUP BY day`.

---

## 6. Date field and midnight / timezone

- **Both charts** bucket on **`tips.created_at`**, interpreted as UTC wall time in DB, projected to **business timezone** (`sqlNaiveUtcColumnAsLocal`).
- **Not used** for these charts: `paidAt`, transfer time, Stripe payout arrival, payable `created_at`.
- **UI copy:** `employee.analytics.periodBasisTipDate` → “tip date”.
- **Tip records table** displays `createdAt` with `Intl.DateTimeFormat(..., { timeZone: businessTimezone })` — aligned with chart buckets for that tip.
- **Risk:** A tip near local midnight is assigned to one local day; both charts use the same truncation, so they **cannot** assign the same tip to different days relative to each other.

---

## 7. CareTip tip records table vs charts

| Column | Source | Relation to charts |
|--------|--------|-------------------|
| **GROSS** | `Transaction.amount` | Same as gross chart per tip |
| **CARETIP FEE** | `platformFeeCents / 100` when payable exists | Not plotted directly; explains gross − entitlement when `payable_cents ≈ gross_cents − fee` |
| **YOUR EARNINGS** | `directEmployeeEarningsEur(payable)`; UI shows `0` when `null` | Same per-tip logic as earnings chart **for direct tips** |

**Formula (direct tips with payable):**  
`YOUR EARNINGS` = `(payable_cents - refunded_cents) / 100`, **not** universally `GROSS − FEE` in code — but product data is intended so payable reflects fee (see €50 / €5.49 / €44.51).

**Caveats when reconciling table ↔ chart for a day:**

1. **Table is capped at 100 rows** (`take: 100`, most recent in period) — **not** a full-day ledger export. Summing visible rows for 2026-06-16 can **under-count** if more than 100 tips exist in the period or older rows on that day fall off the page.
2. **Business-routed tips** show gross in table but **null** earnings (UI **€0.00**); gross chart still includes them; earnings chart does not.
3. **Legacy / no payable:** gross in tips chart; earnings **0**; fee column “—”.

---

## 8. Aggregation granularity and chart behavior

- **Both:** daily points for `week` / `month` / `year` / `all` (year/all still daily buckets over the selected UTC range).
- **Not** weekly/monthly rollups on this page (contrast: employee **dashboard** period chart uses `buildEmployeeChartSeries` with hourly for “today” only — different surface).
- **No** cumulative sum, averaging, or interpolation in `MiniTrendChart`.
- **Sparse X axis:** only days with tips appear (no zero-padding).

---

## 9. Filter consistency (between the two charts)

Identical for both series (single SQL):

| Filter | Value |
|--------|--------|
| Business | Implicit via employee membership |
| Employee | Authenticated employee only |
| Date range | Query `period` → `businessUtcRangeForTimeframe` |
| Currency | EUR; amounts as EUR decimals; payables in cents ÷ 100 |
| Tip status | `success` only |
| Refunded tips | Still `success`; gross unchanged; earnings reduced by `refunded_cents` |
| Disputed | No extra chart filter |
| Pending/failed | Excluded |
| Test transactions | No special exclusion in analytics SQL |

---

## 10. Currency and rounding

- Storage: `tips.amount` `Decimal(10,2)`; payables in **integer cents**.
- Charts: SQL `float` sums; frontend `formatEur` on tooltip.
- Minor float display noise possible; tests assert KPI ↔ chart totals at period level.

---

## 11. Screenshot-specific trace (€34.53 on 2026-06-16)

| Step | Result |
|------|--------|
| Tooltip “Tips over time” €34.53 | `chartSeries.find(label === '2026-06-16').grossEur` |
| Earnings same date | Same row’s `earningsEur` (not shown in screenshot) |
| Underlying meaning | Sum of successful tip **gross** amounts that day vs sum of **direct entitlements** that day |
| €50.00 visible row | If that row’s localized date is **not** 2026-06-16, it is **not** required to appear in the 2026-06-16 bucket; if it **is** that day, gross bucket must include €50 unless filtered by period |

**Without DB:** cannot list individual tips composing €34.53 or the exact earnings tooltip value.

---

## 12. Inconsistencies / bugs discovered

| Finding | Severity | Notes |
|---------|----------|--------|
| Different values same date | **Not a bug** | By design (gross vs direct entitlement) |
| Same date field for both | **Consistent** | `created_at` + business TZ |
| Table vs chart for a day | **UX / data literacy** | Table is 100-row sample; charts are full-period SQL |
| `disputed_*` cents not in earnings CASE | **Document** | May diverge from future dispute settlement expectations; refunds handled |
| Gross uses `tips.amount` vs payable `gross_cents` | **Low** | Tip records use `amount`; rare mismatch if ledger gross differs |

No evidence that the two charts use different dates or periods.

---

## 13. Recommended minimal remediation (if any)

**None required for correctness** of different values.

Optional product/UX (out of scope for this audit):

- Short helper text under charts: gross vs “your direct earnings (after refunds; business-routed tips excluded)”.
- Tooltip subtitles or legend to reduce confusion.
- “Export day detail” or uncapped records view for reconciliation (table cap).

---

## 14. Automated regression references

- `npm run test:employee-analytics-period-kpi` — chart gross sums match period KPI.
- `npm run test:employee-analytics-final-closure` — mixed routing: gross 90, earnings 44.51; refunds reduce earnings only on earnings side.
- `npm run test:employee-analytics-timezone` — chart gross vs KPI under business TZ.

---

**STATUS: SEMANTICALLY DIFFERENT BUT CORRECTLY IMPLEMENTED**
