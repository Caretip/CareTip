# Entitlement Parity Audit — Mobile ↔ Web

**Date:** 2026-08-05  
**Scope:** Every mobile API path that touches `scope`, subscription tier, analytics, or Premium-gated features, compared with web and backend rules.

---

## Executive summary

Mobile previously hard-coded Premium stats scopes and treated plan `403`s as role permission failures (“Not available on this account”). That class of bug is fixed for the dashboard path and extended across the app:

| Area | Status |
| --- | --- |
| Dashboard stats | **Parity** — Basic-safe `summary` |
| Analytics stats scope | **Parity** — `full` only for Premium/Enterprise |
| QR analytics | **Fixed** — not fetched on Basic; intentional upgrade EmptyState |
| Customer feedback | **Fixed** — not fetched on Basic; upgrade EmptyState |
| Employee goals / advanced charts | **Fixed** — gated on dashboard for Basic |
| Employee tips | **Parity** — hard-coded `summary` |
| Tips ledger presets | **Parity** — `today`/`week`/`month` only (no custom range) |
| Error taxonomy | **Fixed** — subscription / onboarding / auth / authz are distinct |
| FeatureGate system | **Gap** — mobile uses tier proxy, not web `FeatureGate` capability keys |

---

## Backend entitlement rules (source of truth)

From `backend/src/config/subscriptionCapabilities.ts` and related controllers:

| Resource | Basic allowed | Requires Premium+ |
| --- | --- | --- |
| `GET /api/business/me/stats` scopes `summary`, `roster` | Yes | — |
| Stats scopes `analytics`, `full` | No | `advancedAnalytics` |
| `GET /api/business/qr-analytics` | No | `advancedAnalytics` |
| `GET /api/tips/employee` scopes `account`, `summary` | Yes | — |
| Employee tips scopes `analytics`, `full` | No | `advancedAnalytics` |
| Business tips list + filters (`employeeId`, `custom` range, …) | Presets only | `advancedAnalytics` |
| `GET /api/feedback/business` | No | `customerFeedback` |
| Employee goals APIs | No | `employeeGoals` |

`SUBSCRIPTION_REQUIRED` payload: `{ code: "SUBSCRIPTION_REQUIRED", capability, requiredTier, message }`.  
`ONBOARDING_INCOMPLETE`: separate 403 from onboarding middleware.  
Role denials typically: `{ message: "Insufficient permissions" }` without subscription code.

---

## Endpoint inventory

### 1. `GET /api/business/me/stats`

| | Mobile | Web | Consistent? |
| --- | --- | --- | --- |
| Dashboard | Always `scope=summary` via `resolveDashboardStatsScope` | `summary` if `!advancedAnalyticsEnabled`, else `full` | **Yes** for Basic; mobile keeps `summary` even on Premium (acceptable — KPIs still load) |
| Analytics / Performance / Leaderboard | `resolveAnalyticsStatsScope(tier)` → `full` \| `summary` | Analytics bundle hardcodes `full` behind FeatureGate | **Yes** for Basic (no Premium request); Premium both use rich payload |
| Staff roster | Not on mobile | `roster` / `analytics` by entitlement | N/A (no mobile staff stats page) |

**Files:** `mobile/services/api/businessService.ts`, `useBusinessDashboard.ts`, `useBusinessAnalytics.ts`, web `useBusinessDashboardStats.ts`

---

### 2. `GET /api/business/qr-analytics`

| | Mobile | Web | Consistent? |
| --- | --- | --- | --- |
| Fetch | **Only if** `isPremiumAnalyticsTier` | FeatureGate / `advancedAnalyticsEnabled` | **Yes** after fix |
| Basic UX | Upgrade EmptyState + “Manage plan” | FeatureGate upgrade card | **Yes** (intent) |

**Files:** `useBusinessAnalytics.ts`, `BusinessAnalyticsScreen.tsx`

---

### 3. `GET /api/business/profile`

| | Mobile | Web | Consistent? |
| --- | --- | --- | --- |
| Params | none | none | **Yes** |
| Use | Supplies `subscriptionTier` for client gates | Entitlements hook / capability map | **Partial** — mobile proxies Premium features via tier string |

---

### 4. `GET /api/tips/employee`

| | Mobile | Web | Consistent? |
| --- | --- | --- | --- |
| Scope | Hard-coded `summary` | `summary` first; `analytics` only if entitled | **Yes** for Basic |
| Premium charts | Not requested | Conditional second fetch | Mobile thinner on Premium — **acceptable** |

**File:** `mobile/services/api/employeeService.ts`

---

### 5. `GET /api/tips/business` & `GET /api/tips/employee/list`

| | Mobile | Web | Consistent? |
| --- | --- | --- | --- |
| Ranges | `today` \| `week` \| `month` only | Also exposes `custom` | **Mobile safer** (no custom → no Basic 403) |
| Entity filters | Not exposed in UI | Can trigger advanced gate | **Mobile safer** |
| Error UX | `AccessErrorState` | Mixed | **Improved** |

---

### 6. `GET /api/feedback/business`

| | Mobile | Web | Consistent? |
| --- | --- | --- | --- |
| Fetch | Disabled on Basic | `FeatureGate customerFeedback` | **Yes** after fix |
| Basic UX | Upgrade EmptyState | Upgrade / gate | **Yes** |

---

### 7. `GET /api/business/activity`

No scope/tier params. Not entitlement-gated for advanced analytics. **Consistent / Basic-safe.**

---

### 8. QR inventory / branded QR

No stats `scope`. Verification/capability middleware may return role-style 403s. UI uses `AccessErrorState` (permission vs subscription vs auth). **OK.**

---

### 9. `POST /api/mobile/create-billing-session`

Billing handoff for intentional upgrade flows. **Correct Premium entry point.**

---

### 10. Dead / unused mobile client

`qrService.fetchQrAnalytics` — unused twin of `fetchBusinessQrAnalytics`. Documented; do not call without Premium gate.

---

## Remaining entitlement mismatches

| # | Issue | Severity | Notes |
| --- | --- | --- | --- |
| 1 | Mobile has no `FeatureGate` / capability map — uses `premium`/`enterprise` tier proxy | Medium | Matches current product (Premium bundle) but drifts if Basic ever gains a single capability |
| 2 | Analytics / Performance / Leaderboard routes remain navigable on Basic | Low | Stats request is Basic-safe (`summary`); advanced sections gated. Web often route-gates entire pages |
| 3 | Dashboard always `summary` even on Premium | Low | Web Premium dashboard uses `full` for charts; mobile charts gated + analytics screens use `full` when Premium |
| 4 | Web post-login warm can still request `scope=full` by default | Web-only | Not mobile; noted for web follow-up |
| 5 | Web TipsActivityPage custom range lacks client FeatureGate | Web-only | Mobile does not expose custom range |
| 6 | `billing.updated` realtime event not handled in `RealtimeQueryBridge` | Low | Foreground `AuthSessionSyncBridge` covers resume |

---

## 403 presentation audit

Shared classifier: `mobile/utils/userFacingError.ts`  
Shared UI: `mobile/components/ui/AccessErrorState.tsx`

| Failure class | Detection | User-facing |
| --- | --- | --- |
| **Subscription** | `SUBSCRIPTION_REQUIRED` / `PLAN_LIMIT_EXCEEDED` / message match | Upgrade EmptyState + **Manage plan** (billing handoff) — **not** permission title |
| **Onboarding** | `ONBOARDING_INCOMPLETE` / “Complete onboarding…” | Onboarding EmptyState — distinct title/body |
| **Authentication** | 401 / `AUTH_REQUIRED` / unauthorized | ErrorState with sign-in copy (`errors.unauthorized`) |
| **Authorization** | Remaining 403 / “Insufficient permissions” | “Not available on this account” (`permissionTitle`) |
| **Other** | Network / 5xx / etc. | Retryable ErrorState |

Screens wired through `AccessErrorState`: Business Dashboard, Analytics, Performance, Leaderboard, Employee Dashboard, QR Studio, Tips list, Customer feedback errors.

**Confirmation:** subscription, onboarding, authentication, and authorization errors produce **distinct** user-facing messages. “Not available on this account” is reserved for genuine permission failures.

---

## Premium request policy (mobile)

Mobile **must not** call these on Basic unless showing an intentional upgrade path (no silent 403):

| API | Basic policy |
| --- | --- |
| `/api/business/me/stats?scope=full\|analytics` | Never (dashboard/analytics resolvers) |
| `/api/business/qr-analytics` | Never — upgrade UI instead |
| `/api/feedback/business` | Never — upgrade UI instead |
| Tips with `range=custom` / entity filters | UI does not offer them |

---

## Files changed in this audit pass

- `mobile/utils/businessStatsScope.ts` — `isPremiumAnalyticsTier`
- `mobile/utils/userFacingError.ts` — four-way classification
- `mobile/utils/friendlyError.ts` — re-exports
- `mobile/components/ui/AccessErrorState.tsx` — **new**
- `mobile/features/business/useBusinessAnalytics.ts` — gate QR
- `mobile/features/business/useBusinessCustomerFeedback.ts` — gate feedback
- `mobile/features/business/useBusinessDashboard.ts` — expose `premiumTier`
- Dashboard / Analytics / Performance / Leaderboard / Employee / QR / Tips screens
- `CustomerFeedbackPanel.tsx`
- i18n EN/DE + types
- `mobile/scripts/business-stats-scope-regression.ts`
- This document

---

## Validation

```bash
npx tsx mobile/scripts/business-stats-scope-regression.ts
cd mobile && npm run typecheck
```

### Manual device checklist (required)

For a **new Basic manager** after admin approval, verify each of:

1. Sign up on mobile  
2. Verify email  
3. Complete native onboarding  
4. Wait for admin approval (app left open)  
5. Bring app to foreground  
6. Kill and reopen  
7. Log out and back in  

For **each** case confirm:

- [ ] Dashboard loads (KPIs, not permission EmptyState)  
- [ ] Business logo correct  
- [ ] QR belongs to this business  
- [ ] Business name updates  
- [ ] Verification badge / status updates after approval  
- [ ] Analytics: Basic shows summary KPIs; QR block shows **plan upgrade** (not permission)  
- [ ] No “Not available on this account” unless the account truly lacks role permission  

---

## Architectural recommendations

1. Share a single `resolveStatsScope(entitlements)` module between web and mobile (or OpenAPI-generated client helpers).  
2. Add CI grep forbidding `scope: "full"` / `scope: "analytics"` outside entitlement helpers.  
3. Wire `billing.updated` + `verification_updated` to invalidate profile + entitlements.  
4. Consider a lightweight `GET /api/business/me/entitlements` so mobile does not invent capability maps from tier strings.  
5. Fix web warm-prefetch default `full` and ungated custom tip ranges (web footguns called out above).
