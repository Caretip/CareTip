# CARETIP — Employee Pending Balance Terminology & UX Clarification Report

**Date:** 2026-09-30  
**Scope:** User-facing copy and i18n only (per forensic audit)

---

## 1. Before terminology

| Surface | Label | Supporting copy |
|---------|--------|-----------------|
| Analytics KPI | Pending release | Earnings not yet transferred to Stripe |
| Analytics footnote (period ≠ all) | — | Paid and pending are lifetime totals |
| Analytics Stripe section | Pending | (inline under Stripe balance) |
| Payout / Connect KPI | Pending | These funds are still settling with Stripe… |
| Payout / Connect KPI | Available balance | Stripe standard available balance. |

**Issue:** Bare **“Pending”** on Payout and Analytics Stripe sections was easy to confuse with **Pending release** (CareTip ledger).

---

## 2. After terminology

| Surface | Label | Supporting copy |
|---------|--------|-----------------|
| Analytics KPI | Pending release *(unchanged)* | Earnings not yet transferred to **your Stripe account** |
| Analytics footnote | — | **Paid to Stripe and pending release** are lifetime totals |
| Analytics Stripe section | **Pending at Stripe** | *(unchanged structure; label only)* |
| Payout / Connect KPI | **Pending at Stripe** | These funds **have reached your Stripe account** but are still settling… |
| Payout / Connect KPI | Available balance | **Available for payout from Stripe.** |

**German:** Distinct **Ausstehende Freigabe** (CareTip) vs **Ausstehend bei Stripe** (Stripe balance); hints clarify CareTip transfer vs settlement on Connect.

---

## 3. Files changed

| File | Change |
|------|--------|
| `src/i18n/locales/en.json` | Employee analytics + payouts dashboard strings |
| `src/i18n/locales/de.json` | Same keys, DE copy |
| `src/app/components/employee/employeePendingBalanceTerminology.runtime.ts` | **New** — terminology + wiring checks |
| `package.json` | `test:employee-pending-balance-terminology` script |

**Not modified:** `EmployeeAnalyticsPage.tsx`, `EmployeePayoutDashboardMetrics.tsx`, hooks, API, backend services, Stripe calls, calculations.

---

## 4. i18n keys updated

**`employee.analytics`**

- `pendingReleaseHint`
- `paidPendingLifetime`
- `stripePending`

**`employee.payouts.dashboard`**

- `kpiAvailableHint`
- `kpiPending`
- `kpiPendingHint`

Business manager payout workspace strings (`business.stripe.payoutsWorkspace.business.*`) were **not** changed (out of employee scope).

---

## 5. Financial logic untouched

Confirmed:

- `pendingReleaseEur` still from `lifetimeMetrics` / `loadEmployeeFinancialMetrics` (ledger).
- `pendingCents` still from instant payout eligibility / Stripe `Balance.pending`.
- No merging, subtraction, or cross-calculation between the two metrics.
- Lifetime vs period behavior unchanged.

---

## 6. Tests run

| Command | Result |
|---------|--------|
| `npm run test:employee-pending-balance-terminology` | OK |
| `npm run test:employee-analytics-tip-record-presentation` | OK (regression) |

Runtime test asserts:

1. EN payout label is not bare “Pending” and matches analytics `stripePending`.
2. DE Stripe-pending label ≠ pending-release label.
3. Analytics page still binds KPIs to `pendingReleaseEur` and Stripe section to `stripe.pendingCents`.
4. Payout metrics still use `eligibility?.pendingCents` only.

---

## 7. Responsive verification

Changes are **text-only** (slightly longer EN/DE labels: “Pending at Stripe”, longer hints). No layout/CSS/component structure changes.

**Manual check recommended** at 320–430px and desktop: payout metric strip and analytics summary cards — longer German “Ausstehend bei Stripe” should still fit existing `PayoutFinancialMetric` / summary card patterns. No redesign was performed.

---

## 8. Remaining UX considerations

- **Dashboard hero** still shows **Pending release** only (no Stripe pending) — consistent with ledger metric; employees comparing hero to Payout page should use Analytics Stripe section or Connect page for **Pending at Stripe**.
- **Transfer status** block still uses “Pending release” for ledger reconciliation — correct per audit.
- Optional future: short tooltip linking “Pending release €0” to “see Pending at Stripe on Payouts” when both surfaces differ (not implemented in this pass).

---

## Final status

**READY — PENDING BALANCE TERMINOLOGY CLARIFIED**
