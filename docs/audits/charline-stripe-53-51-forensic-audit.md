# Charline — €53.51 “Transfer failed” Forensic Money-Flow Audit

**Date:** 2026-09-23  
**Mode:** Read-only (no code, DB, or Stripe mutations)  
**Subject:** Employee “Charline” — CareTip Payout history screenshot showing **€53,51 · Transfer failed · 23 Sept 2026 · 11:12 Berlin**

---

## 1. Executive summary

**CONFIRMED:** The screenshot row is a **CareTip → Stripe platform Transfer** failure on the **CareTip transfers** tab — **not** a failed Stripe → bank payout.

| Finding | Confidence |
|---------|------------|
| Employee is **Charline Test** (`cmtlevnof003rjl47ncojnt7h`) at **Test Hotel** — single unambiguous match | **High** |
| UI amount **€53.51** is the **employee net payable** (`payableCents = 5351`), not the guest gross tip | **High** |
| Originating tip was **€60.00 gross** (receipt `CT-26-0JW3ZCX2`) | **High** |
| Tip was taken **before** Stripe Connect was ready → `platform_hold` ledger | **High** |
| CareTip attempted `transfers.create` after connect; **Stripe rejected** (missing `transfers` capability on destination account) | **High** |
| **No Stripe Transfer ID** was created (`stripeTransferId = null`) | **High** |
| **€53.51 has not reached** Charline’s connected Stripe balance or bank from this payable | **High** |
| Funds from this tip remain on the **CareTip platform Stripe balance** (platform-hold charge model) | **High** (ledger + routing model; platform balance not independently queried in Stripe Dashboard during this audit) |
| Charline **did** receive a separate **€43.42** bank payout later that day from **other** tips routed via destination charge | **High** |
| **No duplicate transfer / double-credit** observed for this payable | **High** |
| Payable has **not been retried** since the initial failure (`updatedAt` frozen at failure time) despite Connect later becoming `ready` | **High** |

**Primary answer:** Charline’s €53.51 is the **net employee share of a €60 tip** that was **held on the CareTip platform** because Stripe was not connected at checkout. After she connected Stripe, CareTip tried to release it via a **Stripe Transfer** to `acct_1UImFh66w9bX7ZFb`, but Stripe **rejected** the transfer because the connected account lacked transfer capabilities. The money **did not move** to her Stripe account or bank for this payable; it remains **owed on the platform-hold ledger** in status `transfer_failed`.

---

## 2. Employee identification

| Field | Value | Confidence |
|-------|-------|------------|
| Display name | Charline Test | High |
| Employee ID | `cmtlevnof003rjl47ncojnt7h` | High |
| User ID | `cmtlevno1003pjl477j4l2vu9` | High |
| Slug | `charline-test` | High |
| Activation | `active`, not deleted | High |
| Ambiguity | **None** — only one employee name match for “Charline” | High |

*Email on file omitted from this report per PII minimization; available in DB for ops follow-up.*

---

## 3. Business / tenant identification

| Field | Value | Confidence |
|-------|-------|------------|
| Business | Test Hotel | High |
| Business ID | `cmqexplaj0021n83qbet06d89` | High |
| Payout mode | `direct_to_employee` (inferred from payables) | High |
| Tenant isolation | Tip, payable, Stripe account, and bank payout all share this `businessId` | High |

No cross-tenant Stripe mapping detected for this case.

---

## 4. Stripe account identification

| Field | Value | Confidence |
|-------|-------|------------|
| Stripe Connect account | `acct_1UImFh66w9bX7ZFb` | High |
| DB link row | `employee_stripe_accounts` → `cmudvz96p00t4km485cru0b74` | High |
| Current status (at audit) | `ready`, `payoutsEnabled: true`, `detailsSubmitted: true` | High |
| Account row created | `2026-09-23T09:14:13.441Z` (11:14 Berlin) | High |
| Last Connect sync | `2026-09-23T11:49:49.640Z` (11:49 Berlin) | High |

Metadata on Transfer attempts (when created) includes `caretip_employee_id`, `caretip_business_id`, `caretip_payable_id`, `caretip_transaction_id` per `employeeTipRelease.service.ts`.

---

## 5. Stripe connection timeline (Europe/Berlin)

| Time (Berlin) | UTC | Event | Confidence |
|---------------|-----|-------|------------|
| **11:12:36** | 09:12:36 | **€60 tip received** — Stripe **not** ready → `platform_hold` | High |
| **11:14:13** | 09:14:13 | **Stripe Connect account created** in CareTip (`employee_stripe_accounts.createdAt`) | High |
| **11:17:29** | 09:17:29 | **CareTip Transfer attempt failed** — payable `updatedAt` | High |
| **10:38:43** | 08:38:43 | Next tip €50 — `destination_employee` (Connect sufficiently ready for new tips) | High |
| **11:49:29** | 09:49:29 | **Bank payout** `po_1UIog166w9bX7ZFb` **€43.42 paid** (different money) | High |
| **11:49:49** | 09:49:49 | Connect status refreshed to `ready` | High |
| **11:51:03** | 09:51:03 | Next tip €50 — `destination_employee` | High |

**Before tip:** Stripe was **not** connected / not recipient-ready.  
**After tip:** Charline connected Stripe ~2 minutes later; release was attempted ~5 minutes after tip.

---

## 6. €53.51 tip identification

**Do not equate screenshot €53.51 with gross tip.**

| Concept | Amount | ID | Confidence |
|---------|--------|-----|------------|
| Guest gross tip | **€60.00** | Transaction `cmudvx60m00skkm482ugv29dl` | High |
| Platform fee (10% + €0.49) | **€6.49** (649¢) | `platformFeeCents` | High |
| Employee net payable | **€53.51** (5351¢) | `payableCents` on payable `cmudvx61o00smkm48a5ltlowv` | High |
| Receipt | `CT-26-0JW3ZCX2` | — | High |
| PaymentIntent | `pi_3UImE966w930Tx0A1TlI98Zz` | — | High |
| Charge | `ch_3UImE966w930Tx0A1n6lUZzj` | — | High |

`Transaction.amount = 53.51` search returned **no rows** — the tip is stored as **€60.00**; €53.51 exists only on the **payable ledger**.

---

## 7. Money-state table

| Stage | Date/time (Berlin) | Object | Amount | Status | ID | Where money was |
|-------|-------------------|--------|--------|--------|-----|-----------------|
| Tip (guest payment) | 23 Sep 2026 11:12:36 | `Transaction` / `tips` | Gross **€60.00** | `success` | `cmudvx60m00skkm482ugv29dl` | Customer → **CareTip platform Stripe** (`platform_hold`) |
| Platform fee | (at tip) | Fee calc | **€6.49** | CONFIRMED | — | **CareTip platform** (application fee) |
| Employee allocation | 23 Sep 2026 11:12:36 | `EmployeeTipPayable` | Net **€53.51** | `held_platform` → `transfer_failed` | `cmudvx61o00smkm48a5ltlowv` | **CareTip ledger** — owed to employee |
| Stripe Connect | 23 Sep 2026 11:14:13 | `EmployeeStripeAccount` | — | Account created | `acct_1UImFh66w9bX7ZFb` | N/A |
| CareTip release attempt | 23 Sep 2026 11:17:29 | `releaseHeldPlatformPayablesForEmployee` | **€53.51** | Failed before Stripe object | payable `cmudvx61o00smkm48a5ltlowv` | Still **platform hold** |
| Stripe Transfer | 23 Sep 2026 11:17:29 | `transfers.create` | **€53.51** | **NOT CREATED** | `stripeTransferId = null` | N/A — API error |
| Stripe Payout (bank) | — | `EmployeeStripePayout` | **€53.51** | **NOT APPLICABLE** | — | No bank payout for this payable |
| Other bank payout (same day) | 23 Sep 2026 11:49:29 | `po_1UIog166w9bX7ZFb` | **€43.42** | `paid` | Separate tips | Charline’s **bank** (unrelated amount) |
| **Final state** | As of audit | Payable `transfer_failed` | **€53.51** owed | `transfer_failed` | `cmudvx61o00smkm48a5ltlowv` | **CareTip platform Stripe balance** (guest €60 captured; €53.51 not transferred to connected account) |

---

## 8. Chronological timeline

```
TIP CREATED (11:12 Berlin)
  €60 gross tip → employee Charline @ Test Hotel
  chargeModel: platform_hold (Stripe not recipient-ready)
  Payable created: €53.51 net, status held_platform

TIP PAID
  PaymentIntent pi_3UImE966w930Tx0A1TlI98Zz succeeded
  Funds on CareTip platform (not destination charge)

STRIPE CONNECTED (11:14 Berlin)
  acct_1UImFh66w9bX7ZFb linked to employee

PAYOUT ELIGIBILITY / RELEASE TRIGGERED
  releaseHeldPlatformPayablesForEmployee (on Connect status / account.updated path)
  Payable claimed → status transferring

TRANSFER CREATED (attempted 11:17 Berlin)
  Stripe transfers.create(destination: acct_1UImFh66w9bX7ZFb, amount: 5351)
  idempotencyKey: emp_tip_release:cmudvx61o00smkm48a5ltlowv

TRANSFER FAILED (11:17 Berlin)
  Stripe error (truncated in DB):
  "Your destination account needs to have at least one of the following
   capabilities enabled: transfers, crypto_transfers, or legacy_payments..."
  Payable → transfer_failed, stripeTransferId remains null
  lastTransferError stored (180 char max)

ANY RETRY
  NOT FOUND — payable updatedAt unchanged since 11:17 Berlin

ANY REVERSAL / REFUND on this payable
  NOT FOUND — reversedCents=0, refundedCents=0

SEPARATE TIPS (10:38, 11:51 Berlin)
  €50 tips via destination_employee → routed directly to connected account
  (independent of failed platform-hold payable)

BANK PAYOUT (11:49 Berlin)
  po_1UIog166w9bX7ZFb €43.42 instant → paid
  From connected-account balance (later destination tips), NOT the €53.51 hold

CURRENT STATE
  Payable still transfer_failed, €53.51 remainingPayableCents = 5351
  Employee has NOT received this €53.51 via Stripe Transfer or bank payout
```

---

## 9. Failure point and exact reason

| Question | Answer | Confidence |
|----------|--------|------------|
| What failed? | **Stripe Transfer** (platform → connected account) | High |
| Not a bank payout failure? | Correct — **Bank payouts** tab is separate (`EmployeeStripePayout`); no `po_` for €53.51 | High |
| Stripe object created? | **No** — `stripeTransferId` is null | High |
| Failure reason | Connected account missing **transfers** (or equivalent) capability at attempt time | High |
| CareTip DB field | `EmployeeTipPayable.status = transfer_failed`, `lastTransferError` | High |

---

## 10. Where is the €53.51 now?

| Destination | Applicable? | Evidence |
|-------------|-------------|----------|
| CareTip platform Stripe balance | **YES** | `platform_hold` charge; transfer never succeeded |
| Employee connected Stripe balance | **NO** | `stripeTransferId` null; `transferredCents = 0` |
| Employee bank | **NO** for this payable | Bank payout €43.42 is different amount/source |
| CareTip internal ledger | **YES** — owed, failed release | `transfer_failed`, `remainingPayableCents = 5351` |
| Refunded / reversed | **NO** | Zero refund/reversal cents |
| Lost | **NO evidence** | Accounting shows platform hold + failed transfer |

**Employee could not have received this €53.51** via the failed transfer path. She may have received **other** tip proceeds (e.g. €43.42 payout from destination-routed tips).

---

## 11. Connect-then-payout sequence (did it happen?)

| Step | Occurred? | Evidence |
|------|-----------|----------|
| 1. Charline has CareTip account | Yes | Employee row since 2026-09-10 |
| 2. Receives tip before Stripe ready | Yes | Tip 11:12, Connect row 11:14 |
| 3. Stripe not connected at tip | Yes | `platform_hold` |
| 4. Connects Stripe | Yes | `acct_1UImFh66w9bX7ZFb` at 11:14 |
| 5. CareTip detects connection | Yes | Release service invoked |
| 6. Balance becomes eligible | Yes | `held_platform` payable eligible |
| 7. CareTip initiates transfer | Yes | `transferring` → failure at 11:17 |
| 8. Transfer fails | Yes | `transfer_failed` + Stripe capability error |
| 9. Money to employee | **No** | Still platform-held |

---

## 12. Double-spend / duplicate risk

| Check | Result | Confidence |
|-------|--------|------------|
| Duplicate Stripe Transfer | None — no `tr_` id | High |
| Second successful release | None — status still `transfer_failed` | High |
| Idempotency key | `emp_tip_release:cmudvx61o00smkm48a5ltlowv` would guard retries | High (code) |
| Payable `transactionId` unique | Yes | High |
| Employee paid €53.51 twice | **No evidence** | High |

---

## 13. Ledger integrity

| Check | Result |
|-------|--------|
| Payable matches tip | `transactionId` unique link — OK |
| Amount math | 6000 − 649 = 5351 — OK |
| Status vs transferredCents | `transfer_failed` + `transferredCents=0` — consistent |
| Orphan payable | **No** — linked to tip and employee |
| Deleted employee | **No** — active |
| Stale retry | **Gap** — payable not retried after Connect became fully `ready` (see §15) |

---

## 14. UI forensic trace (“Transfer failed” / €53.51 / 11:12)

| UI element | Source | Notes |
|------------|--------|-------|
| Page | `EmployeePayoutHistoryPage.tsx` → tab **CareTip transfers** | |
| List | `EmployeePayoutActivityList.tsx` | |
| API | `GET /api/me/employee-connect/payables` → `listEmployeePayableActivityForEmployee` | |
| Description “Transfer failed” | `employee.payouts.activityKind.failed` when `status === transfer_failed` | `employeePayoutActivityPresentation.ts` |
| Status pill “Failed” | `employee.payouts.activityStatus.failed` | |
| Amount €53.51 | `formatEur(row.activityCents / 100)` → `remainingPayableCents` for failed row | |
| Date **11:12 Berlin** | `formatBerlinDateTime(row.createdAt)` | **Tip creation time**, not failure time (failure ≈ **11:17 Berlin**) |

**UI accuracy:** Status correctly reflects `transfer_failed`. Date is **misleading** for failures — it shows payable `createdAt`, not `updatedAt` (failure time).

**Tab distinction:** Screenshot is **CareTip transfers** (platform → Connect), not **Bank payouts** (Connect → bank).

---

## 15. Webhook / event correlation

| Event type | Used for this flow? | Notes |
|------------|---------------------|-------|
| `transfer.*` | **No handler** in `stripe.webhook.ts` | Transfer outcome written synchronously in `employeeTipRelease.service.ts` |
| `account.updated` | Yes | Can trigger `releaseHeldPlatformPayablesForEmployee` when `ready` |
| `payout.*` | Yes | Observes bank payouts only — unrelated to failed €53.51 |
| `charge.succeeded` | Tip ingestion path | Created payable |

No `StripeWebhookEvent` row was queried for this payable during audit; failure is recorded on payable row directly.

---

## 16. Retry / stuck-payable analysis (documentation only)

**Observation:** After Connect became capable of `destination_employee` tips (~10:38 Berlin), the `transfer_failed` payable was **not** retried (`updatedAt` stuck at 11:17 Berlin).

**Code factors (for remediation planning, not changed in this audit):**

1. `releaseHeldPlatformPayablesForEmployee` **does** include `transfer_failed` in its release query (`employeeTipRelease.service.ts` ~104–109).
2. `GET /employee-connect/status` only fires release when `heldPlatformCents > 0` (`employeeConnect.controller.ts` ~93–101).
3. `employeePayableSummaryForEmployee` counts **only** `held_platform` toward `heldPlatformCents` — **not** `transfer_failed` (`employeeTipPayable.service.ts` ~384–385).

**Effect:** Automatic retry may depend on `account.updated` firing again after capabilities are fixed; a status poll alone may **not** retry failed releases if no `held_platform` rows remain.

---

## 17. Security / tenant isolation

| Check | Result |
|-------|--------|
| Employee ↔ business ↔ tip ↔ payable | Consistent `cmqexplaj0021n83qbet06d89` |
| Stripe account ↔ employee | 1:1 `employee_stripe_accounts` |
| Cross-tenant account link | **Not found** |

---

## 18. Missing / unavailable evidence

| Evidence | Status |
|----------|--------|
| Live Stripe Dashboard balance for platform account | **Not queried** (read-only API not invoked) |
| Stripe Transfer object | **Does not exist** |
| Audit log rows for this release | **Not retrieved** in this audit |
| Exact Stripe capability state at 11:17 Berlin | Inferred from error message only |

---

## 19. Confidence summary

| Conclusion | Confidence |
|------------|------------|
| Charline = Charline Test, Test Hotel | High |
| €53.51 = net of €60 tip | High |
| Failed stage = Stripe Transfer (not bank payout) | High |
| Money not received by employee for this payable | High |
| Money on platform hold / owed on ledger | High |
| UI “Transfer failed” accurate for transfer stage | High |
| UI date shows tip time not failure time | High |
| No automatic retry after later Connect readiness | High |
| Platform Stripe balance exact cents | Medium (not independently verified in Stripe) |

---

## 20. Recommended remediation (documentation only — not implemented)

1. **Ops:** Manually verify CareTip **platform** Stripe balance includes charge `ch_3UImE966w930Tx0A1n6lUZzj` net of fee.
2. **Ops:** Once `acct_1UImFh66w9bX7ZFb` has `transfers` capability, **safely retry** release for payable `cmudvx61o00smkm48a5ltlowv` via existing `releaseHeldPlatformPayablesForEmployee` (or controlled ops script) — **outside this audit**.
3. **Product/engineering (future):** Include `transfer_failed` in `heldPlatformCents` or trigger release when failed payables exist and Connect is `ready`.
4. **Product/engineering (future):** Show `updatedAt` (failure time) or separate “Failed at” for `transfer_failed` rows in payout history.
5. **Support:** Clarify to Charline that €43.42 bank payout is from **other** tips; €53.51 is **still pending** platform release.

---

## 21. Source files (line references)

| Area | File |
|------|------|
| Payable schema | `backend/prisma/schema.prisma` — `EmployeeTipPayable`, `Transaction`, `EmployeeStripeAccount`, `EmployeeStripePayout` |
| Platform-hold routing | `backend/src/services/employeeTipRouting.service.ts` — `resolveTipCheckoutRouting` |
| Payable creation | `backend/src/services/employeeTipPayable.service.ts` — `createEmployeeTipPayableForSuccessfulTip` |
| Release / transfer | `backend/src/services/employeeTipRelease.service.ts` — `releaseHeldPlatformPayablesForEmployee` |
| Connect + release trigger | `backend/src/services/employeeStripeConnect.service.ts` — `handleEmployeeConnectAccountUpdated` |
| Connect status API | `backend/src/controllers/employeeConnect.controller.ts` — `getMyEmployeeConnectStatus` |
| Activity API | `backend/src/controllers/employeeConnect.controller.ts` — `getMyEmployeePayableActivity` |
| Presentation kind | `backend/src/services/employeePayableActivityPresentation.ts` — `transfer_failed` → `failed` |
| Frontend page | `src/app/pages/employee/EmployeePayoutHistoryPage.tsx` |
| Frontend list | `src/app/components/employee/EmployeePayoutActivityList.tsx` |
| Frontend mapping | `src/app/components/employee/employeePayoutActivityPresentation.ts` |
| i18n | `src/i18n/locales/en.json` — `employee.payouts.activityKind.failed` |
| Fee math | `backend/src/config/fees.ts` — `calculateTipPlatformFeeCents` |
| Webhooks | `backend/src/webhooks/stripe.webhook.ts` — no `transfer.*` handlers |

---

## 22. Investigation method

- Read-only Prisma `SELECT` queries against the configured development/staging database (no `INSERT`/`UPDATE`/`DELETE`).
- Code-path tracing for UI labels, status enums, and money flow.
- No Stripe API mutations; no retries, refunds, or reconnect actions performed.
- Temporary read-only probe script was used and **removed** after audit (no product code changes).

---

**Audit completed:** 2026-09-23  
**Primary question answered:** Charline’s €53.51 is the **net share of a €60 platform-held tip**. CareTip **attempted but failed** to Stripe-transfer it to her connected account due to **missing transfer capabilities** on the destination account at release time. The funds **have not** reached her Stripe balance or bank for this payable; they remain **platform-held / ledger-owed** in `transfer_failed` state.
