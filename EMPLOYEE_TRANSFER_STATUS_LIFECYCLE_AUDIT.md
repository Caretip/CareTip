# Employee Transfer Status Lifecycle Audit

**Date:** 2026-09-24  
**Scope:** Forensic audit + remediation of dynamic employee transfer status on Employee Analytics

---

## Executive answers

| Question | Answer |
|----------|--------|
| **Is "We're confirming a recent transfer…" hardcoded?** | **No.** It is an i18n string selected when `stripeReadable === true` AND at least one reconciliation row has `status === "STRIPE_TRANSFER_MISSING"`. |
| **Why might two employees see the same message?** | **Most likely A:** both genuinely have `STRIPE_TRANSFER_MISSING` in their server reconciliation snapshot. Same copy does not imply hardcoding. |
| **When does it change to "Transfer confirmed"?** | When a **fresh server reconciliation** returns `stripeReadable: true`, `complete: true`, no attention rows, and at least one row with `status === "MATCHED"` (Stripe Transfer verified). |
| **Does the employee have to refresh?** | **Not anymore.** Status refetches on tab return, every 45s while unresolved, and via **Refresh status**. |
| **How often is status rechecked?** | On mount, tab refocus (debounced), manual refresh, and **45s polling** only while status is unresolved (`verifying`, `failed`, `review`). |
| **Is status based on fresh Stripe data?** | **Yes**, on each `GET /api/me/employee-connect/analytics` call the server runs `reconcileEmployeeDirectPayables` and calls `stripe.transfers.list`. |
| **What if Stripe cannot be read?** | Shows **"We couldn't verify your Stripe transfers right now…"** — never "confirming". |
| **What if transfer genuinely failed?** | Shows **"Transfer needs attention"** when `caretipStatus === "transfer_failed"` with recoverable remaining cents. Does not show "confirming". |

This is **not real-time**. Updates occur on refetch events only.

---

## 1. Was the previous message hardcoded?

**No.**

The string `employee.analytics.transferStatus.verifyingMessage` is rendered only when `deriveEmployeeTransferStatus()` returns `kind: "transfer_verifying"`.

**Exact condition:**

```typescript
stripeReadable === true
&& rows.some((r) => r.status === "STRIPE_TRANSFER_MISSING")
```

`STRIPE_TRANSFER_MISSING` is set server-side when CareTip shows transfer activity (`transferred` or `transferredCents > 0`) but no matching Stripe Transfer is found in the examined list.

Two employees seeing the same message means both currently match this condition — not that the UI ignores per-employee data.

---

## 2. Frontend state-selection logic

**File:** `src/app/components/employee/employeeTransferStatusPresentation.ts`

| Priority | Kind | Condition |
|----------|------|-----------|
| 1 | `transfer_failed` | `caretipStatus === "transfer_failed"` && `caretipRemainingCents > 0` |
| 2 | `transfer_review_*` | `AMOUNT_MISMATCH` / `DESTINATION_MISMATCH` / `DUPLICATE_TRANSFER` |
| 3 | `transfer_verifying` | `stripeReadable` && `STRIPE_TRANSFER_MISSING` |
| 4 | `stripe_unreadable` | `!stripeReadable` |
| 5 | `incomplete` | `!complete` |
| 6 | `transfer_confirmed` | `stripeReadable` && `complete` && `MATCHED` row with `transferredCents > 0` |
| 7 | `transfer_pending` | `CARETIP_PENDING` + `held_platform`/`transferring` + remaining > 0 |
| 8 | `healthy` | default |

**Removed bug:** `paidToStripeEur > 0` no longer triggers a "transferred" message without server `MATCHED` verification.

---

## 3. Backend reconciliation states

**Service:** `backend/src/services/employeePayoutReconciliation.service.ts`

| Status | Meaning |
|--------|---------|
| `MATCHED` | Stripe Transfer linked; amount/destination OK |
| `CARETIP_PENDING` | No transfer activity yet / pending release |
| `STRIPE_TRANSFER_MISSING` | CareTip transferred; Stripe Transfer not found |
| `AMOUNT_MISMATCH` | Linked transfer amount ≠ CareTip |
| `DESTINATION_MISMATCH` | Transfer destination ≠ employee Connect account |
| `DUPLICATE_TRANSFER` | Multiple Stripe transfers for same payable |

**New metadata (this remediation):**

- `reconciliation.checkedAt` — server time when snapshot was produced
- `row.stripeTransferCreatedAt` — Stripe Transfer `created` when linked

---

## 4. Employee isolation verification

Presentation runtime test simulates independent reconciliation payloads:

| Employee | Rows | Result |
|----------|------|--------|
| A | `MATCHED` | `transfer_confirmed` |
| B | `STRIPE_TRANSFER_MISSING` | `transfer_verifying` |
| C | `AMOUNT_MISMATCH` | `transfer_review_amount` |

When B's payload changes to `MATCHED` on refetch → `transfer_confirmed`.

No employee ID/email conditions exist in selection logic.

---

## 5. Confirmation condition

**"Transfer confirmed" requires:**

1. Server `stripeReadable === true` (Stripe Transfer list successfully read)
2. `complete === true` (≤100 payables and ≤100 transfers examined without truncation)
3. At least one row: `status === "MATCHED"` AND `caretipTransferredCents > 0`
4. No higher-priority attention state (failed, review, missing, unreadable)

**NOT sufficient:**

- CareTip payable `transferred` status alone
- `paidToStripeEur` lifetime metric alone
- Time elapsed / page refresh without new MATCHED row
- Client-side timers

**Confirmed at timestamp:** `stripeTransferCreatedAt` from the latest MATCHED row's Stripe Transfer (when available).

---

## 6. Refresh / revalidation behavior

**Hook:** `src/app/hooks/useEmployeeAnalytics.ts`

| Trigger | Behavior |
|---------|----------|
| Page mount | Initial `getEmployeeAnalytics` |
| Tab visibility return | `useDashboardTabRefocus` → quiet reload (450ms debounce) |
| Manual **Refresh status** | Quiet reload |
| Unresolved polling | 45s interval while `transfer_verifying`, `transfer_failed`, or `transfer_review_*` |
| Period change | Full reload (existing) |

**Not implemented:** sub-second polling, fake progress, localStorage status, client-side status calculation.

---

## 7. Polling interval

**45 seconds** (`TRANSFER_STATUS_POLL_MS`) only when `shouldPollEmployeeTransferStatus(kind)` is true.

Does **not** poll when:

- `transfer_confirmed`
- `stripe_unreadable`
- `healthy` / `transfer_pending` / `incomplete`

---

## 8. Manual refresh

`EmployeeTransferStatusCard` includes **Refresh status** button calling `reload()` from the hook.

While refreshing: button shows **Checking…** with spinner.

---

## 9. Last checked

**Last checked: {time}** uses client `lastFetchedAt` (actual time of last successful analytics API response), formatted in business timezone.

Distinct from **Confirmed at {time}** which uses server `stripeTransferCreatedAt` from verified MATCHED transfer.

---

## 10. State transition test

**Runtime:** `employeeTransferStatusPresentation.runtime.ts` — missing → MATCHED → mismatch

**E2E:** `employee-transfer-status.spec.ts` — mock returns `STRIPE_TRANSFER_MISSING` on first call, `MATCHED` on refresh → UI transitions from `transfer_verifying` to `transfer_confirmed`.

---

## 11. Two-employee test

Covered in presentation runtime (section 10) and e2e per-state tests.

---

## 12. Stripe API load considerations

- Reconciliation calls `stripe.transfers.list` once per analytics request (limit 100)
- Polling limited to 45s and only during unresolved states
- Tab refocus debounced (450ms shared listener)
- No additional Stripe calls from frontend

---

## 13. Tests / build results

| Test | Result |
|------|--------|
| `employeeTransferStatusPresentation.runtime.ts` | Pass |
| `test:employee-payout-reconciliation` | Pass |
| `e2e/employee-transfer-status.spec.ts` (7) | Pass |
| Frontend `typecheck` | Pass |

---

## 14. Remaining limitations

1. Examination limited to **100 payables / 100 transfers** — older issues may be outside the window.
2. **Not real-time** — employees must wait for refetch (mount, tab focus, 45s poll, or manual refresh).
3. When `stripeReadable === false`, Stripe verification is impossible until Stripe is reachable.
4. Mixed states (some MATCHED, some MISSING) show **verifying**, not confirmed.
5. `transfer_failed` recovery exists server-side (`scheduleReleaseRecoverablePlatformPayablesForEmployee`) but UI does not claim "automatic retry".

---

## Lifecycle diagram

```
CareTip payable transferred
        ↓
Stripe transfers.list (per analytics request)
        ↓
   ┌────┴────┐
   │ linked? │
   └────┬────┘
     no │ yes
        ↓    ↓
  MISSING  MATCHED / MISMATCH / DUPLICATE
        ↓
 deriveEmployeeTransferStatus (frontend)
        ↓
 EmployeeTransferStatusCard + refetch triggers
```
