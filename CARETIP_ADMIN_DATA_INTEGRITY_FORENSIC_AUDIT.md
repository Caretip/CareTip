# CARETIP — Admin Data Integrity, Financial Consistency & Operational Clarity Forensic Audit

**Mode:** Read-only trace (UI → API → service → DB/Stripe). No code changes were made.

**Scope:** Platform Admin (`/platform-admin/*`): overview, business analytics, global transactions, refunds, Connect payouts, subscription/revenue surfaces, shared backend services.

**Primary code paths reviewed:** `backend/src/routes/platform.routes.ts`, `backend/src/controllers/platform.controller.ts`, `backend/src/services/platform.service.ts`, `platformAnalytics.service.ts`, `platformConnectActivity.service.ts`, `stripeConnectPayout.service.ts`, `finance/tipRefunds.service.ts`, `employeeTipPayable.service.ts`, `businessBankPayoutSchedule.service.ts`, `businessScheduledBankPayout.service.ts`, `commercial/platformSubscriptionMonitoring.service.ts`, and matching frontend pages under `src/app/pages/platform/` and `src/app/components/AdminDashboard.tsx`.

---

# Executive Summary

CareTip’s Platform Admin area has a **solid webhook-backed ledger** for tips (`Transaction` / `tips` table), employee payables (`EmployeeTipPayable`), Stripe refunds/disputes (`TipRefund`), and Connect payouts (`StripeConnectPayout`, `EmployeeStripePayout`). Global Transactions and Refunds are largely **reconcilable** when Stripe IDs and payable rows exist.

However, the admin control surface is **not yet trustworthy as a single operational source of truth** because:

1. **Tip ledger states** on Global Transactions are shown with **legacy “payout” i18n** and humanized enums (`held platform`, `destination settled`) that describe **employee payable routing**, not bank payout status—despite improved page subtitle copy.
2. **“Active businesses”** on the overview counts **onboarding-approved** venues, not fully KYC-verified or tip-active businesses—a label/definition mismatch.
3. **Business Analytics** has **no payout analytics**; payout data exists in DB but is not aggregated for admin charts.
4. **Connect Payouts list** merges three streams with a **windowed merge** that can **mis-page** and **overstate `total`** for operational reconciliation at scale.
5. **Payout schedule truth** (CareTip `every_3_days` + Stripe `manual` + scheduler) is **not exposed in Admin**; schedule changes lack a **dedicated audit trail**.
6. **Stale caches** (45–60s) on stats/analytics lack UI freshness indicators.

**Overall:** **NOT READY — SPECIFIC DATA INTEGRITY ISSUES REQUIRE REMEDIATION** before treating Admin as authoritative for payouts, ledger wording, and cross-page totals.

---

# Overall Data Integrity Assessment

| Area | Assessment |
|------|------------|
| Tip payment amounts (DB) | **Strong** — `Transaction` maps to `tips`; stats and lists use same table |
| CareTip fee / net to staff (list) | **Strong when payable exists** — stored `platformFeeCents` / `payableCents`; fee formula from `calculateTipPlatformFeeCents` at creation |
| Employee payable lifecycle | **Strong in DB** — enum-driven; **weak in Admin labels** |
| Stripe Connect bank payouts | **Strong in DB** — `arrivalDate` from Stripe `arrival_date` via `parsePayoutObject` |
| Refunds / disputes | **Strong** — `TipRefund` SSOT from Stripe webhooks |
| Subscription SaaS revenue | **Moderate** — subscription tables + `subscription_events` audit stream |
| Cross-page time ranges | **Mixed** — analytics charts are range-bound; some distributions are lifetime |
| Admin payout schedules | **Not represented** in Admin UI |

---

# Admin Dashboard Audit

**Route:** `/platform-admin/dashboard` → `AdminDashboard.tsx`  
**Auth:** Frontend `user.role === "platform_admin"`; API `authMiddleware` + `requireAdminRoleClaim` + `requirePlatformAdmin` (`SUPER_ADMIN` + `isPlatformAdmin` + `emailVerified`).

### Metric table

| Metric | UI label | UI source | Backend endpoint | Service / query | DB / Stripe | Calculation | Period | Reconciliable? | Risk |
|--------|----------|-----------|------------------|-----------------|-------------|-------------|--------|----------------|------|
| Active businesses | `admin.overview.kpi.activeBusinesses` | `onboardingMetrics.approved` | `GET /api/platform/onboarding/metrics` | `getOnboardingQueueMetrics()` — SQL count `onboarding_verification_status = 'approved'` | `businesses` | Count | All time (snapshot) | Yes vs onboarding filter | **High** — label implies “operational/active”; not KYC-verified (`getFullyVerifiedBusinessCount` exists but unused on dashboard) |
| Staff | `admin.overview.kpi.staff` | `stats.employeesCount` | `GET /api/platform/stats` | `prisma.employee.count()` | `employees` | Count | All time | Yes | Low |
| Transactions | `admin.overview.kpi.transactions` | `stats.successTransactionCount` | `GET /api/platform/stats` | Raw SQL on `tips`: `COUNT(*) FILTER (WHERE status = 'success')` | `tips` / `Transaction` | Count successful tips | All time | Yes vs global tx filter `success` | Low |
| Pending onboarding | `admin.overview.kpi.pendingOnboarding` | `onboardingMetrics.submitted` | Same as above | `status = 'submitted'` | `businesses` | Count | All time | Yes | Low |
| Total businesses (teaser) | `admin.overview.kpi.totalBusinesses` | `stats.businessesCount` | `GET /api/platform/stats` | `prisma.business.count()` | `businesses` | Includes non-deleted all statuses | All time | Yes | Medium — includes draft/rejected |
| New businesses this week | teaser | `analytics.growth` last 7 days | `GET /api/platform/analytics?days=30` | `platformAnalytics.service` — `businesses.created_at` buckets | `businesses` / User proxy fallback | Sum of daily new businesses | Last 7 local days in chart TZ | Partial | Medium — TZ = query `timezone` (dashboard uses default from API, not exposed on overview) |
| Tip volume chart | overview charts | `analytics.tipVolume` | `GET /api/platform/analytics` | SQL `tips` success `SUM(amount)` by local day | `tips` | EUR sum | 30d default, Europe/Berlin on overview chart format | Yes | Low — **cached 60s** |
| Subscription chart | overview charts | `subscriptionMonitoring.overview` | `GET /api/platform/subscriptions/monitoring` | `platformSubscriptionMonitoring.service` | Subscriptions + events | Counts by status | Snapshot + widgets (e.g. failed today UTC) | Partial | Medium — mixed UTC day boundaries for “today” widgets |
| Platform health | hero badge | `fetchPlatformHealth` | `GET /api/platform/health` | `checkDatabaseHealth` + `checkStripeHealth` (`stripe.balance.retrieve`) | Live probe | Online/offline | Point-in-time | N/A | Low — Stripe check is reachability, not balance reporting |
| Failed payments today (alert) | attention alert | `subscriptionMonitoring.widgets.failedPaymentsToday` | monitoring endpoint | subscription events | `subscription_events` | Count | UTC day | Yes | Low |
| Total tip volume EUR | **Not on overview KPI row** | — | stats includes `totalVolumeEur` | SQL sum successful tips | `tips` | Sum | All time | Yes | Medium — metric exists in API but not prominent on dashboard |

**Caches:** `platform:stats` **45s** (`PLATFORM_STATS_CACHE_TTL_MS`); `platform:analytics:*` **60s**. No “as of” timestamp in UI.

**Limits:** Business activity cache loads up to **10,000** businesses for teaser sort (`getAllBusinessActivity`).

---

# Financial Source-of-Truth Matrix

| Concept | Authoritative source | Secondary | CareTip derived | Stripe object | Admin UI pages |
|---------|---------------------|-----------|-----------------|---------------|----------------|
| TIP (guest payment) | `Transaction` (`tips`) after webhook/checkout completion | — | — | PaymentIntent, Charge | Global Transactions, Analytics |
| PAYMENT status | `Transaction.status` (`success`/`pending`/`failed`) | Stripe PI status | — | PaymentIntent | Global Transactions |
| CARETIP FEE | `EmployeeTipPayable.platformFeeCents` (persisted at tip success) | `calculateTipPlatformFeeCents` in `config/fees.ts` | Global tx displays current **constants** in label even when fee null | `application_fee_amount` on charge (Connect) | Global Transactions |
| EMPLOYEE PAYABLE | `EmployeeTipPayable` | — | `payableCents` | — | Global Transactions (`payoutStatus` column = payable.status) |
| EMPLOYEE TRANSFER | `EmployeeTipPayable.stripeTransferId`, status `transferred` | — | — | Transfer | Connect Payouts (`ct_*` rows, `caretip_transfer`) |
| BUSINESS DISTRIBUTION | Payable `held_business` / routing | `tipDistribution.service` | — | May involve Connect transfers | Business dashboards (not admin list) |
| REFUND | `TipRefund` | — | Payable refund cents | Refund | Refunds |
| DISPUTE / CHARGEBACK | `TipRefund` kind `dispute`/`chargeback`, status `won`/`lost` | — | `applyDisputeToEmployeePayable` | Dispute | Refunds |
| STRIPE BALANCE (connected) | Stripe API | — | Not shown on admin overview | Balance | Health probe only |
| BANK PAYOUT (business) | `StripeConnectPayout` | Webhooks; throttled `syncConnectPayoutsFromStripeForBusiness` | Reconciliation lines | Payout `po_*` | Connect Payouts |
| BANK PAYOUT (employee) | `EmployeeStripePayout` | Webhooks | — | Payout on employee account | Connect Payouts (`ep_*`) |
| PAYOUT STATUS (bank) | `StripeConnectPayout.status` / `EmployeeStripePayout.status` | `mapStripePayoutStatus` | CareTip transfers map payable → pseudo payout status | Payout.status | Connect Payouts |
| PAYOUT ARRIVAL (bank) | `arrivalDate` column from Stripe `arrival_date` | — | **Not invented**; CareTip transfers: `null` → UI "—" | Payout.arrival_date | Connect Payouts |
| SUBSCRIPTION | Stripe Billing + local subscription row | `subscription_events` | Monitoring KPIs | Subscription, Invoice | Overview charts, revenue subpages |
| SUBSCRIPTION PAYMENT | Invoice payment webhooks → events | — | `paymentStatus` on activity rows | Invoice | Successful/failed subscription pages |
| PLATFORM REVENUE (SaaS) | Stripe invoices / subscription_events | — | Commercial intelligence segments | Invoice | Revenue/*, reports/commercial |
| PLATFORM REVENUE (tip fees) | Sum of `platformFeeCents` (not aggregated on admin overview) | — | Could be derived from payables | Application fees | **Gap** — no dedicated admin tip-fee revenue dashboard |

**Misleading presentation risk:** Global Transactions column API field `payoutStatus` is **`EmployeeTipPayable.status`**, not `Transaction.payoutStatus` (legacy `PayoutStatus` enum on the same row) and not Stripe payout status.

---

# Business Analytics Audit

**Page:** `PlatformBusinessAnalyticsPage.tsx` → `GET /api/platform/analytics` + `GET /api/platform/commercial-intelligence`.

**Charts (via `AdminDashboardAnalyticsCharts` variant `business`):**

- Growth (users, businesses, tips per day) — `tips` + `User` + `businesses.created_at` (with MANAGER proxy fallback).
- Tip volume — successful tips only, local timezone buckets (`sqlCreatedAtLocal`).
- Top businesses by tips — `transaction.groupBy` on **success** in range, top 7.
- Subscription tier distribution — commercial intelligence (not Stripe payout data).

**Inconsistencies:**

| Element | Issue |
|---------|--------|
| `tipStatus` pie data | `groupBy` on **all** `Transaction.status` — **lifetime**, not `rangeDays` |
| `userDistribution` | Lifetime role counts |
| Tip volume / growth | Range-bound (7–120 days) |
| Timezone selector | Business analytics page allows TZ change; overview chart hardcodes Europe/Berlin in `PlatformOverviewSummaryCharts` |

---

# Payout Analytics Gap

### Authoritative data available (not surfaced in Business Analytics)

| Proposed metric | Supported? | Source | Formula / notes |
|-----------------|------------|--------|-----------------|
| Total payout volume (business) | Yes | `stripe_connect_payouts` | `SUM(amount_cents)` filter status |
| Total payout volume (employee) | Yes | `employee_stripe_payouts` | Same |
| Paid / pending / failed counts | Yes | `status` enum on both tables | `GROUP BY status` |
| Payout volume over time | Yes | `stripeCreatedAt` buckets | Daily `SUM` |
| Volume by business | Yes | `businessId` on both payout tables | Join `businesses.name` |
| Business vs employee payouts | Yes | Union or separate series | Label by table |
| Instant vs standard | Yes | `method` field | `instant` vs `standard` |
| CareTip-initiated every_3_days payouts | Yes | Payouts on manual-schedule accounts after `businessScheduledBankPayout` / `employeeScheduledBankPayout` | Identify via account schedule + payout timestamps (not in analytics UI) |
| Payout reconciliation state | Yes | `reconciliationStatus` on business payouts | Not charted |
| Failed payout rate | Yes | Derived | `failed / (failed+paid+…)` |
| Average payout amount | Yes | Derived | `AVG(amount_cents)` |
| “Scheduled vs manual” semantics | Partial | `Business.bankPayoutSchedule` + Stripe interval | Requires joining schedule table; **not in admin** |
| Tip GMV vs payout volume | Yes but **different events** | Tips vs payouts | Must not equate |

**Webhooks / sync:** `stripeConnectPayout.service.ts` — webhooks primary; list may trigger throttled Stripe list sync per business.

**Gap:** No admin chart/page aggregates `StripeConnectPayout` / `EmployeeStripePayout`; operators cannot see platform-wide payout trends alongside tip volume.

---

# Global Transactions Audit

**Page:** `GlobalTransactionsPage.tsx`  
**API:** `GET /api/platform/transactions` → `listGlobalTransactions` (`platform.service.ts`).

**Row backing:** `prisma.transaction.findMany` with `employeeTipPayable` join — each row is a real tip row when returned.

| Field | Source |
|-------|--------|
| Amount | `Transaction.amount` (EUR decimal) |
| Tip status | `Transaction.status` |
| CareTip fee | `employeeTipPayable.platformFeeCents / 100` or null |
| Net to staff | `employeeTipPayable.payableCents / 100` or null |
| Tip ledger column | `employeeTipPayable.status` or `no_payable` |
| Stripe PI | `stripePaymentIntentId` |

**Fee display:** UI always shows **current** `CARETIP_FEE_PERCENT` + fixed in `feeCell` text even when `caretipFeeEur` is null (`formatOptionalEur`) — can imply a fee was taken when no payable exists.

**Pagination:** `take` max **100**, default 50.

**Reconciliation sample logic (per row):**

- `amountEur` should match Stripe PI `amount_received` (minor units) at success time — verify via Stripe Dashboard using displayed PI id.
- `caretipFeeEur` should equal `calculateTipPlatformFeeCents(grossCents)/100` at creation unless historical fee rule change (stored cents win).
- `netToStaffEur` should equal `gross - platformFee` from payable row.
- Refunds: payable `refunded` status / `refundedCents`; parallel `TipRefund` row on Refunds page.
- Failed transfers: `transfer_failed` payable status.

**Legacy field:** `Transaction.payoutStatus` (`PayoutStatus`: paid/failed/pending/not_applicable) is **not** used by admin list.

---

# Ledger Status Semantics

**Enum:** `EmployeeTipPayableStatus` (`schema.prisma`).

| Current UI label (EN) | Actual meaning | DB value | Money location (typical) | Stripe transfer? | Trigger / model |
|----------------------|----------------|----------|--------------------------|------------------|-----------------|
| held platform | Platform-hold charge model; payable not yet released to employee Connect account | `held_platform` | Platform / pending release | No transfer yet | `EmployeeTipChargeModel.platform_hold` → `initialStatus` |
| held business | Funds attributed to business distribution path | `held_business` | Business-controlled pool | Depends on model | `destination_business` |
| destination settled | Direct-to-employee destination charge; employee share settled per Connect destination rules | `destination_settled` | Employee Connect balance (destination charge) | Destination charge path | `destination_employee` |
| transferring | Release in flight | `transferring` | In flight | Transfer pending | `employeeTipRelease.service` |
| transferred | CareTip transfer to employee Connect completed | `transferred` | Employee Connect balance | Yes (`tr_*`) | Successful transfer |
| transfer failed | Transfer failed | `transfer_failed` | Still platform-held or recoverable | Failed attempt | Stripe transfer error |
| refunded | Payable fully refunded | `refunded` | Reversed / refunded | Reversals | Refund/dispute processing |
| no payable | No `EmployeeTipPayable` row | — | N/A | — | Tip without payable (edge) |
| paid / pending (i18n only) | **Not used for payable enums** | — | — | — | Legacy `PayoutStatus` labels only |

**German:** Subtitle correctly says Tip-Ledger not Connect payouts; **no DE keys** for payable enums — falls back to English humanized snake_case.

### Recommended admin labels (precise, based on implementation)

| Current label | Recommended admin label (EN) |
|---------------|------------------------------|
| destination settled | Payable: destination charge (employee) |
| held platform | Payable: platform hold (awaiting release) |
| held business | Payable: business pool |
| transferred | Payable: transferred to Connect |
| transfer failed | Payable: transfer failed |
| transferring | Payable: transfer in progress |
| refunded | Payable: refunded |

---

# Refunds Audit

**Page:** `PlatformRefundsPage.tsx`  
**API:** `GET /api/platform/refunds` → `listTipRefunds` (`tipRefunds.service.ts`).

**SSOT:** `TipRefund` table — populated from Stripe refund and dispute webhooks; explicitly **not** failed tip payments.

| UI status | Meaning | Origin |
|-----------|---------|--------|
| Succeeded | Stripe refund completed | `TipRefundStatus.succeeded` from Stripe refund status |
| Failed | Refund failed | Stripe refund failed |
| Pending | In progress | Stripe pending |
| Won | **Dispute won by merchant** | `mapStripeDisputeStatus` → `won` |
| Lost | **Dispute lost by merchant** (or `charge_refunded`) — **not** “refund lost” | Stripe dispute outcome |
| Needs response | Open dispute | Stripe dispute |

**Reason column:** Stripe `reason` string (e.g. `fraudulent`, `requested_by_customer`) — mapped via `admin.refundsPage.reason.*`. **Fraudulent is a refund/dispute reason, not a status.**

**Visual hierarchy:** `refundStatusClass` applies `bg-success/15 text-success` for `succeeded` — lower contrast than failed states (`bg-red-100`); operators may perceive “Succeeded” as faint.

**Dates:** Refunds use **Europe/Berlin** in `formatRefundDate`; Global Transactions use same — consistent.

---

# Connect Payouts Audit

**Page:** `PlatformConnectPayoutsPage.tsx`  
**API:** `GET /api/platform/connect-payouts` → `listPlatformConnectActivity`.

**Row types:**

1. **Business bank/instant payout** — `StripeConnectPayout` (Stripe `po_*`).
2. **Employee payout** — `EmployeeStripePayout` (`ep_*` prefix).
3. **CareTip transfer** — `EmployeeTipPayable` with `ct_*` prefix (`platform_hold` transfers).

**Status column:** Stripe payout status for 1–2; payable mapped to payout-like status for transfers (`mapPayableStatus`).

**CareTip sync column:** `reconciliationStatus` — balance-transaction line sync for **business** payouts; employee payouts use `stripe_observed`; transfers use `ledger` / `pending` / `failed`.

**Merge pagination risk (critical for operations):**

- Fetches up to `window = min(skip + take, 10100)` from **each** stream, merges, sorts, then `slice(skip, skip + take)`.
- `total = businessTotal + employeeTotal + transferTotal` — **sum of independent totals**, not count of merged universe.
- Deep pages or skewed volumes → **missing rows** and **incorrect footer totals**.

---

# Payout Schedule Audit

**CareTip schedules:** `BusinessBankPayoutSchedule` — `daily`, `every_3_days`, `weekly`, `monthly`, `manual` on `Business` and employee Connect account rows.

**Stripe mapping** (`connectBankPayoutSchedule.core.ts`):

| CareTip | Stripe `interval` |
|---------|-------------------|
| daily | daily |
| weekly | weekly (Monday anchor) |
| monthly | monthly (day 1) |
| every_3_days | **manual** |
| manual | **manual** |

**Every 3 days execution:** `businessScheduledBankPayout.service.ts` / `employeeScheduledBankPayout.service.ts` + internal job `scheduled-bank-payout-tick` (cron ~5 min) → `stripe.payouts.create()` when due.

**Admin Connect Payouts page:** Does **not** display CareTip schedule, Stripe interval, `bankPayoutNextScheduledAt`, or “CareTip-scheduled vs Stripe-automatic”.

**Schema comment drift:** `StripeConnectPayout` model comment still says CareTip does not initiate payouts — **outdated** for `every_3_days` orchestration.

### Schedule reconciliation table (Admin — expected vs actual)

| Recipient | CareTip schedule (DB) | Stripe schedule | Next CareTip run | Admin shows? | Expected arrival on list |
|-----------|----------------------|-----------------|------------------|--------------|---------------------------|
| Business daily | `daily` | daily | N/A (Stripe auto) | No | Stripe `arrival_date` |
| Business every_3_days | `every_3_days` | manual | `bankPayoutNextScheduledAt` | No | Stripe `arrival_date` when `po_` exists |
| Business manual | `manual` | manual | null | No | Stripe when payout exists |
| Employee | same pattern on employee account | same | same | No | same |

**Admin accuracy:** Cannot verify schedule alignment from Admin alone — **gap**.

---

# Expected Arrival Audit

**Implementation chain:**

1. Stripe webhook / API → `parsePayoutObject` → `arrivalDate: unixToDate(obj.arrival_date)`.
2. Persisted on `StripeConnectPayout.arrivalDate` / `EmployeeStripePayout.arrivalDate`.
3. API → ISO string → `formatConnectPayoutDate` in UI (`toLocaleString` with browser/locale, **no fixed Europe/Berlin**).

**Not used for bank payout arrival:** CareTip `bankPayoutNextScheduledAt`, schedule heuristics, or frontend date arithmetic.

**CareTip transfers (`ct_*`):** `arrivalDate: null` → UI **"—"** (correct — no bank payout).

**Impossible ordering (Created after Expected arrival):** Can occur if Stripe `arrival_date` is date-only (midnight UTC) and `created` is later same calendar day in local display, or timezone display differences between columns (Created vs Arrival both use same formatter but Stripe dates may be date-granularity). Investigate per-row in Stripe Dashboard before treating as bug.

---

# Schedule Change Audit

**Change path:** `PATCH /api/connect/bank-payout-schedule` (manager) / employee-connect equivalent → `setBusinessBankPayoutScheduleForBusiness` updates DB + `syncStripeConnectAccountPayoutSchedule`.

**Recorded today:**

- Current schedule + `bankPayoutNextScheduledAt` on business/employee row.
- **No dedicated history table** (old/new schedule, actor, Stripe sync result).
- Platform `auditPlatformAccess` logs route access, not field-level schedule changes.

**Gap:** Cannot answer “who changed schedule when?” from Admin.

**Inconsistency risk:** If Stripe update fails after DB update (or vice versa) — `setBusinessBankPayoutScheduleForBusiness` awaits Stripe sync **before** DB update; partial failures depend on error handling at call site (worth regression-testing; not changed in this audit).

---

# Timezone Audit

| Surface | Storage | Display |
|---------|---------|---------|
| Tip `createdAt` | UTC (`DateTime`) | Global tx: **Europe/Berlin** |
| Analytics buckets | UTC bounds + `sqlCreatedAtLocal(tz)` | User-selected TZ on Business Analytics; overview charts Berlin |
| Refunds | UTC | **Europe/Berlin** |
| Connect payout created/arrival | Stripe unix → UTC Date | Locale `toLocaleString` (user/browser TZ) |
| Subscription “failed today” | UTC day boundaries | Widgets |

**Risk:** Connect payout timestamps may **differ in TZ interpretation** from Global Transactions (Berlin vs local).

---

# Data Freshness Audit

| Screen | Mechanism | Stale possible? | UI indicator |
|--------|-----------|-----------------|--------------|
| Overview stats | 45s cache | Yes | No |
| Analytics charts | 60s cache | Yes | No |
| Global transactions | Live DB read | Minimal | No |
| Refunds | Live DB | Minimal | Hint: Stripe events only |
| Connect payouts | DB + optional throttled Stripe sync on business list | Yes | “CareTip sync” = reconciliation, **not** last webhook time |
| Health | Live on load | No | Hero status |

**Recommendation:** Show `cachedAt` / `lastStripeEventCreated` on financial summaries where caches or webhooks apply.

---

# Cross-Page Reconciliation

**Example: one successful €60 platform-hold tip**

| Stage | Where admin sees it | Amount semantics |
|-------|---------------------|------------------|
| Payment success | Global Transactions | €60 gross; payable fee/net |
| Payable held | Global Transactions ledger column | `held_platform` |
| Transfer | Connect Payouts `ct_*` | Transferred cents |
| Employee bank payout | Connect Payouts `ep_*` | Payout amount ≠ tip amount (aggregated balance) |
| Business SaaS | Not on tip row | Subscription pages |

**Contradictions to avoid:**

- Equating **tip volume** (overview) with **payout volume** (Connect).
- Equating **ledger “destination settled”** with **Stripe payout paid**.
- Using **lifetime** tip status distribution on analytics with **30-day** tip volume chart.

**Overview “transactions” KPI** matches global list success count definition (same `tips` table).

---

# Security / Authorization Findings

| Check | Result |
|-------|--------|
| Platform routes | `requirePlatformAdmin` — DB-backed `SUPER_ADMIN` + `isPlatformAdmin` + active + email verified |
| JWT role claim | `requireAdminRoleClaim` accepts `SUPER_ADMIN` (frontend maps to `platform_admin`) |
| Business ID in query | Connect payouts / transactions accept `businessId` filter — **scoped to platform admin only** (not tenant self-service) |
| IDOR on payout detail | `getPlatformConnectActivity(id)` — prefix routes; platform-only router |
| Impersonation | Separate JWT type; platform admin acting as manager uses different routes |

**Note:** Frontend gate uses `platform_admin` string; backend uses `SUPER_ADMIN` — consistent via API normalization.

No evidence in this audit of client-controlled business IDs on **non-admin** routes exposing other tenants via platform endpoints.

---

# UI Clarity Findings

1. Global Transactions: subtitle clarifies ledger ≠ Connect payouts — **good**; column badges still confuse (humanized enums).
2. Refunds: status vs reason conflated in one column pair — data supports separation (`status` + `reason`).
3. Connect Payouts: mixes three event types in one table — **Type** column helps; transfers show "—" for arrival — good.
4. Active businesses KPI — **misleading label**.
5. Overview does not show **total tip volume EUR** despite API support.
6. `platformTotalsConsistent: true` in stats is **asserted in code**, not verified against independent rollup in UI.

---

# Critical Findings

### F1 — Global Transactions “Tip ledger” shows payable enums without proper i18n

- **Severity:** Critical (operational misunderstanding)
- **Page:** Global Transactions
- **Evidence:** `listGlobalTransactions` sets `payoutStatus: payable?.status`; UI keys only `paid|failed|pending|not_applicable` (`en.json` `admin.globalTransactionsPage.payoutStatus`).
- **Current behavior:** Displays `held platform`, `destination settled`, etc.
- **Authoritative source:** `EmployeeTipPayable.status`
- **Root cause:** Field named `payoutStatus` in API; i18n incomplete.
- **Risk:** Admins interpret as Stripe payout state.
- **Recommended fix:** Rename API field for admin (`payableStatus`); add full EN/DE enum labels; optional tooltip with charge model.
- **Files:** `platform.service.ts`, `GlobalTransactionsPage.tsx`, `platformAdminMobileCards.tsx`, `en.json`, `de.json`
- **Requires:** backend (response shape), UI, i18n — not DB.

### F2 — Connect Payouts merged list pagination / total integrity

- **Severity:** Critical at scale
- **Page:** Connect Payouts
- **Evidence:** `listPlatformConnectActivity` merge + `total` sum (`platformConnectActivity.service.ts` ~404–547).
- **Current behavior:** Incorrect totals and incomplete merged pages when streams differ in size.
- **Authoritative source:** Three tables independently correct; merge is flawed.
- **Risk:** Reconciliation audits miss payouts/transfers.
- **Recommended fix:** Unified SQL view or cursor-based merge from single query; honest `total` for merged feed.
- **Files:** `platformConnectActivity.service.ts`
- **Requires:** backend.

### F3 — Admin lacks payout schedule visibility

- **Severity:** Critical for payout schedule accuracy requirement
- **Page:** Connect Payouts / Business detail (admin)
- **Evidence:** No `bankPayoutSchedule` in `src/app/pages/platform/**`.
- **Current behavior:** Operators cannot verify every_3_days vs Stripe manual.
- **Risk:** Support assumes Stripe-native schedule incorrectly.
- **Recommended fix:** Admin read-only panel: CareTip schedule, Stripe interval, next run, last CareTip-initiated payout.
- **Files:** New admin API surface or extend business detail; schedule services already exist.
- **Requires:** backend + UI.

---

# High Priority Findings

### H1 — “Active businesses” ≠ fully operational businesses

- **Severity:** High
- **Page:** Admin Overview
- **Evidence:** `activeBusinessesCount = onboardingMetrics?.approved` (`AdminDashboard.tsx`); `getFullyVerifiedBusinessCount` unused.
- **Recommended fix:** Rename KPI or use verified+approved count.
- **Files:** `AdminDashboard.tsx`, i18n

### H2 — No payout analytics in Business Analytics

- **Severity:** High
- **Page:** Business Analytics
- **Evidence:** Only tip + subscription charts (`PlatformBusinessAnalyticsPage.tsx`).
- **Recommended fix:** Add aggregates from `StripeConnectPayout` / `EmployeeStripePayout` with clear labels.
- **Files:** New service methods + charts
- **Requires:** backend + UI

### H3 — Analytics `tipStatus` / user distribution are lifetime, charts are range-bound

- **Severity:** High
- **Page:** Business Analytics / charts using full analytics payload
- **Evidence:** `platformAnalytics.service.ts` `groupBy` without date filter.
- **Recommended fix:** Apply same `start`/`end` as tip volume or label widgets “All time”.
- **Files:** `platformAnalytics.service.ts`, chart components

### H4 — Fee cell shows formula when fee amount unknown

- **Severity:** High
- **Page:** Global Transactions
- **Evidence:** `feeCell` always includes percent+fixed; `caretipFeeEur` may be null.
- **Recommended fix:** Show “—” or “No payable” when null.
- **Files:** `GlobalTransactionsPage.tsx`

### H5 — No payout schedule change audit trail

- **Severity:** High
- **Page:** N/A (gap)
- **Evidence:** `setBusinessBankPayoutScheduleForBusiness` updates row only.
- **Recommended fix:** Append `subscription_events`-style audit or platform audit log entry with old/new schedule and Stripe result.
- **Files:** `businessBankPayoutSchedule.service.ts`, `employeeBankPayoutSchedule.service.ts`
- **Requires:** DB optional (audit table) or reuse events table

### H6 — Prisma comment: “CareTip does not initiate payouts”

- **Severity:** High (documentation / operator trust)
- **Evidence:** `schema.prisma` `StripeConnectPayout` header comment vs `businessScheduledBankPayout.service.ts`.
- **Recommended fix:** Update schema comment; admin docs.
- **Files:** `schema.prisma` (comment only)

---

# Medium Priority Findings

- **M1:** Stats/analytics caches without freshness indicator (45s/60s).
- **M2:** Connect payout dates use locale TZ; global tx use Berlin — inconsistent.
- **M3:** `Transaction.payoutStatus` legacy column still on row — risk if future UI uses it inconsistently.
- **M4:** Refund “Succeeded” low-contrast success styling (`PlatformRefundsPage.tsx`).
- **M5:** `platform:stats` `platformTotalsConsistent: true` is hard-coded, not computed.
- **M6:** Global transactions max `take` 100 — export/reconciliation may need server export.
- **M7:** CareTip transfers appear in “Connect Payouts” with payout-like status mapping — can blur transfer vs bank payout.

---

# Low Priority Findings

- **L1:** Overview hero does not surface `totalVolumeEur` from stats API.
- **L2:** Business list cache 10k cap for activity teaser — edge case for very large fleets.
- **L3:** German humanized payable labels missing (fallback English snake_case).

---

# Recommended Remediation Plan

1. **P0 — Ledger clarity:** Payable status i18n + API rename for admin consumers; no change to enum values.
2. **P0 — Connect list integrity:** Fix merge pagination/total; add tests with skewed stream sizes.
3. **P0 — Schedule transparency:** Admin read-only schedule + Stripe interval + next CareTip run; clarify every_3_days vs manual in copy.
4. **P1 — Payout analytics:** Server aggregates from payout tables; separate series from tip GMV.
5. **P1 — KPI definitions:** Align “active businesses” with onboarding vs verified labels.
6. **P1 — Analytics consistency:** Range-filter or label lifetime metrics.
7. **P2 — Freshness:** Cache timestamps; show last Stripe event on payout detail.
8. **P2 — Refund UI:** Separate status vs reason; strengthen succeeded contrast.
9. **P2 — Schedule audit:** Log schedule changes with actor and Stripe sync outcome.

---

# Final Verdict

| Dimension | Verdict |
|-----------|---------|
| **DATA INTEGRITY** | **PARTIAL** |
| **STRIPE RECONCILIATION** | **PARTIAL** |
| **PAYOUT ACCURACY** | **PARTIAL** (arrival dates from Stripe are correct; schedule orchestration invisible in Admin) |
| **LEDGER CLARITY** | **FAIL** |
| **REFUND STATUS CLARITY** | **PARTIAL** (data model clear; dispute `lost`/`won` easily misread; UI contrast) |
| **PAYOUT SCHEDULE ACCURACY** | **FAIL** (in Admin surface) |
| **TIMEZONE ACCURACY** | **PARTIAL** |
| **ADMIN UI CLARITY** | **PARTIAL** |

## Overall

**NOT READY — SPECIFIC DATA INTEGRITY ISSUES REQUIRE REMEDIATION**

Remediation should prioritize **ledger semantics**, **Connect activity list correctness**, and **payout schedule visibility** before further visual redesign. After P0 fixes, re-run spot reconciliation: sample tips from Global Transactions → Stripe PI → payable → transfer (`ct_`) → employee/business payout (`ep_`/`po_`) and compare amounts and statuses end-to-end.
