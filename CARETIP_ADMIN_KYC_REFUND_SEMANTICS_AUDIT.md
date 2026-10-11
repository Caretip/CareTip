# CARETIP — Admin KYC State + Refund/Dispute Semantics Audit

**Date:** 2026-10-01  
**Scope:** Platform Admin Overview “Needs attention”, KYC vs onboarding, Refunds page type/status/reason clarity.  
**Constraints:** No Stripe/webhook/financial behavior changes; no KYC product implementation.

---

## Final status

**READY — KYC AND REFUND/DISPUTE SEMANTICS VERIFIED**

(Operational KYC queue removed from Overview; refunds/disputes UI distinguishes type, status, and reason; backend mapping unchanged and correct.)

---

## 1. Source of the former “KYC review(s) pending” alert

| Layer | Location | Behavior |
|--------|-----------|----------|
| UI | `src/app/components/AdminDashboard.tsx` | Previously called `fetchKycQueueMetrics()` and, when `pendingReview > 0`, pushed alert `admin.overview.alerts.pendingKyc`. |
| API | `GET /api/platform/kyc/metrics` → `platform.controller.getKycQueueMetrics` | Returns `getKycQueueMetrics()` from `platformBusinessList.service.ts`. |
| Data | `getKycQueueMetrics()` | Counts businesses with `workflow: "kyc"` and filters such as `kyc_verification_status = pending_review` (same list query as legacy KYC admin queue). |

The count was **real database KYC-field metrics**, not onboarding `submitted` counts. However, **admin KYC management is not shipped**: `MVP_KYC_ADMIN_MANAGEMENT_ENABLED = false` in `src/app/lib/mvpVerificationPolicy.ts`, and `BusinessKycVerificationPage` renders only `PlatformKycComingSoonPage`. Showing an actionable “KYC review pending” on Overview contradicted that product state.

---

## 2. Does a real KYC admin workflow exist?

| Area | Status |
|------|--------|
| DB / API fields (`kyc_verification_status`, documents, `/kyc/metrics`) | Present (future-ready) |
| Platform admin UI to review KYC | **Not operational** — Coming soon page only |
| Admin actions on KYC queue | **Not exposed** in MVP admin route |

**Conclusion:** KYC is **not** an actionable admin workflow today. Overview must not advertise a KYC review queue.

Onboarding verification **is** operational: `BusinessOnboardingVerificationPage` → `BusinessVerificationQueuePage` with `workflow: "onboarding"`, metrics via `fetchOnboardingQueueMetrics`, approve/reject via onboarding APIs.

---

## 3. Onboarding vs KYC confusion

- Overview **onboarding** alert uses `onboardingMetrics.submitted` → copy `admin.overview.alerts.pendingOnboarding` → `/platform-admin/businesses/onboarding-verification`. **Correct.**
- Removed Overview linkage to `pendingKyc` / `fetchKycQueueMetrics`. **No replacement fake KYC count.**
- Nav KYC item still routes to coming-soon surface (`PlatformKycComingSoonPage`) with explicit MVP copy — **not** presented as an operational queue.
- Dead i18n keys `admin.overview.alerts.pendingKyc` remain unused (safe; no UI reference).

`BusinessVerificationPage.tsx` still contains a full `BusinessVerificationQueuePage` implementation for `workflow: "kyc"`, but it is **not mounted** on the KYC route in MVP; only onboarding route uses the queue UI.

---

## 4. Changes made

| Change | Files |
|--------|--------|
| Remove KYC pending from Overview “Needs attention” | `AdminDashboard.tsx` |
| Stop mapping missing reason to ledger `kind` | `src/app/lib/platformRefunds.ts` |
| Shared labels/tones for type, status, reason | `src/app/lib/platformRefundSemantics.ts` |
| Refunds table: **Type**, **Status**, **Reason** columns with `PlatformAdminStatusBadge` | `PlatformRefundsPage.tsx`, `platformAdminMobileCards.tsx` |
| EN/DE copy for event type, unspecified reason, fraudulent hint, clarified `statusReasonNote` | `en.json`, `de.json` |
| Regression script (A–H semantics) | `backend/scripts/admin-kyc-refund-semantics-runtime.ts`, `npm run test:admin-kyc-refund-semantics` |

**Not changed:** Stripe webhooks, `tipRefunds.service.ts` upsert logic, payout/refund processing, onboarding workflow logic, KYC API/schema.

---

## 5. Overview “Needs attention” audit (current)

| Alert ID | Source | Action | Implemented? |
|----------|--------|--------|----------------|
| `health` | `health.database` / `health.stripe` | Open system health | Yes |
| `onboarding` | `onboardingMetrics.submitted` | Onboarding verification queue | Yes |
| `failed-payments` | `subscriptionMonitoring.widgets.failedPaymentsToday` | Subscription management (`filter=failed`) | Yes |
| `at-risk` | Commercial intelligence `atRisk` segment | Commercial reports | Yes |

**Removed:** `pendingKyc` (non-actionable in MVP).

---

## 6. Refund / dispute data model (backend)

**Table:** `TipRefund` (`tip_refunds`), kinds `refund` | `dispute` | `chargeback` (UI treats dispute/chargeback as dispute type).

### Refunds (`upsertStripeRefundEvent` — `tipRefunds.service.ts`)

| Stripe refund status | `TipRefundStatus` |
|----------------------|-------------------|
| `pending`, `requires_action` | `pending` |
| `succeeded` | `succeeded` |
| `failed` | `failed` |
| `canceled` / `cancelled` | `canceled` |

`reason`: Stripe refund reason string stored on `reason` column (independent of status).

### Disputes (`upsertStripeDisputeEvent`)

| Stripe dispute status | `TipRefundStatus` |
|-----------------------|-------------------|
| `won`, `warning_closed` | `won` |
| `lost`, `charge_refunded` | `lost` |
| Other (e.g. `needs_response`, `under_review`) | `needs_response` |

Terminal `won`/`lost` preserved via `mergeDisputeLedgerStatus` when a later non-terminal event arrives.

`reason`: Stripe dispute reason (e.g. `fraudulent`, `duplicate`) stored separately on `reason`.

**Mapping assessment:** Status and reason are **independent**; no change required.

---

## 7. “Fraudulent + Lost” representation

- **Type:** Dispute (`kind` = `dispute`)
- **Status:** Lost (`TipRefundStatus.lost` from Stripe outcome)
- **Reason:** Fraudulent (Stripe `reason` category)

UI copy and `fraudulentHint` state that “fraudulent” is a **Stripe category**, not CareTip’s fraud verdict. **Lost** uses dispute tone (`ledgerStatusTone` → `dispute`), not refund failure tone.

---

## 8. Remaining ambiguity / follow-ups (non-blocking)

1. **KYC metrics API** still returns live counts if called; only Overview alert was removed. KYC route does not display KPI queue in MVP.
2. **Legacy i18n** `pendingKyc` strings unused on Overview.
3. **Unused code path:** `BusinessVerificationQueuePage` with `workflow: "kyc"` remains in source for post-MVP re-enable (`MVP_KYC_ADMIN_MANAGEMENT_ENABLED`).
4. **Chargeback** ledger kind displays as **Dispute** type in UI (`isDisputeLedgerKind` includes `chargeback`) — aligned with operator mental model.

---

## 9. Verification

```bash
npm run test:admin-kyc-refund-semantics
npm run typecheck
npm run build
```

Tests cover: no Overview KYC fetch/alert; coming-soon KYC route; refund/dispute label mapping; lost vs failed tones; EN note wording; refunds page type column and semantics helpers.
