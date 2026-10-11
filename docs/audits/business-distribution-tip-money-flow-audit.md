# Business-Distribution Tip Money-Flow Forensic Audit

**Date:** 2026-09-23  
**Mode:** Read-only — no product code changes, no DB/Stripe mutations  
**Scope:** `business_distribution` / “Business distributes employee tips” routing mode  
**Related prior work:** [employee-tip-transfer-recovery-remediation.md](./employee-tip-transfer-recovery-remediation.md), [charline-stripe-53-51-forensic-audit.md](./charline-stripe-53-51-forensic-audit.md)

---

## 1. Executive summary

Business-distribution mode uses a **fundamentally different money path** from direct-to-employee Connect transfers. Guest tips are **Stripe destination charges** to the **business Express connected account**; CareTip retains an **application fee**; employee attribution is recorded in `employee_tip_payables` as **`held_business`** with **`transferredCents = 0`**. CareTip does **not** pay employees automatically and has **no “distributed to employee” state** in the ledger.

**CONFIRMED:** Normal `destination_business` payables **cannot** enter `releaseHeldPlatformPayablesForEmployee()` or the employee Stripe Transfer retry path.

**CONFIRMED:** Routing mode and charge model are **snapshotted at checkout** via PaymentIntent metadata (`caretipRoutingMode`, `caretipChargeModel`) and frozen on the payable row at creation. Changing `Business.employeeTipPayoutMode` does **not** rewrite existing payables.

**CONFIRMED (read-only DB scan):** 29 live `held_business` / `destination_business` payables (€1,058.51 net employee attribution total) with **no** `transfer_failed`, **no** negative balances, **no** duplicate transaction IDs.

**FINDING (severity: medium):** Four historical rows exist with `routingMode = business_distribution`, `chargeModel = platform_hold`, `status = transferred` — these **did** pass through the employee release transfer path. This is a **mode/charge-model mismatch** class, not the normal business-distribution path, but it proves snapshotted `routingMode` alone does not block release; **`chargeModel` + `routingMode` filters** do.

**FINDING (severity: medium):** There is **no CareTip ledger field or API** to mark an employee share as “distributed by the business.” `held_business` can remain indefinitely with no automatic reconciliation against off-platform payments.

**FINDING (severity: high, architectural):** The Charline-class failure has a **different equivalent**: if Stripe captures a destination charge to the business account but CareTip never creates `Transaction` + `EmployeeTipPayable` (webhook loss, handler crash before commit, permanent 500 after event marked processed edge cases), money sits on the **business Stripe balance** with **no employee attribution row**. There is **no automatic recovery job** analogous to transfer-failed retry.

---

## 2. Exact business-distribution money flow

### End-to-end path (CONFIRMED from code)

```
Guest opens tip checkout
  → createTipCheckoutSession()                     [stripe.service.ts]
  → assertEmployeeEligibleForTipPayment()
  → assertBusinessReadyForConnectTipDestination()    [connectTipDestination.service.ts]
  → resolveTipCheckoutRouting()                      [employeeTipRouting.service.ts]
       if employeeTipPayoutMode === business_distribution:
         chargeModel = destination_business
         destinationAccountId = Business.stripeAccountId
         applyApplicationFee = true
  → Stripe Checkout Session created with:
       payment_intent_data.transfer_data.destination = business acct_
       payment_intent_data.application_fee_amount = platform fee
       payment_intent_data.metadata.caretipRoutingMode = business_distribution
       payment_intent_data.metadata.caretipChargeModel = destination_business

Guest pays
  → Stripe charge succeeds on platform PI
  → Stripe creates destination transfer to business connected account (minus application fee)

Stripe webhook checkout.session.completed
  → handleSuccessfulTipPayment()                     [stripe.service.ts]
  → duplicate guard: Transaction.stripePaymentIntentId unique lookup
  → assertPaidTipConnectInvariants()                 [employeeTipRouting.service.ts]
       attributes destination acct_ → business via attributeStripeConnectAccount()
       asserts PI destination === Business.stripeAccountId
  → prisma.$transaction:
       Transaction (tips table) status = success
       createEmployeeTipPayableForSuccessfulTip()
         routingMode = business_distribution (frozen snapshot)
         chargeModel = destination_business
         status = held_business
         payableCents = gross − platform fee
         transferredCents = 0
         stripeDestinationAccountId = business acct_
         stripeTransferId = Stripe destination-charge transfer id (tr_*), NOT emp_tip_release

Business responsibility (off CareTip)
  → Business pays employee outside CareTip (cash, payroll, bank transfer, etc.)
  → CareTip has NO automated step here

Optional later
  → charge.refunded / dispute webhooks adjust payable.refundedCents / status
```

### Database models involved (CONFIRMED)

| Model | Role |
|-------|------|
| `Business` | `employeeTipPayoutMode`, `stripeAccountId`, Connect readiness mirror |
| `Employee` | Tip attribution target |
| `Transaction` (`tips`) | One row per tip; `stripePaymentIntentId` unique |
| `EmployeeTipPayable` | Per-tip employee share ledger; `transactionId` unique |
| `TipRefund` | Refund/dispute events (Stripe SSOT) |
| `StripeWebhookEvent` | Webhook idempotency by Stripe `event.id` |

### Stripe objects involved (CONFIRMED)

| Object | Role |
|--------|------|
| `Checkout.Session` | Guest payment entry |
| `PaymentIntent` | Amount, metadata, `transfer_data`, `application_fee_amount` |
| `Charge` | Underlying card charge |
| `Transfer` (destination) | Stripe auto-transfer to business connected account on destination charge |
| `ApplicationFee` | CareTip platform fee on destination charge |
| `Refund` / `Dispute` | Post-payment adjustments |

---

## 3. Stripe charge model — which account receives money

### Mechanism (CONFIRMED)

Business-distribution checkout uses **Stripe Connect destination charges**:

```657:664:backend/src/services/stripe.service.ts
        ...(routing.destinationAccountId
          ? {
              application_fee_amount: platformFeeCents,
              transfer_data: {
                destination: routing.destinationAccountId,
              },
            }
          : {}),
```

For `business_distribution`, `resolveTipCheckoutRouting()` sets `destinationAccountId` to **`Business.stripeAccountId`** after `assertBusinessReadyForConnectTipDestination()` — never from client metadata or request body.

### Post-payment verification (CONFIRMED)

`assertPaidTipConnectInvariants()`:
1. Reads destination from PaymentIntent (`destinationAccountIdFromPaymentIntent`)
2. Attributes account via `attributeStripeConnectAccount(dest)` — DB mapping only
3. For business attribution: asserts `attribution.businessId === businessId`
4. Asserts `dest === Business.stripeAccountId` via `assertPaymentIntentDestinationMatchesBusiness()`
5. Live-retrieves merchant account and asserts capable before ledger credit

**Money does NOT go to:** employee Connect account (in normal path), CareTip platform balance (except application fee), or another business (cross-tenant checks).

**NOT VERIFIED in this audit:** Live Stripe Dashboard balance for sample business accounts.

---

## 4. Critical invariant — no employee Transfer path

### Release service filters (CONFIRMED)

`releaseHeldPlatformPayablesForEmployee()` only selects:

- `chargeModel: platform_hold`
- `routingMode: direct_to_employee`
- `status ∈ {held_platform, transfer_failed, transferring}`
- `stripeTransferId: null`

`held_business` / `destination_business` / `business_distribution` are **excluded**.

Automated test **CONFIRMED:** `business-held-not-transferred` in `employee-tip-direct-routing-runtime.ts`.

### Payable creation paths (CONFIRMED)

`createEmployeeTipPayableForSuccessfulTip()` is the sole creation path (called from `handleSuccessfulTipPayment` and `handlePaymentSuccess`). For `destination_business`:

- `status = held_business`
- `transferredCents = 0`
- `stripeTransferId` = Stripe **destination** transfer id (if present), not CareTip `emp_tip_release:{id}`

### Can a business-distribution tip become `transfer_failed` / `transferred` via release?

| Target state | Normal `destination_business` path | Notes |
|--------------|-----------------------------------|-------|
| `transferring` | **No** | Not in release query |
| `transfer_failed` | **No** | Release service never claims `held_business` |
| `transferred` (via `emp_tip_release`) | **No** | Release requires `platform_hold` + `direct_to_employee` |

### Exception — `platform_hold` + `business_distribution` (CONFIRMED in DB)

Four rows in the connected database have `routingMode = business_distribution`, `chargeModel = platform_hold`, `status = transferred`, with `stripeTransferId` set via employee release. These **can** enter the release path because filters key off **`chargeModel` + `routingMode`**, not `routingMode` alone.

**INFERRED:** Created when metadata/routing mode was `business_distribution` but PaymentIntent had **no destination** (platform hold), e.g. legacy tests, edge timing, or pre-destination-charge data. Current checkout for active business-distribution mode **always** sets destination when business Connect is ready.

Test **CONFIRMED:** `business-distribution-hold-not-auto-released` — historical `platform_hold` + `business_distribution` rows are **not** auto-transferred while still `held_platform`.

---

## 5. Mode separation

### When routing is evaluated (CONFIRMED)

| Stage | Uses current `Business.employeeTipPayoutMode`? |
|-------|-----------------------------------------------|
| Checkout session creation | **Yes** — `resolveTipCheckoutRouting()` |
| PaymentIntent metadata | **Snapshotted** at checkout |
| Webhook ledger write | **No** — uses `assertPaidTipConnectInvariants()` on PI + metadata |
| Payable row | **Frozen** `routingMode` + `chargeModel` at insert |
| Release / refund / dispute | Uses **frozen** payable fields |

### UI claim vs backend (CONFIRMED)

UI: `"Applies to new employee tips only."` (`en.json` → `business.stripe.tipRouting.hint`)

Backend: `patchMyEmployeeTipPayoutMode()` only updates `Business.employeeTipPayoutMode`. **No code rewrites existing payables.** Test **CONFIRMED:** `mode-switch-does-not-rewrite-payable`.

### Can modes cross-convert after tip creation?

| Transition | Possible? |
|------------|-----------|
| `direct` payable → business-distribution | **No** — frozen fields |
| `business_distribution` payable → employee Transfer | **No** for `destination_business`; **Yes** for anomalous `platform_hold` rows if release runs |
| Historical `held_platform` rerouted when business switches to business_distribution | **No** — old payables keep `direct_to_employee` / `platform_hold` |

---

## 6. Business Stripe account disconnection scenarios

| Scenario | Guest can tip? | Money destination | Transaction recorded? | Employee payable? |
|----------|----------------|-------------------|----------------------|-------------------|
| A. No business Stripe | **No** | N/A | No | No — checkout blocked |
| B. Onboarding incomplete | **No** | N/A | No | No — `assertBusinessReadyForConnectTipDestination` fails |
| C. Account disabled / not ready | **No** (checkout); webhook may refund if paid | N/A / refunded | Failed + refund attempt | No successful payable |
| D. Missing capabilities | **No** at checkout | N/A | No | No |
| E. Business disconnects Stripe | **No** for new tips | N/A | No | No |
| F. Stripe restricted | **No** at checkout; paid tips may hit `failClosedCapturedTipPayment` + refund | Refunded if fail-closed runs | `failed` row possible | No success payable |
| G. Business changes Stripe account | New tips → new `acct_`; old payables keep `stripeDestinationAccountId` | New acct for new tips | Yes for new | Yes — frozen old dest on row |
| H. Stripe API temporary failure | Checkout may fail closed | N/A | No | No |

**CONFIRMED:** Business-distribution mode **requires** business Connect readiness at checkout — unlike direct mode, there is **no platform-hold fallback** when business Stripe is missing.

**INFERRED:** Guest does not see a “success” tip in CareTip if checkout never starts or webhook fail-closed refunds. **Risk remains** if Stripe captures payment but CareTip webhook handler never successfully commits ledger (see §15).

---

## 7. Webhook failure / duplication

### Idempotency layers (CONFIRMED)

| Layer | Mechanism |
|-------|-----------|
| Stripe event | `isStripeWebhookEventProcessed(event.id)` — skip duplicate events |
| Transaction | `stripePaymentIntentId` lookup before insert in `handleSuccessfulTipPayment` |
| Payable | `transactionId` unique; `createEmployeeTipPayable` catches `P2002` |
| Refund | `stripeRefundId` unique on `TipRefund`; `alreadyApplied` gate before `applyRefundToEmployeePayable` |

### Dual handlers (CONFIRMED)

Both `checkout.session.completed` → `handleSuccessfulTipPayment` and `payment_intent.succeeded` → `handlePaymentSuccess` can run. `handlePaymentSuccess` only processes **`pending`** transactions; successful checkout path creates `success` directly, so duplicate payable creation is avoided.

### Architectural gaps (INFERRED / NOT VERIFIED)

- If `handleSuccessfulTipPayment` throws **after** Stripe payment but **before** DB commit, webhook returns **500**, Stripe retries — generally safe due to duplicate guards.
- If handler **returns early** without error (e.g. currency assertion return) after payment captured — **stuck money risk** (fail-closed paths exist for eligibility, not all early returns).
- **No reconciliation cron** to find captured PIs without matching `Transaction`/`EmployeeTipPayable`.

---

## 8. Employee ledger integrity

### How CareTip knows “Employee X is owed €Y” (CONFIRMED)

For each successful tip:

```
grossCents        = PaymentIntent amount (integer cents)
platformFeeCents  = calculateTipPlatformFeeCents(grossCents)
payableCents      = grossCents − platformFeeCents   [employee share attribution]
transferredCents  = 0 for destination_business      [CareTip does not track business→employee payment]
refundedCents     = cumulative refunds
remainingPayableCents = payableCents − transferredCents − reversedCents − refundedCents − disputes
```

**Authoritative “owed to employee” in CareTip:** `remainingPayableCents` on `held_business` rows.

**NOT tracked in CareTip:**
- Amount business actually paid employee
- “Distributed” / “settled by business” state
- Business bank payout timing

### Integrity checks (read-only DB scan — CONFIRMED)

| Check | Result |
|-------|--------|
| Negative `remainingPayableCents` | **0 rows** |
| `transferredCents > payableCents` | **0 rows** |
| Duplicate `transactionId` | **0 rows** |
| Payables without `Transaction` | **0 rows** |
| `destination_business` in `transfer_failed` / `transferring` / `transferred` (release states) | **0 rows** |

---

## 9. Business distribution state machine

### Actual states (CONFIRMED from Prisma enum + code)

```
CHECKOUT (business_distribution + business Connect ready)
  → Stripe destination charge to business
  → held_business (destination_business)
       │
       ├─ partial refund → held_business (refundedCents ↑, remaining ↓)
       ├─ full refund → refunded
       ├─ dispute open → disputedOpenCents > 0 (presentation: disputed)
       └─ dispute lost → disputedLostCents (no platform_hold reversal for destination_business)

NO CareTip state: distributed_to_employee / paid_by_business
```

### Terminal vs non-terminal

| Status | Terminal? | Forward transition in CareTip? |
|--------|-----------|------------------------------|
| `held_business` | **Non-terminal** (refunds/disputes only) | Refund/dispute webhooks only — **not** business distribution |
| `refunded` | Terminal | None |
| `held_business` with partial refund | Non-terminal | More refunds |

**FINDING:** `held_business` can remain **indefinitely** by design — there is no CareTip workflow to close it when the business pays the employee.

---

## 10. Refunds and reversals

### Behavior (CONFIRMED — tests + code)

For `destination_business` payables, `applyRefundToEmployeePayable()`:
- Updates `refundedCents` and possibly `status → refunded`
- Does **NOT** call `maybeReversePlatformHoldTransfer()` (only `platform_hold`)
- Does **NOT** create employee Transfer reversals

Tests **CONFIRMED:** `business-receives-partial-refund`, `business-receives-full-refund`.

### Refund after business manually paid employee (INFERRED risk)

CareTip will reduce `remainingPayableCents` on refund, but has **no record** that the business already paid the employee off-platform. **Accounting inconsistency between business and employee is possible** — CareTip cannot detect it.

### Disputes on destination charges (CONFIRMED)

`applyDisputeToEmployeePayable()` adjusts `disputedOpenCents` / `disputedLostCents`. Platform-hold transfer reversal logic is **skipped** for non-`platform_hold` charge models.

---

## 11. Business Stripe payouts vs employee distribution

**CONFIRMED — separate concepts:**

| Movement | Stripe object | CareTip tracking |
|----------|---------------|------------------|
| Guest tip → business Connect balance | Destination charge `Transfer` (`tr_*` on PI) | `EmployeeTipPayable.stripeTransferId` stores this id for attribution reference; **not** employee payment |
| Business Connect → business bank | `Payout` (`po_*`) on business account | Business billing/payout views — **not** linked to per-employee `held_business` rows |
| Business → employee (manual) | **Outside Stripe/CareTip** | **Not tracked** |

CareTip **cannot** determine from ledger alone whether a business has paid a specific employee share.

---

## 12. Accounting reconciliation

### What CareTip can reconcile (CONFIRMED)

- Per-tip: Stripe PI amount ↔ `Transaction.amount` ↔ `EmployeeTipPayable.grossCents`
- Platform fee: `application_fee_amount` ↔ `platformFeeCents`
- Employee attribution: `payableCents` on `held_business` row
- Destination: `stripeDestinationAccountId` ↔ `Business.stripeAccountId` at tip time

### Gaps (CONFIRMED / INFERRED)

| Scenario | Detectable in CareTip? |
|----------|------------------------|
| Stripe received, no CareTip tip row | **No automatic alert** — manual Stripe/DB reconcile needed |
| CareTip `held_business` owed, business Stripe never received | Webhook invariants make unlikely for normal path; **NOT VERIFIED** against live Stripe |
| Business paid employee, CareTip still shows `held_business` | **Yes** — will show owed until refund; **cannot** mark distributed |
| Business overview total employee obligations (`held_business`) | **No** — `employeeTipHoldObservabilityForBusiness()` only sums `held_platform` |

---

## 13. Cross-tenant isolation

**CONFIRMED from code + tests:**

- Checkout destination from `Business.stripeAccountId` for business’s own `businessId`
- `assertPaidTipConnectInvariants()` asserts `attribution.businessId === businessId`
- `assertPaymentIntentDestinationMatchesBusiness()` asserts PI dest equals current business account
- Employee eligibility tied to `employeeId` + `businessId` on tip metadata
- Test: `cross-tenant-destination-isolated`

**No API found** for business A to mark business B employee distribution.

---

## 14. Comparison: direct_to_employee vs business_distribution

| Dimension | DIRECT_TO_EMPLOYEE | BUSINESS_DISTRIBUTES |
|-----------|-------------------|----------------------|
| Stripe mechanism | Destination to **employee** OR platform hold + later Transfer | Destination to **business** |
| Money lands | Employee Connect or CareTip platform (hold) | Business Connect |
| CareTip payable status | `destination_settled`, `held_platform`, `transferred`, `transfer_failed` | `held_business` |
| `transferredCents` meaning | CareTip-released Stripe Transfer to employee | Stays **0** (not employee SCT) |
| Automatic employee payment | Yes (when connected / after release) | **No** |
| Retry/recovery | `releaseHeldPlatformPayablesForEmployee`, transfer-failed recovery | **None** |
| Refund reversal | Transfer reversal for `platform_hold` | Ledger only |
| Failure state | `transfer_failed` | No equivalent; webhook miss / eternal `held_business` |
| Employee Connect required at checkout | For destination path; hold if not ready | **No** — business Connect required |
| Business pays employee | N/A (automatic path) | **Off-platform responsibility** |

---

## 15. Business-mode equivalent of Charline’s bug

### Charline incident (direct mode recap)

Platform-hold → failed CareTip Transfer → `transfer_failed` → recovery trigger blind spot.

### Business-distribution equivalents

| Scenario | Money safe? | Ledger accurate? | Recoverable? | Auto reconcile? | Can stick forever? |
|----------|-------------|------------------|--------------|-----------------|-------------------|
| Stripe destination charge succeeds; webhook never arrives | Money on **business** Stripe (INFERRED) | **No** Transaction/payable | Manual webhook replay / ops | **No** | **Yes** — highest severity |
| Webhook arrives; `createEmployeeTipPayable` fails after Transaction commit | Money on business; Transaction may exist without payable | **Partial** | Manual payable backfill | **No** | **Yes** |
| Payable `held_business` created; business never pays employee | Money on business (CONFIRMED path) | CareTip shows owed | Business action only | N/A | **Yes** — by design |
| Business pays employee; guest refunds later | Business bears loss off-platform | CareTip reduces owed | N/A | **No** cross-check | N/A |
| `platform_hold` + `business_distribution` row; business later switches to direct | Money may leave platform via **employee** Transfer | Mismatched semantics | Incorrect if unintended | **No** | Until transferred |
| Business changes Stripe `acct_` | New tips to new account | Old rows point at old `stripeDestinationAccountId` | Historical accuracy preserved | Manual | Old rows unchanged |

**Answer:** Yes, an **equivalent class of failure exists**, but it manifests as **missing or stale employee attribution while money sits on the business Stripe account** (or platform hold anomaly), **not** as `transfer_failed`. There is **no** `scheduleReleaseRecoverable…` equivalent for business distribution.

---

## 16. Existing affected records (read-only DB scan)

**Environment:** Connected development/staging database (Supabase), 2026-09-23.

| Metric | Count / value |
|--------|---------------|
| Total `routingMode = business_distribution` payables | **33** |
| `destination_business` + `held_business` | **29** (€1,058.51 sum `payableCents`) |
| `platform_hold` + `transferred` | **4** (anomaly — see §4) |
| `transfer_failed` | **0** |
| Negative remaining balances | **0** |
| Duplicate transaction IDs | **0** |
| `held_business` with `refundedCents > 0` | **0** |

**Sample `held_business` IDs (no PII):** `cmuazyjrr000tn14798ebxjw6`, `cmuazufaz000hn147w1nr0idl`, `cmuagcsec001qoa47j9i64owl` — all `destination_business`, `stripeDestinationAccountId` suffix `…O8I0`.

**Example anomaly IDs:** `cmtvxcrny000fiu48hcr43kdg`, `cmtwx9y5e002aj03qd71csetm` — `platform_hold` + `business_distribution` + `transferred`.

---

## 17. Severity classification

| ID | Finding | Severity |
|----|---------|----------|
| BD-1 | No webhook/ledger reconciliation job for captured PIs without payable | **High** |
| BD-2 | No “distributed by business” state — `held_business` indefinite | **Medium** (by product design; ops risk) |
| BD-3 | Business routing overview omits `held_business` totals | **Medium** |
| BD-4 | Four `platform_hold` + `business_distribution` + `transferred` rows | **Medium** (historical; filter semantics) |
| BD-5 | Refund after off-platform employee payment undetected | **Medium** |
| BD-6 | Normal `destination_business` cannot `transfer_failed` | **N/A — positive** |

### Confirmed bugs

- **BD-3 CONFIRMED:** `employeeTipHoldObservabilityForBusiness()` counts only `held_platform`, not `held_business` — business UI “holds” section invisible for business-distribution obligations.
- **BD-4 CONFIRMED:** Anomalous rows exist in DB (likely historical); release path allowed transfer despite `business_distribution` routing label.

### Potential risks (not proven in production)

- Webhook miss rate and orphan PI count (**NOT VERIFIED** against Stripe Dashboard).
- Businesses systematically not distributing despite `held_business` balances (**NOT VERIFIED** operationally).

---

## 18. Recommended remediation (documentation only — not implemented)

1. **Reconciliation job:** Periodic scan for succeeded Stripe PIs with `caretipRoutingMode=business_distribution` but no `Transaction` / `EmployeeTipPayable` — alert ops.
2. **Business dashboard:** Surface sum of `held_business` `remainingPayableCents` per employee and business-wide (mirror employee payout history “held at venue” totals).
3. **Optional product feature:** Manual “mark distributed” with audit log (does not move Stripe money) to close `held_business` rows.
4. **Anomaly guard:** Block or flag `platform_hold` payables where metadata `caretipRoutingMode=business_distribution` at webhook time (fail-closed or force manual review).
5. **Monitoring:** Metric for `held_business` age > N days per business.

---

## 19. Tests performed

| Activity | Result |
|----------|--------|
| Code trace (checkout, webhook, payable, release, refund) | **Complete** |
| Read-only DB forensic scan | **Complete** — see §16 |
| Referenced automated tests | `employee-tip-direct-routing-runtime.ts` business_distribution cases (not re-run in this audit) |

**Not run:** Live Stripe API queries, production DB, new test execution.

---

## 20. Evidence / source files

| Area | Primary files |
|------|---------------|
| Checkout routing | `backend/src/services/employeeTipRouting.service.ts`, `backend/src/services/stripe.service.ts` |
| Connect readiness | `backend/src/services/connectTipDestination.service.ts` |
| Payable ledger | `backend/src/services/employeeTipPayable.service.ts` |
| Employee release (excluded path) | `backend/src/services/employeeTipRelease.service.ts` |
| Webhooks | `backend/src/webhooks/stripe.webhook.ts`, `backend/src/services/stripeWebhookIdempotency.service.ts` |
| Refunds/disputes | `backend/src/services/finance/tipRefunds.service.ts` |
| Mode API | `backend/src/controllers/employeeTipPayoutMode.controller.ts` |
| UI copy | `src/i18n/locales/en.json` (`business.stripe.tipRouting`) |
| Employee presentation | `backend/src/services/employeePayableActivityPresentation.ts` |
| Regression tests | `backend/scripts/employee-tip-direct-routing-runtime.ts` |
| Schema | `backend/prisma/schema.prisma` (`EmployeeTipPayable`, enums) |

---

## BUSINESS-DISTRIBUTION SAFETY VERDICT

- Money routing: **PASS** (for normal `destination_business` checkout path)
- Business Stripe mapping: **PASS**
- Employee ledger integrity: **PASS** (with design limit: no distribution tracking)
- Webhook idempotency: **PASS** (duplicate protection); reconciliation gap: **UNKNOWN** for orphan PIs
- Refund/reversal integrity: **PASS** (ledger); off-platform overpayment: **UNKNOWN**
- Mode-switch isolation: **PASS** (frozen payables); `platform_hold` anomaly: **FAIL** (4 historical rows)
- Cross-tenant isolation: **PASS**
- Reconciliation: **FAIL** (no orphan-PI job; business overview omits `held_business`)
- Existing affected records: **FOUND** (29 normal `held_business`; 4 anomalous `platform_hold`+`transferred`)

---

## Charline-equivalent answer (concise)

**Yes — a different equivalent exists.** If a business-distribution destination charge **succeeds in Stripe** but CareTip **never creates** the `Transaction` / `EmployeeTipPayable` row, money remains on the **business Stripe account** with **no employee attribution** and **no automatic recovery**. That is the closest analog to Charline’s stuck `transfer_failed` state, except the failure surface is **missing ledger / invisible obligation**, not a failed CareTip Transfer. Separately, even when the ledger is correct, **`held_business` can persist forever** because CareTip intentionally does not move money to employees and provides **no “distributed” completion state**.
