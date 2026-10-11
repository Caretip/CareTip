# Employee Tip Activity Redesign Audit

**Date:** 2026-09-24  
**Route:** `/employee/tip-history` (unchanged URL; experience renamed to Tip Activity)

---

## 1. Current Tip History Problem

The previous page (`TipsActivityPage` variant `employee-history`) duplicated Employee Analytics:

- Table of amount, date/time, location, payment status
- Same financial ledger feel as analytics tip records
- No clear answer to *"what happened to each tip?"*
- Overlapped with analytics KPIs, charts, and reconciliation

Employees had little reason to open Tip History separately from Analytics.

---

## 2. New Activity Design

**Tip Activity** is a chronological activity feed built from authoritative `EmployeeTipPayable` rows joined to `Transaction` context (location, table, receipt, tip timestamp).

- Timeline grouped **Today / Yesterday / Older**
- Human-readable event titles (tip received, transferred, paid to business, etc.)
- Venue/table context where available
- Supporting lines for earnings after fee, transfer status, business routing
- Filters: All · Tips received · Transfers · Pending · Issues
- Tap-to-open detail dialog (amount, location, date, fee, earnings, routing, status, reference)
- Refresh button + existing safe `tip.received` socket catch-up (not a new websocket system)

**Not included:** KPI cards, charts, period analytics, or financial reconciliation (remains on Analytics).

---

## 3. Data Sources Used

| Source | Role |
|--------|------|
| `EmployeeTipPayable` | Authoritative entitlement, routing, frozen `platformFeeCents`, transfer status |
| `Transaction` (join) | Tip timestamp, receipt, location/table names |
| `employeePayablePresentationKind` (backend) | Deterministic activity kind |
| `employeePayoutActivityKind` (frontend) | Same mapping reused from payouts |

**Not used:** Recalculated fees, `Transaction.payoutStatus`, Stripe API on page load, analytics bundle.

---

## 4. Activity Types Implemented

Mapped from existing `EmployeePayablePresentationKind` / payable status:

| Kind | User-facing event | Supported |
|------|-------------------|-----------|
| `held` | Tip received | ✅ |
| `held_venue` | Paid to business | ✅ (`business_distribution`) |
| `transferring` | Transfer in progress | ✅ |
| `transferred` | Transferred to Stripe | ✅ |
| `destination_routed` | Payment confirmed | ✅ |
| `refunded` | Tip refunded | ✅ |
| `failed` | Transfer failed | ✅ |
| `disputed` | Payment under review | ✅ (`disputedOpenCents > 0`) |

Partial refunds surface via frozen `refundedCents` / `payableCents` on the detail view — no separate fabricated event type.

---

## 5. API / Backend Changes

**Extended** `GET /api/me/employee-connect/payables` (existing endpoint):

- New fields per item: `grossCents`, `platformFeeCents`, `transactionId`, `transactionCreatedAt`, `receiptNumber`, `locationName`, `tableName`
- Optional query `filter`: `all` | `tips` | `transfers` | `pending` | `issues`

**Files:**

- `backend/src/services/employeeTipPayable.service.ts`
- `backend/src/controllers/employeeConnect.controller.ts`
- `src/app/lib/api.ts`

No new endpoint. No schema migration. No financial formula changes.

---

## 6. UI Changes

| File | Change |
|------|--------|
| `src/app/pages/employee/EmployeeTipActivityPage.tsx` | New timeline feed page |
| `src/app/pages/employee/EmployeeTipHistoryPage.tsx` | Routes to Tip Activity |
| `src/app/components/employee/EmployeeTipActivityDetailDialog.tsx` | Detail modal |
| `src/app/lib/employeeTipActivityPresentation.ts` | Grouping, amounts, venue labels |
| `src/styles/employee-tip-activity.css` | Mobile-first timeline styles |
| `src/i18n/locales/en.json` | `employee.tipActivity.*` |
| `src/i18n/locales/de.json` | German copy (`Trinkgeldaktivität`) |
| `src/app/components/employee/employeeDashboardNav.ts` | Nav label → Tip activity |

`TipsActivityPage` employee-history variant is **no longer used** for this route.

---

## 7. Mobile Verification

Designed mobile-first:

- Max content width ~42rem
- Horizontal scroll filter chips (no page overflow)
- `white-space: nowrap` on amounts
- Stacked timeline cards (not a table)
- Detail dialog `max-h-[90vh]` with scroll
- Touch targets ≥44px on filters / load more / refresh

Target widths: 320–430px (code review; no new dedicated E2E in this pass).

---

## 8. Desktop Verification

Centered column (~42rem) within dashboard shell — activity cards do not stretch full workspace width. Sidebar/shell unchanged.

---

## 9. English / German Verification

Full `employee.tipActivity` namespace in EN + DE:

- Page title, subtitle, filters, groups, events, support lines, detail labels
- Nav: `dashboardNav.employee.tipActivity`
- German: `Trinkgeldaktivität`, longer filter labels tested in copy

---

## 10. Financial Source-of-Truth Verification

| Rule | Status |
|------|--------|
| Uses frozen `platformFeeCents` on payable | ✅ |
| Earnings from `payableCents - refundedCents` | ✅ |
| No current fee config recalculation | ✅ |
| No payout/transfer logic changes | ✅ |
| No second ledger | ✅ |

---

## 11. Tests

| Command | Result |
|---------|--------|
| Frontend linter (changed files) | No errors |
| Automated E2E for Tip Activity | Not added in this pass |
| Existing payables runtime script | Structure check only (no field assertions) |

Manual test matrix documented in spec (direct_to_employee, business_distribution, transferred, pending, failed, refunded, legacy).

---

## 12. Changed Files

See §6 and §5 above.

---

## 13. Remaining Limitations

1. **Legacy tips without `EmployeeTipPayable`** do not appear in the feed (only on Analytics legacy note). Not fabricated.
2. **Not real-time streaming** — uses existing socket hint + manual refresh + quiet reload.
3. **One activity card per payable** (current state), not separate cards per state transition over time.
4. **No dedicated Playwright overflow suite** for Tip Activity yet.

---

## 14. Differentiation vs Analytics vs Distribution

| Page | Question answered |
|------|-------------------|
| **Tip Activity** | What happened to each tip? |
| **Employee Analytics** | How am I performing? |
| **Tip Distribution** (business) | How does the venue distribute pooled tips? |

**Final status:** Tip Activity is clearly differentiated from Analytics. ✅
