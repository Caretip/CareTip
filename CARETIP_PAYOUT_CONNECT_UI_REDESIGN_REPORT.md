# CareTip Payout & Connect UI Redesign Report

**Date:** 2026-09-27  
**Scope:** Presentation-only redesign for Business Stripe Payout History (`ConnectPayoutsPanel`) and Employee Stripe Connect (`EmployeePaymentsConnectPage` and related components).  
**Out of scope (unchanged):** Stripe API integration, payout/instant eligibility logic, fee calculations, consent requirements, backend routes, auth, database.

---

## 1. Business Payout History changes

**Primary file:** `src/app/components/business/settings/billing/ConnectPayoutsPanel.tsx`

- Wrapped the Business tab in `caretip-payout-workspace` for shared financial styling.
- Replaced three large icon KPI cards with a **single metric strip** (Available → Pending → Instant available) using shared `PayoutFinancialMetricStrip` / `PayoutFinancialMetric`.
- **Recent payouts** uses `PayoutWorkspacePanel`, ledger toolbar classes, and `caretip-payout-ledger` table hover/dividers; mobile rows use `caretip-payout-mobile-record` instead of generic mobile cards.
- **Instant payout** rail uses `PayoutWorkspacePanel`, smaller hero amount (`caretip-payout-instant-amount`), and `PayoutInstantBreakdown` (gross − fee = net). Consent checkbox and CTA disable rules unchanged.
- **Payout destination** replaces the purple gradient bank card with `BusinessPayoutDestinationSection` + `PayoutDestinationCard` (masked last4, default badge, optional “change payout method” via existing Stripe dashboard link).
- Desktop layout: `caretip-payout-layout` — ledger main column, compact rail (instant + destination). Mobile: ledger first, then rail (no order swap).

Page chrome (title/subtitle, CareTip/Business toggle) remains in `BusinessStripeLayout` / `BusinessStripePages.tsx`.

---

## 2. Employee Connect changes

**Primary files:**

- `src/app/pages/employee/EmployeePaymentsConnectPage.tsx`
- `src/app/components/employee/EmployeePayoutDashboardMetrics.tsx`
- `src/app/components/employee/EmployeePayoutAccountCard.tsx`
- `src/app/components/employee/EmployeeInstantPayoutCard.tsx`
- `src/app/components/employee/EmployeeStripeBankPayoutList.tsx`
- `src/app/components/employee/EmployeePayoutMethodCard.tsx`

- Page root uses `caretip-payout-workspace`.
- **Metrics:** same strip pattern as business (Available, Pending, Instant), no Lucide icon tiles.
- **Layout:** payout history panel is the main column; right rail holds instant payout + Connect/account status (employee-specific hierarchy: status → destination → actions).
- **Account card (rail):** status pill with explicit “Status” label; payout destination in compact `PayoutDestinationCard`; change account as text link when allowed.
- **Instant payout (rail):** aligned with business instant panel (breakdown component, restrained typography).
- **Bank payout list (panel):** `PayoutWorkspacePanel`, ledger styling, responsive mobile records.

Employee page header (`EmployeePageHeader`) and all Connect/onboarding API flows are unchanged.

---

## 3. Shared components introduced / reused

| Component | Path |
|-----------|------|
| `PayoutFinancialMetric` / `PayoutFinancialMetricStrip` | `src/app/components/finance/payout/PayoutFinancialMetric.tsx` |
| `PayoutWorkspacePanel` | `src/app/components/finance/payout/PayoutWorkspacePanel.tsx` |
| `PayoutDestinationCard` | `src/app/components/finance/payout/PayoutDestinationCard.tsx` |
| `PayoutInstantBreakdown` | `src/app/components/finance/payout/PayoutInstantBreakdown.tsx` |
| `payoutWorkspaceClasses` | `src/app/components/finance/payout/payoutWorkspaceClasses.ts` |
| Styles | `src/styles/payout-workspace.css` (imported via `src/styles/bundles/dashboard.css`) |

**Still reused (logic/display unchanged):** `ConnectPayoutBadges`, `ConnectPayoutDetailDialog`, `connectPayoutDisplay`, `InstantPayoutTermsCheckbox`, `FinanceStatusPill`, existing presentation helpers (`businessPayoutMetricsPresentation`, `employeePayoutMetricsPresentation`, `employeeInstantPayoutPresentation`, `employeePayoutAccountPresentation`).

No single mega-component with role conditionals — composition stays in business vs employee parents.

---

## 4. Role-specific differences

| Area | Business | Employee |
|------|----------|----------|
| Primary focus | Balances, payout ledger, instant payout to business Stripe | Connect readiness, status, destination, employee bank payout history |
| Main column | Filterable Connect payout history + View in Stripe | Recent bank payouts + link to full history |
| Rail | Instant payout + business payout destination | Instant payout (when routing allows) + Connect/account card |
| Setup empty state | Link to `/dashboard/stripe/connect` | Hint to use account card CTA |
| Extra chrome | CareTip vs Business workspace tabs | Page header + optional business-distribution notice |

---

## 5. Responsive changes

- Metric strip stacks on small screens with dividers; three columns from `sm`/`640px`.
- Two-column layout from `1280px` (`caretip-payout-layout`); single column below with ledger/history before rail.
- Tables retain horizontal scroll wrappers where needed; mobile uses stacked financial records.
- Filter controls use shared toolbar min-heights; no transform-based alignment.

---

## 6. Accessibility

- Preserved semantic sections, table captions, `sr-only` search labels, status pills (not color-only), checkbox IDs for instant terms, `aria-busy` on loading metrics, button types for ledger row actions.
- Focusable links/buttons for Stripe dashboard and change-method actions unchanged.

---

## 7. Localization

- **No new i18n keys.** All UI strings remain existing `business.*`, `business.stripe.payoutsWorkspace.*`, and `employee.payouts.*` entries (EN/DE).
- Verified script: `scripts/payout-ux-i18n.unit.ts` (pending-hint strings).

---

## 8. Financial / Stripe logic confirmation

**Not modified:**

- `listMyConnectPayouts`, `getInstantPayoutEligibility`, `createInstantPayout`, `createConnectLoginLink`
- Employee Connect status, instant payout create/eligibility APIs
- Fee/gross/net field sources, eligibility reasons, consent `terms.version` gating
- Pagination, filters, idempotency keys, confirm dialog flow

---

## 9. Tests executed

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass |
| `npx tsx scripts/payout-ux-i18n.unit.ts` | Pass |

---

## 10. Build result

| Step | Result |
|------|--------|
| `vite build` | Pass (`✓ built in 2m 25s`) |

Full `npm run build` also runs `prerender-public-seo-html.ts` after Vite; run locally if you need prerender confirmation.

---

## 11. Remaining UI limitations

- Business payout table columns unchanged (still driven by existing `ConnectPayout` fields — no invented destination column).
- Employee bank history remains read-only list (no new detail dialog).
- CareTip tab (`BusinessPayoutsCareTipView`) was not restyled in this pass; only the Business Stripe tab uses the new workspace.
- Live visual QA blocked when DB/Supabase is unreachable (login); verify in browser once backend is available.

---

## Audit summary (pre-redesign)

| Topic | Finding |
|-------|---------|
| Shared UI | Both roles used similar 2-col grid, `rounded-2xl` cards, icon KPI triplets, purple gradient destination card, instant panel with large type |
| Stripe-sourced data | Payout rows, balances, instant eligibility, destination last4/kind, payout statuses |
| CareTip-sourced data | Filters, consent copy paths, employee Connect phase copy, business distribution mode |
| Shared vs role | Display formatters/badges shared; business has full Connect payout ledger + confirm dialog; employee has Connect account card + bank payout list |
| Risk addressed | Replaced duplicated visual layout with shared **presentation** primitives while keeping role-specific composition |
