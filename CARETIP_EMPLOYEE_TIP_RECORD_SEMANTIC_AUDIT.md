# CareTip Employee Tip Record Semantic + UX Audit

**Date:** 2026-09-28  
**Scope:** Employee tip record cards (CareTip tip records) — primary surface: **Employee → Analytics** (`EmployeeAnalyticsPage`). Tip activity detail dialog aligned where the same confusion existed.

---

## 1. Current data flow

| Layer | Location |
|-------|----------|
| UI | `src/app/pages/employee/EmployeeAnalyticsPage.tsx` (mobile cards + desktop table) |
| Hook | `src/app/hooks/useEmployeeAnalytics.ts` → `getEmployeeAnalytics()` |
| API | `GET /api/me/employee-analytics` (`src/app/lib/api.ts`) |
| Service | `backend/src/services/employeeAnalytics.service.ts` |
| DB | `tips` + `employee_tip_payables` (Prisma `transaction` + `employeeTipPayable`) |
| Routing | `employeeTipPayable.routingMode` (`direct_to_employee` \| `business_distribution`) |
| Status | Payable `status` + analytics mapper `payoutStatusLabel()` |

Nav: Employee Dashboard links to analytics via hero financial panel (`/employee/analytics`). Tip records section title: **CareTip tip records**.

---

## 2. Meaning of each displayed field

| UI label | Backend source | Meaning |
|----------|----------------|---------|
| **Gross** | `tip.amount` → `grossEur` | Customer tip before fees (successful tip). |
| **CareTip fee** | `employeeTipPayable.platformFeeCents` → `platformFeeEur` | Platform fee on the payable; `null` if no payable. |
| **Your earnings** | `directEmployeeEarningsEur(payable)` → `employeeEarningsEur` | Employee **direct** share: `max(0, payableCents - refundedCents) / 100` only when `routingMode === direct_to_employee`; **`null` for business_distribution** (no direct employee payable). |
| **Routing** | `employeeTipPayable.routingMode` | Where CareTip routes the tip: business pool vs employee Stripe path. |
| **Status** | `payoutStatusLabel(routingMode, payable.status, hasPayable)` | Lifecycle label for the payable (not a duplicate of routing). For `business_distribution`, backend returns synthetic key `paid_to_business` (tip completed via business routing). |

---

## 3. Source field / calculation (per field)

- **Gross:** `mapTipToAnalyticsRecord` — `Math.round(Number(tip.amount) * 100) / 100`.
- **Fee:** `payable.platformFeeCents / 100`.
- **Your earnings:** `employeeAnalytics.service.ts` → `directEmployeeEarningsEur()` — excludes business-distribution payables from direct earnings (matches period KPI SQL).
- **Routing:** `payable.routingMode` enum string.
- **Status:** `payoutStatusLabel()` — e.g. `transferred`, `pending_release`, `paid_to_business`, `legacy_no_payable`.

---

## 4. Root cause of repeated “Paid to business”

1. **Your earnings (UI bug):** `formatEarningsCell()` in `EmployeeAnalyticsPage` returned `t("employee.analytics.routingBusiness")` when `routingMode === business_distribution` instead of a **monetary** value.
2. **Routing:** `routingBusiness` i18n was **“Paid to business”** (status-like sentence) rather than a short **destination** label.
3. **Status:** Backend `payoutStatusLabel()` correctly emits `paid_to_business` for business-routed tips; i18n also translated that string as **“Paid to business”**.

Same phrase appeared three times with **different intended semantics** (earnings vs destination vs lifecycle).

---

## 5. Was “Your earnings” semantically incorrect?

**Yes, in the UI only.** The label implies money; showing a routing sentence was wrong. The **data model** is correct: `employeeEarningsEur: null` means no direct employee share. Presentation now shows **`€0,00`** (null → 0 for display) without changing calculations or API contracts.

---

## 6. UI changes made

| Area | Change |
|------|--------|
| `employeeAnalyticsTipRecordPresentation.ts` | SSOT for earnings EUR, routing i18n keys, status tone. |
| `EmployeeAnalyticsPage.tsx` | Monetary earnings; `routingDestination.*` labels; `FinanceStatusPill` for status. |
| `EmployeeTipActivityDetailDialog.tsx` | Earnings always EUR; routing row separate; fee shown for business-routed tips. |
| `en.json` / `de.json` | `routingDestination.business` / `stripe`; `paid_to_business` → “Completed” / “Abgeschlossen”; tip activity detail routing labels shortened. |
| `employee-analytics.css` | Status row spacing for badge. |
| Tests | `npm run test:employee-analytics-tip-record-presentation` |

---

## 7. States tested (mapping)

| Scenario | Earnings | Routing | Status (i18n key) |
|----------|----------|---------|-------------------|
| Business-routed tip | €0,00 | Business | `paid_to_business` → Completed |
| Direct, transferred | EUR amount | Your Stripe | `transferred` |
| Direct, pending | EUR amount | Your Stripe | `pending_release` |
| Direct, failed release | EUR amount | Your Stripe | `release_failed` |
| Legacy no payable | €0,00 | unknown/— | `legacy_no_payable` |

Backend statuses unchanged; UI maps additional keys (`held_platform`, `transferring`, etc.) where returned.

---

## 8. Localization

- EN + DE updated for destination and status wording.
- No new hardcoded strings in components.

---

## 9. Mobile verification

Existing e2e: `e2e/employee-analytics-mobile-overflow.spec.ts` (320–430px). Mock business-routed record updated to realistic `paid_to_business` status. Layout unchanged (2-column grid + full-width status badge).

---

## 10. Tests executed

| Command | Result |
|---------|--------|
| `npm run test:employee-analytics-tip-record-presentation` | **Pass** |
| `npm run typecheck` | **Pass** |

---

## 11. Build result

Run `npm run build` on CI/release (not re-run in this pass; typecheck clean).

---

## 12. Backend / data issues (not changed)

None identified. `paid_to_business` as a **status label key** for business-routed tips is intentional server-side; only **client copy and earnings cell** were wrong.

---

## Before / after

| Field | Before | Actual meaning | Final presentation |
|-------|--------|----------------|-------------------|
| Gross | €50,00 | Customer tip gross | €50,00 (unchanged) |
| CareTip fee | €5,49 | Platform fee | €5,49 (unchanged) |
| Your earnings | “Paid to business” | Direct employee share (null → none) | **€0,00** |
| Routing | “Paid to business” | `business_distribution` | **Business** (DE: Betrieb) |
| Status | “Paid to business” | Completed via business routing | **Completed** badge (DE: Abgeschlossen) |

---

## Other surfaces

- **Tip activity list** (`EmployeeTipActivityPage`): list rows use event titles (e.g. “Paid to business” for `held_venue`) — appropriate for **event type**, not the analytics grid. Detail dialog aligned with analytics semantics.
- **Payout activity teasers** (`EmployeePayoutActivityList`): separate payable-activity model; unchanged.

---

**Principle:** Each label answers a different question — amount, destination, lifecycle — without reusing the same sentence.
