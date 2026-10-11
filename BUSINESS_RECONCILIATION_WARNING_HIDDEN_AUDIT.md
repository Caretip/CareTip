# Business Reconciliation Warning Hidden — Audit Report

**Date:** 2026-09-24  
**Scope:** Presentation-only hide of business-facing reconciliation UI  
**Change type:** Frontend UI only — no backend, financial, or employee changes

---

## 1. Where the warning was found

A full search of the business dashboard surface found **one** business-user-facing reconciliation presentation:

| Location | File |
|----------|------|
| Business Tips Analytics → Financial tab → Stripe Account section (below metrics) | `src/app/components/business/BusinessFinancialAnalyticsSection.tsx` |

**Parent page:** `BusinessAnalyticsReporting.tsx` renders `BusinessFinancialAnalyticsSection` on the Business Analytics & Reports flow.

**i18n keys (unchanged, now unused in business UI):**

- `business.tips.analytics.financial.reconciliationAria`
- `business.tips.analytics.financial.reconciliationTitle`
- `business.tips.analytics.financial.reconciliationAttention` — *"Some CareTip and Stripe records need attention."*
- `business.tips.analytics.financial.reconciliationIncomplete`
- `business.tips.analytics.financial.reconciliationOk`
- `business.tips.analytics.financial.reconciliationPartialOk`

No other business dashboard components, hooks, or pages referenced these keys or rendered `data.reconciliation` for business users.

---

## 2. Component responsible

**`BusinessFinancialAnalyticsSection`**

Previously rendered a dedicated `<section>` after the Stripe Account metrics grid with:

- Heading: **RECONCILIATION** (`reconciliationTitle`)
- Amber warning banner when `data.reconciliation.needsAttention === true`
- Green “consistent” message when reconciliation data existed without attention flag
- Loading skeleton while `reconciliationLoading` was true

---

## 3. Condition that caused the warning

```tsx
data?.reconciliation?.needsAttention === true
```

Data source:

- Hook: `useBusinessFinancialSummary(enabled, period, { progressive: true, includeReconciliation: true })`
- API: `getBusinessFinancialSummary(period, { section: "reconciliation" })` (progressive second fetch)
- Response field: `BusinessFinancialSummaryBundle.reconciliation.needsAttention`

Additional copy branches when `reconciliation.complete === false` (incomplete batch examination).

---

## 4. What UI was hidden

The entire reconciliation `<section>` (lines 210–241) was removed from render.

A feature flag was added for future reintroduction:

```ts
const SHOW_BUSINESS_RECONCILIATION_UI = false;
```

When `false`:

- Reconciliation section is not rendered (no warning, no OK message, no loading skeleton)
- `includeReconciliation` is not requested from `useBusinessFinancialSummary` (avoids unnecessary business-facing fetch; backend endpoint unchanged)

**Still visible (unchanged):**

- Stripe Account: Available balance, Pending balance, Bank payouts (completed)
- Period summary, routing, tip growth, QR analytics, hero financial metrics, etc.

---

## 5. Backend reconciliation remains active

**No backend files were modified.**

Unchanged services and scripts include:

- `backend/src/services/businessPayoutReconciliation.service.ts`
- `backend/scripts/business-payout-reconciliation-runtime.ts`
- Business financial summary API reconciliation section (`section: "reconciliation"`)

Backend continues to compute and return reconciliation data when requested.

---

## 6. Platform / Admin reconciliation remains available

**No platform admin files were modified.**

Platform surfaces still expose reconciliation, for example:

- `src/app/pages/platform/revenue/PlatformConnectPayoutsPage.tsx` — `reconciliationStatus` filters and badges
- `src/app/components/connect/ConnectPayoutDetailDialog.tsx` — payout reconciliation status
- `src/app/lib/connectPayoutDisplay.ts` — reconciliation status i18n keys

---

## 7. Employee Transfer Status — NOT changed

**No employee files were modified.**

Untouched implementations:

- `EmployeeTransferStatusCard.tsx`
- `employeeTransferStatusPresentation.ts`
- `EmployeeAnalyticsPage.tsx` reconciliation / transfer-status section
- `useEmployeeAnalytics.ts` transfer-status derivation

---

## 8. Financial calculations — NOT changed

No changes to:

- Stripe balance, payout, or transfer logic
- Business distribution calculations
- Hero metrics (`BusinessHeroFinancialMetrics`)
- `EmployeeTipPayable`, `Transaction`, or ledger services
- Authentication, routing, or session handling

---

## 9. Tests performed

| Test | Result |
|------|--------|
| `npm run typecheck` (frontend) | **PASS** |
| `npm run test:business-payout-reconciliation` (backend) | **PASS** — `business-payout-reconciliation-runtime: OK` |
| `employeeTransferStatusPresentation.runtime.ts` | **PASS** — `employee-transfer-status-presentation: OK` |

Frontend build was not run (typecheck sufficient for this one-component change).

---

## 10. Typecheck / build

- **Typecheck:** PASS (`tsc --noEmit`)
- **Build:** Not run (optional; no type errors)

---

## 11. Remaining business-facing reconciliation references

| Reference | Status |
|-----------|--------|
| `BusinessFinancialAnalyticsSection.tsx` reconciliation section | **Hidden** (`SHOW_BUSINESS_RECONCILIATION_UI = false`) |
| `useBusinessFinancialSummary` `includeReconciliation` option | Still exists; not enabled for business analytics UI |
| i18n keys under `business.tips.analytics.financial.reconciliation*` | Present in locale files; not rendered to business users |
| Backend reconciliation API | Active; simply not requested by hidden UI |

No substitute warnings were added.

---

## Re-enable instructions (future)

Set `SHOW_BUSINESS_RECONCILIATION_UI = true` in `BusinessFinancialAnalyticsSection.tsx` and restore the reconciliation `<section>` block (or reintroduce from git history).
