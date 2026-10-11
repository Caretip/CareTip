# Employee Transfer Status UX Implementation

**Date:** 2026-09-24  
**Related audit:** `EMPLOYEE_PAYOUT_RECONCILIATION_UX_AUDIT.md`

---

## 1. Original problem

Employee Analytics showed a single alarming banner whenever `reconciliation.needsAttention` was true:

- **"Payout reconciliation needs attention"**
- **"CareTip records and Stripe records are temporarily different."**

This was misleading because:

1. The check is **Stripe Connect Transfer verification** (`EmployeeTipPayable` ↔ `Transfer`), **not** bank payout reconciliation.
2. Multiple distinct backend statuses were collapsed into one message.
3. When `stripeReadable === false`, payables marked transferred were classified as missing Stripe transfers, producing **false-positive warnings** in dev/test.

---

## 2. Exact reconciliation meaning (unchanged financially)

| CareTip | Stripe |
|---------|--------|
| `EmployeeTipPayable` (`direct_to_employee`) | `stripe.transfers.list(destination=acct_…)` |

Bank payouts (`po_…`) remain a **separate** display-only section. No financial formulas, transfer creation, or recovery logic was changed.

---

## 3. UI states implemented

The generic boolean banner was replaced by `EmployeeTransferStatusCard`, driven by `deriveEmployeeTransferStatus()` from authoritative `reconciliation` data.

| State | Tone | When |
|-------|------|------|
| `healthy` | Positive | Stripe readable, complete, no issues, no matched transfers yet |
| `healthy_transferred` | Positive | Matched transfers or `paidToStripeEur > 0` |
| `stripe_unreadable` | Neutral | `stripeReadable === false` (prioritized over missing-transfer flags) |
| `transfer_verifying` | Neutral | Stripe readable + `STRIPE_TRANSFER_MISSING` |
| `transfer_review_amount` | Warning | `AMOUNT_MISMATCH` |
| `transfer_review_destination` | Warning | `DESTINATION_MISMATCH` |
| `transfer_review_duplicate` | Warning | `DUPLICATE_TRANSFER` |
| `transfer_failed` | Warning | `caretipStatus === transfer_failed` with `caretipRemainingCents > 0` |
| `incomplete` | Neutral | `complete === false` (partial 100-row examination) |

**Priority (deterministic):**  
`transfer_failed` → review variants → `transfer_verifying` → `stripe_unreadable` → `incomplete` → healthy variants.

Section renamed from **"Reconciliation status"** to **"Transfer status"** (DE: **"Überweisungsstatus"**).

---

## 4. `STRIPE_TRANSFER_FOUND` → `STRIPE_TRANSFER_MISSING`

Internal status renamed everywhere:

- `backend/src/services/employeePayoutReconciliation.service.ts`
- `backend/src/services/businessPayoutReconciliation.service.ts` (mapping updated)
- `src/app/lib/api.ts`
- `backend/scripts/employee-payout-reconciliation-runtime.ts`

Semantics unchanged: CareTip shows transfer activity but no matching Stripe Transfer in the examined list.

---

## 5. `transfer_failed` handling

Previously classified as `CARETIP_PENDING` and hidden from the warning banner.

Now surfaced when `caretipStatus === "transfer_failed"` and `caretipRemainingCents > 0` (recoverable payable per existing ledger rules).

Copy does **not** claim automatic retry. Backend recovery (`scheduleReleaseRecoverablePlatformPayablesForEmployee`) exists but is not referenced in employee copy.

---

## 6. Completeness handling

`reconcileEmployeeDirectPayables` now returns:

```typescript
{
  complete: boolean;
  examinedPayableCount: number;
  totalPayableCount: number;
  payablesTruncated: boolean;
  transfersHasMore: boolean;
}
```

`complete = !payablesTruncated && !transfersHasMore` (100 payables / 100 transfers cap preserved).

When incomplete (and higher-priority states do not apply), employees see a subtle informational message with examined/total counts.

When `stripeReadable === false`, unreadable state takes priority over incomplete.

`needsAttention` no longer flags `STRIPE_TRANSFER_MISSING` when Stripe is unreadable.

---

## 7. EN / DE copy

All strings under `employee.analytics.transferStatus.*` in:

- `src/i18n/locales/en.json`
- `src/i18n/locales/de.json`

Removed employee-facing use of `reconciliationAttention` / `reconciliationAttentionHint`.

---

## 8. Mobile verification

| Check | Result |
|-------|--------|
| `e2e/employee-analytics-mobile-overflow.spec.ts` (320–430px) | **Pass** |
| `e2e/employee-transfer-status.spec.ts` German @ 320px | **Pass** (no horizontal overflow) |

---

## 9. Tests

| Test | Result |
|------|--------|
| `npm run test:employee-payout-reconciliation` | **Pass** (classifier, unreadable guard, completeness) |
| `npx tsx src/app/components/employee/employeeTransferStatusPresentation.runtime.ts` | **Pass** (11 scenarios) |
| `npx playwright test e2e/employee-transfer-status.spec.ts` | **Pass** (5) |
| `npx playwright test e2e/employee-analytics-mobile-overflow.spec.ts` | **Pass** (6) |
| `npm run test:employee-analytics-final-closure` | **Pass** |
| `npm run test:financial-p0-remediation` | **Pass** |

---

## 10. Build / typecheck results

| Command | Result |
|---------|--------|
| `npm run typecheck` (frontend) | **Pass** |
| `npx tsc --noEmit` (backend) | **Pass** |
| `npm run build` (frontend) | **Pass** |
| `npm run build` (backend) | **Fail** — Prisma Windows DLL lock: `EPERM` renaming `query_engine-windows.dll.node` (pre-existing environment issue; not introduced by this change) |

---

## 11. Changed files

### Backend
- `backend/src/services/employeePayoutReconciliation.service.ts`
- `backend/src/services/businessPayoutReconciliation.service.ts`
- `backend/scripts/employee-payout-reconciliation-runtime.ts`

### Frontend
- `src/app/components/employee/employeeTransferStatusPresentation.ts` *(new)*
- `src/app/components/employee/employeeTransferStatusPresentation.runtime.ts` *(new)*
- `src/app/components/employee/EmployeeTransferStatusCard.tsx` *(new)*
- `src/app/pages/employee/EmployeeAnalyticsPage.tsx`
- `src/app/lib/api.ts`
- `src/i18n/locales/en.json`
- `src/i18n/locales/de.json`

### E2E
- `e2e/employee-transfer-status.spec.ts` *(new)*
- `e2e/employee-analytics-mobile-overflow.spec.ts`

### Documentation
- `EMPLOYEE_PAYOUT_RECONCILIATION_UX_IMPLEMENTATION.md` *(this file)*

---

## 12. Remaining limitations

1. **UI does not expose per-payable detail** — employees see one derived state; row-level data remains in API for future use.
2. **100-row examination cap** — older mismatches may fall outside the examined window; incomplete messaging mitigates silent false completeness.
3. **When Stripe is unreadable, confirmed mismatches cannot be classified** — by design; unreadable state is shown instead of alarming missing-transfer copy.
4. **`needsAttention` boolean retained** in API for backward compatibility but **no longer drives** employee UI.
5. **No financial issues are resolved by this change** — this is UX/state presentation only.

---

## False-positive elimination

**Yes** for the audited scenario (`stripeReadable: false` + `destination_settled` test payables): employees now see neutral **"We couldn't verify your Stripe transfers right now…"** instead of **"Payout reconciliation needs attention."**

## Terminology clarity

**Yes** — section is **Transfer status**; copy refers to earnings transfers to Stripe Connect, not bank payouts. Bank payouts remain under **Bank payouts** / **Bankauszahlungen**.
