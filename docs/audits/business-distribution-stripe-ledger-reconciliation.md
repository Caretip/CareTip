# Business Distribution — Stripe-to-Ledger Reconciliation (Final)

**Date:** 2026-09-23  
**Type:** Read-only forensic validation — **no repairs**  
**Prior work:** [business-distribution-integrity-hardening.md](./business-distribution-integrity-hardening.md)  
**Stripe mutations:** **ZERO**  
**Database mutations:** **ZERO**

---

## Phase 1 — Stripe dataset discovery

| Capability | Finding |
|------------|---------|
| **Environment** | **TEST** (`sk_test_…`) — not live production |
| **List/search APIs** | `paymentIntents.search` (read-only) |
| **Pagination** | `limit` up to 100; `has_more` + `next_page`; **1 page consumed** (40 results) |
| **Date-range filter** | Search query does not bound `created`; examined range inferred from result timestamps |
| **Metadata filter** | **Supported** via Search: `metadata['caretipRoutingMode']:'business_distribution' AND status:'succeeded'` |
| **Retrieve by ID** | **Supported** (`paymentIntents.retrieve`) — used for DB-reverse sweep |
| **Checkout Sessions** | Correlatable via `payment_intent` on session; not required for this audit |
| **Destination** | `transfer_data.destination` readable on PI |
| **Application fee** | `application_fee_amount` readable on PI |
| **Charge ID** | `latest_charge` readable (expanded in search) |

**CareTip metadata keys (actual, not assumed):**

- `businessId`, `employeeId`, `caretipRoutingMode`, `caretipChargeModel`
- **Not used:** `caretipBusinessId`, `caretipEmployeeId`

**Limitation — cannot claim blind all-time Stripe sweep:**

1. Search only returns PaymentIntents that **already carry** `caretipRoutingMode=business_distribution` metadata.
2. **3 legacy destination-charge tips** (~2026-09-10) have **null** `caretipRoutingMode` on Stripe but valid CareTip ledger rows — invisible to metadata search.
3. This audit ran against **Stripe TEST**, not production live keys.
4. Full historical PI enumeration without metadata would require unfiltered list + client-side classification (expensive; not executed).

**Mitigation applied:** DB-reverse sweep of all `destination_business` + `business_distribution` payables (29 rows), retrieving each PI by ID from Stripe.

---

## Phase 2 — Authoritative business-distribution match

A candidate is **authoritative business distribution** only when Stripe evidence proves:

- `status === succeeded`
- `metadata.caretipRoutingMode === business_distribution`
- `metadata.businessId` and `metadata.employeeId` present
- `metadata.caretipChargeModel === destination_business`
- `transfer_data.destination` is a Connect `acct_…` (destination charge)

**Excluded from authoritative BD (14 of 40 search hits):**

- `caretipChargeModel === platform_hold` with `business_distribution` metadata — these are platform-hold / employee-transfer paths, not business destination charges.

---

## Phase 3 — CareTip correlation (forward: Stripe → ledger)

**Search query examined:** 40 succeeded PIs with `caretipRoutingMode=business_distribution`  
**Authoritative BD:** 26  
**Date range:** 2026-09-10T16:59:12Z → 2026-09-21T08:42:17Z (UTC)

| Classification | Count |
|----------------|------:|
| HEALTHY | **26** |
| TRANSACTION_MISSING | **0** |
| PAYABLE_MISSING | 0 |
| PAYABLE_MISMATCH | 0 |
| BUSINESS_DESTINATION_MISMATCH | 0 |
| EMPLOYEE_ATTRIBUTION_MISMATCH | 0 |
| DUPLICATE_LEDGER | 0 |
| NON_BUSINESS_DISTRIBUTION | 14 |
| UNCLASSIFIABLE | 0 |

**Orphan class (`TRANSACTION_MISSING`):** **none found** in authoritative BD cohort.

---

## Phase 3b — DB-reverse correlation (ledger → Stripe)

All **29** `EmployeeTipPayable` rows with `routingMode=business_distribution` + `chargeModel=destination_business`:

| Check | Count |
|-------|------:|
| HEALTHY (PI succeeded, dest matches, amounts consistent) | **29** |
| Stripe PI not found | 0 |
| Stripe not succeeded | 0 |
| Destination mismatch | 0 |
| Ledger fee/amount mismatch | 0 |
| Legacy (PI missing `caretipRoutingMode` metadata on Stripe) | 3 |

The 3 legacy rows are **not orphans** — Stripe captured to business Connect account and CareTip ledger exists; they predate PI metadata tagging.

---

## Phase 4 — Accounting check (HEALTHY rows)

For all 26 forward-classified HEALTHY destination charges (and all 29 reverse HEALTHY):

- `Transaction.amount` === Stripe `amount_received` (gross)
- `EmployeeTipPayable.platformFeeCents` === Stripe `application_fee_amount`
- `EmployeeTipPayable.payableCents` === gross − platform fee
- `Business.stripeAccountId` === `transfer_data.destination`
- `routingMode=business_distribution`, `chargeModel=destination_business`, `status=held_business`

**No accounting mismatches detected.**

---

## Phase 5 — Historical anomalies (unchanged, not repaired)

| Payable ID | chargeModel | status | transferredCents | Classification |
|------------|-------------|--------|------------------|----------------|
| `cmtvxcrny000fiu48hcr43kdg` | platform_hold | transferred | 851 | historical test-era platform_hold employee transfer |
| `cmtvyrgmo003aiu48k1sl6rqy` | platform_hold | transferred | 851 | historical test-era platform_hold employee transfer |
| `cmtw24gpw000nop484v0e5a7f` | platform_hold | transferred | 851 | historical test-era platform_hold employee transfer |
| `cmtwx9y5e002aj03qd71csetm` | platform_hold | transferred | 4451 | historical test-era platform_hold employee transfer |

All four retain `stripeTransferId` (employee Transfer release), not business destination charges. **No repair applied.**

---

## Phase 6 — Coverage statement

**What was proven (TEST environment):**

> Every known business-distribution **destination charge** in CareTip TEST (29 payables) has a succeeded Stripe PaymentIntent with matching destination and amounts.

> Every metadata-tagged authoritative BD PaymentIntent in Stripe TEST search (26) has matching Transaction + EmployeeTipPayable.

**What was NOT proven:**

- Live/production Stripe reconciliation
- Universal enumeration of all Stripe PIs ever (metadata-unfiltered full account sweep)
- That zero orphans exist outside the TEST date window or before metadata tagging began

**DB scanner context (separate issue):** `scanBusinessDistributionLedgerIssues` reports **333** issues globally, dominated by `success_transaction_missing_payable` (329) — legacy/test seed noise, **not** demonstrated to be business-distribution destination orphans from this Stripe sweep.

---

## Phase 7 — Orphan findings

**None.** No `TRANSACTION_MISSING` or other integrity mismatch in authoritative business-distribution destination-charge cohort.

---

## Phase 8 — Test-mode safety

Stripe key prefix: `sk_test_` → **TEST mode confirmed** before any API read. No write endpoints invoked.

---

## Phase 9 — Regression check

This reconciliation used ephemeral read-only audit scripts only. **No application behavior changed:**

- Authentication untouched
- AppLoadingManager / white-screen / navigation holds untouched
- Stripe subscription/billing untouched
- Direct-to-employee transfer recovery untouched
- Business-distribution routing untouched

---

## Phase 10 — Final report

| # | Item | Result |
|---|------|--------|
| 1 | Stripe environment/mode | **TEST** (`sk_test_`) |
| 2 | Date range examined | 2026-09-10 → 2026-09-21 UTC |
| 3 | Stripe PaymentIntents examined (search) | **40** |
| 4 | Classified as authoritative Business Distribution | **26** (+ 3 legacy via DB-reverse, not in search) |
| 5 | HEALTHY | **26** forward; **29** DB-reverse (includes 3 legacy) |
| 6 | TRANSACTION_MISSING | **0** |
| 7 | PAYABLE_MISSING | **0** |
| 8 | PAYABLE_MISMATCH | **0** |
| 9 | BUSINESS_DESTINATION_MISMATCH | **0** |
| 10 | EMPLOYEE_ATTRIBUTION_MISMATCH | **0** |
| 11 | DUPLICATE_LEDGER | **0** |
| 12 | UNCLASSIFIABLE | **0** |
| 13 | Full Stripe search pagination completed? | **Yes** (1 page, 40 results, `has_more=false`) |
| 14 | Orphan money-flow cases found? | **No** |
| 15 | Stripe mutations | **0** |
| 16 | DB mutations | **0** |
| 17 | Remaining limitation | Metadata-tagged search misses pre-metadata PIs; TEST-only; no live prod sweep; global `success_transaction_missing_payable` is a separate ledger hygiene signal |
| 18 | Production monitoring recommendation | See below |

### Production monitoring recommendation

1. **Scheduled read-only job** (internal, detection-only): Stripe Search for `caretipRoutingMode=business_distribution` + `status:succeeded` in **live** mode; classify with `classifyCapturedPaymentIntentLedger`; alert on `TRANSACTION_MISSING`.
2. **DB-reverse supplement**: nightly list of new `destination_business` payables → retrieve PI by ID (catches legacy-style rows without metadata).
3. **Do not auto-repair** — alert ops with PI id, amount, destination `acct_`, business/employee metadata.
4. Retain existing `business-distribution-integrity-scan` internal endpoint for ledger-side anomalies.
5. Before first live run: verify `STRIPE_SECRET_KEY` prefix is intentional (`sk_live_` vs `sk_test_`).

---

## Verdict

**No orphan business-distribution destination charges detected** in the audited TEST Stripe dataset and full TEST CareTip `destination_business` payable population.

The orphan-payment **class remains theoretically possible** (webhook failure without retry) but **was not observed** in this reconciliation. Detection is **reliable when combining** metadata Stripe Search + DB-reverse PI retrieve; metadata-only search alone is **incomplete** for pre-metadata tips.
