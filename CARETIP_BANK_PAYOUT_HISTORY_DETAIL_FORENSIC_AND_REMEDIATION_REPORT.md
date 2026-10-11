# CareTip — Bank Payout History Detail (Forensic & Remediation)

## 1. Current payout data available

### Stripe → backend (`parsePayoutObject` in `stripeConnectPayout.service.ts`)

| Stripe field | CareTip storage / API |
|--------------|------------------------|
| `id` (`po_…`) | `stripeConnectPayout.stripePayoutId` / employee list `stripePayoutId` |
| `amount`, `currency` | `amountCents`, `currency` |
| `status` | Mapped to `pending` / `in_transit` / `paid` / `failed` / `canceled` |
| `created` | `stripeCreatedAt` (authoritative **initiation**) |
| `arrival_date` | `arrivalDate` (authoritative **expected bank arrival**) |
| `method` | `standard` / `instant` |
| `type` | `payoutType` (`bank_account`, `card`, …) |
| `failure_code` / `failure_message` | Sanitized on persist; employee list now exposes from live Stripe |
| `destination` (expanded) | `destinationLast4` on employee list; business **detail** via Stripe retrieve |
| `description` | Stored; not shown as “manual initiation” to users |

CareTip also records `paidAt` / `failedAt` / `canceledAt` when webhook/API sync applies status transitions (observation timestamps, not substitutes for Stripe `created` / `arrival_date`).

### €248.08 example (`po_…uAe1`)

Live Stripe data for a specific production payout was **not queried in this environment** (no credentials in CI/dev). For any paid standard payout, the UI now uses:

- **Initiated:** `stripeCreatedAt` ← Stripe `created`
- **Expected / completed bank date:** `arrivalDate` ← Stripe `arrival_date`
- **Completed label:** when `status === paid`, timeline step uses `arrival_date` (fallback `paidAt` only if arrival missing)
- **Status:** Stripe-mapped `paid` → label “Paid” (= Stripe completed the payout to the destination pipeline)

Previously the UI emphasized internal CareTip payout row id, flat field list, and arrival/created rows without lifecycle context. **`stripePayoutId` was not exposed on business DTOs** (only searchable in admin queries).

## 2. Current UI limitations (before)

- Business: `ConnectPayoutDetailDialog` led with internal id; timeline not visualized; destination bank not shown on detail.
- Employee web: bank list was **read-only** (no detail drawer); `po_` and date shown in list without initiation vs arrival distinction.
- Scheduled every-3-days payouts: no user-facing “Scheduled by CareTip” when ledger matched `po_`.
- Instant vs scheduled: only `method` in list, no CareTip instant-request ledger distinction on employee web.

## 3. Stripe fields used in timeline

- `created` → **Payout initiated** (date + time)
- `arrival_date` → **Expected bank arrival** (pending/in_transit) or **Payout completed** (paid)
- `status` → which steps render (no fabricated intermediate timestamps)
- In-transit **range** → calendar dates from `created` and `arrival_date` only when they differ

## 4. Timeline design

Implemented in `src/app/lib/connectPayoutTimeline.ts` + `PayoutBankLifecycleDetail.tsx`:

1. Amount + status badge + short status lead  
2. Vertical timeline (newest first): completed / expected / in-transit range / initiated  
3. Bank processing note (standard, non-instant) — explains bank delay vs Stripe send  
4. Meta block: destination, amount, type, method, masked payout id  

## 5. Initiation timestamp source

**Stripe `created`** via `stripeCreatedAt` (business) / `createdAt` (employee Stripe list).

## 6. Arrival date source

**Stripe `arrival_date`** via `arrivalDate`. No +N day calculation.

## 7. Completion status source

Stripe `status === paid` with completion date from **`arrival_date`** when present; otherwise CareTip-observed `paidAt`.

## 8. Every 3 days handling

`StripeConnectScheduledPayoutRequest` / `EmployeeStripeScheduledPayoutRequest` matched by `stripePayoutId` + `submitted` → `initiationKind: caretip_scheduled` and subtitle **Scheduled by CareTip · {schedule}** using the account’s `bankPayoutSchedule` (e.g. every_3_days). Stripe “manual” initiation wording is **not** surfaced.

## 9. Instant payout handling

`method === instant` or instant payout request ledger match → **Instant payout requested in CareTip**; not labeled as scheduled.

## 10. Failed payout handling

Timeline **Payout failed** step uses `failedAt` or initiation time; sanitized `failureMessage` / `failureCode` shown in an alert (no raw Stripe secrets).

## 11. Mobile UX (web)

- Compact list rows (method, amount, date, status); tap opens detail dialog/sheet pattern.  
- Timeline CSS in `payout-workspace.css` (`caretip-payout-timeline`).  
- No horizontal scroll; payout id de-emphasized in list.

## 12. Desktop UX

- Same detail component in wider dialog (`sm:max-w-lg` / `md`).  
- Reconciliation and balance lines remain secondary below lifecycle (business).

## 13. EN / DE

Keys under `business.billing.payouts.timeline.*` and `employee.payouts.bankHistory.detail*`.

## 14. Tests

- `npm run test:bank-payout-history-detail` — timeline builder + wiring assertions  
- `npm run typecheck` — pass  

## 15. Build / typecheck

| Command | Result |
|---------|--------|
| `npm run test:bank-payout-history-detail` | Pass |
| `npm run typecheck` | Pass |

### API extensions (minimal)

- `ConnectPayoutDto`: `stripePayoutId`, optional `destinationLast4`, `initiationKind`, `bankPayoutSchedule` (detail enrichment).  
- Employee list response: `bankPayoutSchedule` + per-item `failure*`, `payoutType`, `initiationKind`.  
- No new DB models; Stripe retrieve on business detail only for destination last4.

### React Native app

Employee native history still uses the slimmer `EmployeePayoutDetailSheet`; web employee/business paths are remediated. Native can reuse the same timeline model in a follow-up.

---

## Final status

**READY — PAYOUT HISTORY DETAIL VERIFIED**
