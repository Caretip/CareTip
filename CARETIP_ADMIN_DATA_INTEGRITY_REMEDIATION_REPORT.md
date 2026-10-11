# CARETIP — Admin Data Integrity Remediation Report

**Phase:** Data / financial remediation (no Admin visual redesign)  
**Reference audit:** `CARETIP_ADMIN_DATA_INTEGRITY_FORENSIC_AUDIT.md`

---

# Executive Summary

Remediation focused on **semantic accuracy**, **Connect activity pagination integrity**, **payout schedule visibility**, **payout analytics (separate from tips)**, **timezone policy for Admin financial timestamps**, **refund status vs reason clarity**, and **honest platform stats metadata**.

Stripe behavior, payout schedulers, webhooks, and `EmployeeTipPayable` enums were **not** changed.

---

# Findings Fixed

| Audit finding | Remediation |
|---------------|-------------|
| Global Transactions `payoutStatus` mislabeled as tip ledger / payout | API adds `payableStatus`; deprecated `payoutStatus` alias retained; EN/DE labels for all payable states |
| Connect Payouts merged list pagination/total | K-way merge pagination (`platformConnectActivityMerge.ts`) + regression script |
| Admin cannot see payout schedules | `GET /api/platform/businesses/:id/payout-schedule-context` + read-only panel on business detail |
| Expected arrival must stay Stripe-sourced | Unchanged: `arrival_date` via `parsePayoutObject`; transfers show `—` |
| Connect payout dates vs other Admin TZ | Platform Connect Payouts use `Europe/Berlin` via `ADMIN_FINANCIAL_TIMEZONE` |
| No payout analytics | `platformPayoutAnalytics.service.ts` + Business Analytics summary strip |
| `tipStatus` lifetime vs range charts | `tipStatus` now range-bound; `userDistributionScope` / `tipStatusScope` on API; UI note updated |
| “Active businesses” misleading KPI | Renamed to **Onboarding approved** + help tooltip |
| Fee formula shown when fee null | Shows **—** when no stored payable fee |
| Refunds: Lost / Fraudulent / Succeeded clarity | Stronger succeeded contrast; Lost labeled dispute; reason note in UI |
| `platformTotalsConsistent: true` hardcoded | Set to `null` with explanatory `platformTotalsConsistencyNote` |
| No schedule change audit | `writeAuditLog` on business/employee bank schedule changes |
| Stale Prisma comment on payouts | Updated to reflect CareTip `every_3_days` orchestration |
| Stats/analytics freshness opaque | `generatedAt`, `cacheTtlSeconds` on stats/analytics responses; KPI “data as of” line |

---

# Findings Intentionally Unchanged

- Stripe payout creation, webhooks, reconciliation jobs  
- `EmployeeTipPayableStatus` enum values (wording only in UI)  
- Connect Payouts still lists **three distinct event types** (business payout, employee payout, CareTip transfer)  
- Business manager / employee self-service schedule **write** paths (only added audit logging)  
- Full Admin UI redesign (deferred)

---

# Global Transactions

**Before:** Column “Tip ledger”; API field `payoutStatus` = `EmployeeTipPayable.status`; missing i18n for payable enums; fee cell always showed formula text.

**After:** Column **Employee payable**; primary field `payableStatus`; full EN/DE operator labels; hint text; fee shows **—** when `caretipFeeEur` is null.

**Why:** Separates employee payable lifecycle from Stripe bank payout status.

**Files:** `backend/src/services/platform.service.ts`, `GlobalTransactionsPage.tsx`, `platformAdminMobileCards.tsx`, `adminPayableStatus.ts`, `en.json`, `de.json`

---

# Connect Payouts

**Before:** Each stream fetched `skip+take` rows independently, merged, sliced — incorrect deep pages and honest total only if streams balanced.

**After:** `paginateMergedActivityRows` performs global sort merge with per-stream chunk fetch; total = sum of stream counts; page hydrated by ID.

**Why:** Financial reconciliation lists must paginate correctly at scale.

**Files:** `platformConnectActivityMerge.ts`, `platformConnectActivity.service.ts`, `stripeConnectPayout.service.ts` (`buildPlatformConnectPayoutListWhere`), `platform-connect-activity-merge-runtime.ts`

---

# Payout Schedule

**Before:** No Admin visibility into CareTip schedule vs Stripe interval vs next CareTip run.

**After:** Read-only `platformAdminPayoutSchedule.service.ts` + `PlatformBusinessPayoutSchedulePanel` on business detail. Distinguishes Stripe automatic vs CareTip scheduled (`every_3_days`) vs manual.

**Why:** Operators must not assume “Stripe pays every 3 days” when Stripe is `manual`.

**Files:** `platformAdminPayoutSchedule.service.ts`, `platform.controller.ts`, `platform.routes.ts`, `PlatformBusinessPayoutSchedulePanel.tsx`, `BusinessDetailPage.tsx`

---

# Expected Arrival

**Before → After:** Unchanged data path (Stripe `arrival_date` only). Platform UI now formats created/arrival in **Europe/Berlin** for consistency with Global Transactions and Refunds.

**Files:** `connectPayoutDisplay.ts`, `PlatformConnectPayoutsPage.tsx`, `adminFinancialTimezone.ts`

---

# Business Analytics

**Before:** Tips/growth only; no payout aggregates.

**After:** `payoutAnalytics` on `GET /api/platform/analytics` (business + employee Stripe payout tables, status breakdown, daily volume). `PlatformPayoutAnalyticsSummary` on Business Analytics page — explicitly **not** tip GMV.

**Files:** `platformPayoutAnalytics.service.ts`, `platformAnalytics.service.ts`, `PlatformPayoutAnalyticsSummary.tsx`, `PlatformBusinessAnalyticsPage.tsx`

---

# Refunds

**Before:** “Succeeded” low contrast; “Lost” ambiguous; fraudulent mixed with status mentally.

**After:** Succeeded uses solid success badge; Lost tooltip + “(dispute)” label; page note that **reason** (e.g. fraudulent) ≠ **status**.

**Files:** `PlatformRefundsPage.tsx`, `en.json`, `de.json`

---

# Timezones

**Policy:** Platform Admin **financial** timestamps use **`Europe/Berlin`** (`ADMIN_FINANCIAL_TIMEZONE`) for Global Transactions, Refunds, Connect Payouts (admin), payout schedule next-run display, and KPI data-as-of line. Analytics day buckets continue to use the selected analytics timezone.

**Documented in:** `adminFinancialTimezone.ts`

---

# Freshness

- `GET /api/platform/stats` → `generatedAt`, `cacheTtlSeconds: 45`  
- `GET /api/platform/analytics` → `generatedAt`, `cacheTtlSeconds: 60`  
- Overview KPI footnote when `generatedAt` present  

“CareTip sync” on Connect Payouts remains **reconciliation state**, not a webhook timestamp (unchanged).

---

# Audit Trail

**Before:** Schedule changes updated DB only.

**After:** `writeAuditLog` with actions `business_bank_payout_schedule_changed` and `employee_bank_payout_schedule_changed` (actor, old/new schedule, next run, timezone, stripe sync result).

**Files:** `businessBankPayoutSchedule.service.ts`, `employeeBankPayoutSchedule.service.ts`, `connect.controller.ts`, `employeeConnect.controller.ts`

---

# Tests

| Test | Result |
|------|--------|
| `backend/scripts/platform-connect-activity-merge-runtime.ts` | OK |
| `backend` `tsc --noEmit` | OK |
| `backend/scripts/financial-p0-remediation-runtime.ts` | Updated for `payableStatus` (run when DB available) |

---

# Files Changed (summary)

**Backend:** `platform.service.ts`, `platformConnectActivity.service.ts`, `platformConnectActivityMerge.ts`, `stripeConnectPayout.service.ts`, `platformAnalytics.service.ts`, `platformPayoutAnalytics.service.ts`, `platformAdminPayoutSchedule.service.ts`, `platformBusinessList.service.ts`, `platform.controller.ts`, `platform.routes.ts`, `businessBankPayoutSchedule.service.ts`, `employeeBankPayoutSchedule.service.ts`, `connect.controller.ts`, `employeeConnect.controller.ts`, `schema.prisma` (comment), `financial-p0-remediation-runtime.ts`, `platform-connect-activity-merge-runtime.ts`

**Frontend:** `GlobalTransactionsPage.tsx`, `platformAdminMobileCards.tsx`, `adminPayableStatus.ts`, `adminFinancialTimezone.ts`, `connectPayoutDisplay.ts`, `PlatformConnectPayoutsPage.tsx`, `PlatformRefundsPage.tsx`, `AdminDashboard.tsx`, `BusinessDetailPage.tsx`, `PlatformBusinessAnalyticsPage.tsx`, `PlatformBusinessPayoutSchedulePanel.tsx`, `PlatformPayoutAnalyticsSummary.tsx`, `api.ts`, `en.json`, `de.json`

---

# Database Changes

None (audit log uses existing `auditLog` table).

---

# Stripe Changes

None.

---

# API Changes

- `GET /api/platform/transactions` — adds `payableStatus`; `payoutStatus` deprecated alias  
- `GET /api/platform/stats` — `generatedAt`, `cacheTtlSeconds`, `platformTotalsConsistent: null`, `platformTotalsConsistencyNote`  
- `GET /api/platform/analytics` — `payoutAnalytics`, scopes, `generatedAt`  
- `GET /api/platform/businesses/:id/payout-schedule-context` — **new**  
- `GET /api/platform/onboarding/metrics` — includes `fullyVerified` from service  

---

# Remaining Risks

1. **Connect activity hydration** loads full payout DTOs per business row on each page (N+1 Stripe reconcile on detail fetch) — acceptable for admin page size but watch latency.  
2. **Payout schedule panel** loads Stripe account settings per employee when many staff — capped at 200 employees.  
3. **Integration tests** for live DB merge across real `stripe_connect_payouts` / `employee_stripe_payouts` volumes recommended in staging.  
4. **Fully verified** KPI not on overview grid yet — available in onboarding metrics API for future teaser.

---

# FINAL STATUS

**READY FOR ADMIN UI REDESIGN**

P0 data-integrity remediation is complete. Proceed with premium Admin visual redesign only after staging validation of Connect pagination and payout schedule panel against known businesses (`every_3_days`, manual, daily).
