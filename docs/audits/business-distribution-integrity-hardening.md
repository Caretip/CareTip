# Business-Distribution Money-Integrity Hardening

**Date:** 2026-09-23  
**Prior audit:** [business-distribution-tip-money-flow-audit.md](./business-distribution-tip-money-flow-audit.md)  
**Stripe mutations performed:** **ZERO**  
**Database mutations performed:** **ZERO** (test fixtures only in isolated runtime script)

---

## 1. Executive summary

Forensic revalidation confirmed the primary business-distribution path is correct (`destination_business` → `held_business`, no employee Transfer release). The proven integrity gap is **detection**: a captured Stripe destination charge can exist without a CareTip `Transaction` + `EmployeeTipPayable` if webhook processing fails permanently or returns early without retry.

**Remediation delivered (detection + observability only):**
- Read-only ledger integrity scanner (`scanBusinessDistributionLedgerIssues`)
- PaymentIntent-vs-ledger classifier for ops/tests (`classifyCapturedPaymentIntentLedger`)
- Business dashboard observability for `held_business` obligations + aged warnings
- Internal cron endpoint for detection-only scans
- Focused regression tests (`test:business-distribution-integrity`)

**Not implemented (by design):** automatic money repair, Stripe API reconciliation cron, “mark distributed” workflow, invariant rejection for historical `platform_hold` + `business_distribution` rows.

---

## 2. Exact business_distribution money flow (CONFIRMED)

See prior audit §2. Atomicity boundary:

```
handleSuccessfulTipPayment()
  → validations (may fail-closed + refund)
  → prisma.$transaction {
       Transaction.create (success)
       createEmployeeTipPayableForSuccessfulTip()
     }
```

`Transaction` + `EmployeeTipPayable` are created in **one DB transaction** — no split-commit path in the happy path.

`handlePaymentSuccess()` (pending-transaction path) uses the same single-transaction pattern for success + payable.

---

## 3. Are orphan Stripe payments possible?

**CONFIRMED: YES** — in these proven cases:

| Case | Stripe paid? | CareTip ledger? | Retry? |
|------|--------------|-----------------|--------|
| Handler throws before commit (non-P2002) | Yes | No | Stripe retries webhook (500) |
| Handler returns early (currency violation, missing PI) | Yes | No | Event may still be marked processed if handler completed |
| Crash after commit, before `markStripeWebhookEventProcessed` | Yes | Yes | Safe duplicate skip |
| Permanent webhook delivery failure | Yes | No | **No automatic detection without ops scan** |

**INFERRED:** Stripe webhook retries cover most transient failures. They do **not** guarantee eventual ledger creation if all retries exhaust or early-return paths acknowledge without ledger.

---

## 4. Atomicity / idempotency weakness

**CONFIRMED strengths:**
- `Transaction` + `EmployeeTipPayable` same `$transaction` on success path
- `stripePaymentIntentId` duplicate guard before insert
- `transactionId` unique on payables; P2002 swallowed on replay
- `StripeWebhookEvent` id processed after handler completes (not before)

**CONFIRMED gap:**
- No DB-only detector for Stripe-side captured PIs without Transaction (requires Stripe read or webhook log correlation)
- `scanBusinessDistributionLedgerIssues` detects **Transaction without payable** and payable anomalies; `classifyCapturedPaymentIntentLedger` detects **PI without Transaction** when PI object is supplied (tests/ops)

---

## 5. Webhook retry guarantees

**CONFIRMED:**
- Duplicate `event.id` skipped via `isStripeWebhookEventProcessed`
- Duplicate `payment_intent` skipped via Transaction lookup / P2002
- `checkout.session.completed` and `payment_intent.succeeded` do not double-create when first path succeeds

**NOT VERIFIED:** Stripe retry policy exhaustion rate in production.

---

## 6. Historical anomaly investigation (4 rows — READ ONLY)

| Payable ID | PI | chargeModel | status | stripeDestinationAccountId | Business acct now | Employee received? |
|------------|-----|-------------|--------|---------------------------|-------------------|-------------------|
| `cmtvxcrny000fiu48hcr43kdg` | `pi_3UEDiI66w930Tx0A1rkvEtC7` | platform_hold | transferred | `acct_1UDur566w9huq7LT` (employee) | `acct_1U3uyj66w9gjO8I0` | **CONFIRMED** — `transferredCents=851`, `tr_3UEDiI…` |
| `cmtvyrgmo003aiu48k1sl6rqy` | `pi_3UEEKR66w930Tx0A1t5pW4qL` | platform_hold | transferred | employee acct | business acct | **CONFIRMED** employee transfer |
| `cmtw24gpw000nop484v0e5a7f` | `pi_3UEFnU66w930Tx0A1un8vxBY` | platform_hold | transferred | employee acct | business acct | **CONFIRMED** employee transfer |
| `cmtwx9y5e002aj03qd71csetm` | `pi_3UETPQ66w930Tx0A0ak7dia1` | platform_hold | transferred | `acct_1UE9c566w9kBdfyT` (employee) | business acct | **CONFIRMED** — €44.51 transferred |

**Findings (CONFIRMED):**
1. All four are **Sep 10–11, 2025** test-era rows for business “Maria Testerin”
2. `routingMode=business_distribution` but `chargeModel=platform_hold` — **not** destination_business
3. `stripeDestinationAccountId` points to **employee** Connect accounts, not business
4. Business is now `direct_to_employee`; these were released via **employee platform-hold Transfer path**
5. **Business did NOT receive destination charge** — platform_hold + employee Transfer semantics
6. **Do not auto-repair** — money already transferred to employees; rows are historical test artifacts

**Future invariant recommendation (document only):** Reject **new** `platform_hold` payables when PI metadata `caretipRoutingMode=business_distribution` AND PI has business destination — **do not apply retroactively** to these four rows.

---

## 7. Reconciliation architecture (implemented)

### Detection service
`backend/src/services/businessDistributionIntegrity.service.ts`

| Function | Purpose |
|----------|---------|
| `scanBusinessDistributionLedgerIssues()` | DB-only scan: missing payables, destination mismatch, anomalies, aged `held_business` |
| `classifyCapturedPaymentIntentLedger()` | Compare captured PI + authoritative DB rows (no writes) |
| `businessDistributionObservabilityForBusiness()` | Aggregates for business UI |
| `listBusinessDistributionObligationsForBusiness()` | Per-employee obligation list |

### Ops endpoint (detection only)
`POST /api/internal/jobs/business-distribution-integrity-scan`  
Requires `x-cron-secret`. Logs warnings; returns issue JSON. **No mutations.**

### Manager API
- `GET /api/me/connect/employee-tip-routing-overview` — extended with `heldBusinessCents`, aged counts
- `GET /api/me/connect/business-distribution-obligations` — obligation list
- `GET /api/me/connect/business-distribution-integrity` — tenant-scoped issue list

---

## 8. Files changed

| File |
|------|
| `backend/src/services/businessDistributionIntegrity.service.ts` |
| `backend/src/controllers/employeeTipPayoutMode.controller.ts` |
| `backend/src/routes/connect.routes.ts` |
| `backend/src/routes/internalJobs.routes.ts` |
| `backend/scripts/business-distribution-integrity-runtime.ts` |
| `backend/package.json` |
| `src/app/lib/api.ts` |
| `src/app/components/business/settings/billing/BusinessPayoutsCareTipView.tsx` |
| `src/i18n/locales/en.json` |
| `src/i18n/locales/de.json` |

---

## 9. Files intentionally untouched

- JWT/auth middleware, refresh tokens, Web Locks, logout, idle session
- `AppLoadingManager`, `PublicRouteChunkHold`, boot bridge, navigation holds
- Stripe subscription/billing webhooks and checkout return
- `employeeTipRelease.service.ts` (release logic unchanged)
- `employeeTipRouting.service.ts` checkout routing
- `stripe.webhook.ts` idempotency lifecycle
- Bank payout processing
- Legal document loaders
- Charline / transfer-failed recovery paths

---

## 10. Database migrations

**None.**

---

## 11. Tests run

| Test | Result |
|------|--------|
| `npm run test:business-distribution-integrity` | **PASS** (17/17) |
| `npm run test:employee-tip-direct-routing` | **PASS** (42/42) |
| `npm run test:employee-transfer-failed-recovery` | **PASS** (5/5) |
| `npm run typecheck` (frontend) | **PASS** |
| `npx tsc --noEmit` (backend) | **PASS** |
| `npm run build` (frontend) | **PASS** |
| `npm run build` (backend) | **FAIL** — Prisma `EPERM` DLL lock (dev server); `tsc` green |

---

## 12. Regression results

| Area | Result |
|------|--------|
| Authentication | **PASS** — not modified |
| White-screen / loading | **PASS** — not modified |
| Direct-to-employee / transfer recovery | **PASS** — tests unchanged |
| Business-distribution routing | **PASS** |
| Cross-tenant isolation | **PASS** — classifier flags metadata/business mismatch |
| Stripe mutations | **ZERO** |

---

## 13. Remaining risks

1. **Orphan PI detection** requires Stripe API read or webhook log correlation — DB scan alone cannot find PIs with no Transaction
2. **Aged `held_business`** is visible but has no automated business notification email
3. **Four historical anomalies** remain in DB — flagged, not modified
4. **No “mark distributed”** — businesses can underpay employees without CareTip detection

---

## IMPLEMENTATION STATUS

| Item | Status |
|------|--------|
| Forensic audit | **PASS** |
| Detection service | **PASS** |
| Business observability | **PASS** |
| Aged obligation visibility | **PASS** |
| Anomaly investigation | **PASS** (read-only) |
| Automatic money repair | **NOT IMPLEMENTED** (by design) |
| Stripe mutations | **ZERO** |
| Production DB mutations | **ZERO** |
