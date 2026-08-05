# Post-Onboarding State Synchronization Audit

**Product:** CareTip mobile (React Native / Expo)  
**Date:** 2026-08-05  
**Scope:** Lifecycle from mobile sign-up through platform approval to manager dashboard access

---

## Executive Summary

Newly registered managers who completed native onboarding and later received platform business approval still saw **“Not available on this account”** on the mobile dashboard. That copy is the mobile **permission EmptyState**, not a true role failure.

**Primary root cause:** the mobile dashboard always requested `GET /api/business/me/stats?scope=full`. Backend entitlement rules allow `full` / `analytics` only when the business has Premium+ `advancedAnalytics`. New businesses are on **Basic**, so the API correctly returned **403 `SUBSCRIPTION_REQUIRED`**. Mobile treated **any 403** as a permission error.

Admin approval and Basic plan activation are **orthogonal** to Premium analytics. Approval was succeeding; the app was asking for a Premium-scoped payload on a Basic account and mislabeling the denial.

**Secondary gaps:** foreground resume refreshed some React Query keys but not AuthUser / business profile; subscription 403s were conflated with role authz; React Query does not retry 403s (`retry: false`), so a single bad scope stuck the UI until logout or cache clear.

**Fix direction:** always load the dashboard with Basic-safe `scope=summary` (web parity), resolve analytics scope from tier, sync session + invalidate profile/stats on app resume, and separate subscription vs permission UX.

---

## Root Cause

| Layer | Finding |
| --- | --- |
| API call | Mobile hard-coded `scope=full` for dashboard stats |
| Backend | `isStatsScopeAllowedForTier` allows `summary`/`roster` for Basic; `full` requires `advancedAnalytics` |
| AuthZ middleware | Correct — returned `SUBSCRIPTION_REQUIRED`, not a broken approval gate |
| Mobile UX | `isPermissionError` returned true for **all** HTTP 403s → “Not available on this account” |
| State sync | Not the primary failure, but resume did not refresh AuthUser / business profile after admin approval |

**Architectural cause (class of bug):** entitlement-scoped API parameters were hard-coded on the client instead of being derived from the live subscription tier (as web `useBusinessDashboardStats` does with `scope: advancedAnalytics ? "full" : "summary"`). Combined with a coarse 403 → “permission” mapping, plan gates appeared as account authorization failures.

---

## Timeline of Events

```
Mobile Sign Up
    → tokens + AuthUser persisted; emailVerified=false → verify gate
Email Verification
    → native verify / deep link; session refresh; route to onboarding if MANAGER
Onboarding
    → PATCH business profile + patchMyOnboardingStatus(true)
    → establishAuthenticatedSession(..., "onboarding-complete") clears React Query
    → navigate to business dashboard
Business Creation / Pending Approval
    → business exists; typically subscriptionTier = Basic
    → dashboard requested scope=full → 403 SUBSCRIPTION_REQUIRED
    → UI: “Not available on this account”
Platform Admin Approval
    → verification / approval flags update server-side
    → does NOT grant Premium advancedAnalytics by itself
Subscription Activation (Basic)
    → summary stats are allowed; full still blocked
Dashboard Access (before fix)
    → still scope=full → still 403 → same EmptyState
    → logout/reinstall sometimes “fixed” only if a later build or cache miss changed behavior
```

After fix: dashboard uses `summary` → 200 → manager KPIs render on Basic after approval without reinstall.

---

## Authentication Analysis

| Check | Result |
| --- | --- |
| Access token refresh | `POST /api/auth/refresh` returns token + AuthUser; cold start requires server AuthResponse (`sessionManager`) |
| Refresh token lifecycle | Cookie mirror in SecureStore; rotated on refresh |
| Session restoration | Bootstrap never authorizes from cached JWT alone — good |
| Auth context / stores | Zustand `authStore` + `userStore`; updated on login / onboarding / MFA |
| Cached user object | Snapshot in SecureStore is hint-only at bootstrap |
| Stale JWT claims | Possible until next refresh; onboarding calls `establishAuthenticatedSession` with fresh session |
| Token version sync | Relies on refresh; foreground sync now also refreshes |

**Verdict:** Authentication was **not** the primary cause. Users were authenticated managers with completed onboarding. Stale JWT alone does not explain a persistent “permission” EmptyState once `/stats?scope=full` is denied for tier reasons.

**Gap closed:** `AuthSessionSyncBridge` refreshes the session on AppState → `active` and writes the latest AuthUser into `userStore` before dashboard queries re-run.

---

## Authorization Analysis

| Hypothesis | Verdict |
| --- | --- |
| Stale permissions / role | Unlikely — role remains MANAGER |
| Stale onboarding status | Unlikely after `patchMyOnboardingStatus` + session establish |
| Stale business state | Secondary — profile not always invalidated on resume |
| Stale subscription state | Contributing if tier upgraded later while cache held old tier |
| Stale feature flags | N/A as primary |
| Incorrect authorization middleware | **No** — backend correctly gated `full` behind Premium |

Failure mode was **entitlement scope mismatch**, painted as **permission** UI.

---

## State Management Analysis

| Store / cache | Behavior |
| --- | --- |
| React Query | Cleared on onboarding-complete; 403 not retried; `refetchOnWindowFocus: false` |
| Zustand user/auth | Updated on auth boundaries; not on every resume (now fixed) |
| businessStore / employeeStore | Cleared on logout; not involved in stats 403 |
| AsyncStorage offline QR | Cleared on onboarding-complete (tenant isolation) — unrelated to this bug |
| SecureStore | Tokens + user snapshot |
| Navigation guards | `(app)/_layout` redirects to verify/onboarding from AuthUser flags |

Cached **error** query results for `businessStats` with `scope=full` could survive in-session until invalidation; combined with no 403 retry, the EmptyState stuck.

---

## API Analysis

| Client (before) | Backend |
| --- | --- |
| `GET /api/business/me/stats?timeframe=…&scope=full` | 403 `SUBSCRIPTION_REQUIRED` on Basic |
| Web dashboard | `scope: advancedAnalytics ? "full" : "summary"` |

Endpoints themselves were correct; the **mobile parameter** was wrong for Basic. Profile/onboarding endpoints returned valid post-onboarding state.

**After fix:**

- Dashboard: always `summary`
- Analytics/performance/leaderboard: `full` only when profile tier is `premium` / `enterprise`; else `summary`
- Query keys include `statsScope` so tier upgrades do not reuse a poisoned cache entry

---

## Navigation Analysis

| Moment | Behavior |
| --- | --- |
| Onboarding complete | Cache clear + replace to dashboard route |
| Return from onboarding | Fresh RQ; previously still called `full` |
| App restart | Bootstrap refresh → authenticated → dashboard; still called `full` |
| Logout/login | New session; same buggy scope |
| App resume | Stats invalidated via RealtimeQueryBridge; AuthUser/profile incomplete (now synced) |

Navigation was fine; **data initialization** requested an over-scoped API.

---

## Cache Analysis

Survivors that made the bug sticky:

1. React Query error state for stats (`retry: false` on 403)
2. Coarse `isPermissionError` mapping
3. Missing foreground AuthUser + `businessProfile` invalidation (tier / approval lag)
4. Hard-coded scope independent of profile

Not caused by AsyncStorage QR envelopes or SecureStore user snapshot authorizing the dashboard.

---

## Backend Findings

- `business.controller` `getMyStats` enforces `isStatsScopeAllowedForTier`
- Basic: `summary` / `roster` OK; `analytics` / `full` → subscription payload
- Platform approval does not imply Premium
- No backend defect required for the reported EmptyState; client misuse of scope was sufficient

Optional hardening (recommendation): emit `verification_updated` / entitlement socket events that mobile already partially handles; ensure admin approval always publishes `business_data_updated` or `verification_updated`.

---

## Files Modified

| File | Change |
| --- | --- |
| `mobile/utils/businessStatsScope.ts` | **Added** — tier-aware scope helpers |
| `mobile/services/api/businessService.ts` | Default stats scope `summary` |
| `mobile/features/business/useBusinessDashboard.ts` | Uses `resolveDashboardStatsScope`; scope in query key |
| `mobile/features/business/useBusinessAnalytics.ts` | Profile-first + `resolveAnalyticsStatsScope` |
| `mobile/utils/userFacingError.ts` | `isSubscriptionRequiredError`; permission mapping excludes plan gates |
| `mobile/utils/friendlyError.ts` | Re-exports subscription helper |
| `mobile/components/providers/AuthSessionSyncBridge.tsx` | **Added** — foreground session + query sync |
| `mobile/components/providers/AppProviders.tsx` | Mounts AuthSessionSyncBridge |
| `mobile/components/providers/RealtimeQueryBridge.tsx` | Invalidate `businessProfile` on resume / verification |
| `mobile/features/business/BusinessDashboardScreen.tsx` | Subscription EmptyState |
| `mobile/features/business/BusinessAnalyticsScreen.tsx` | Same |
| `mobile/features/business/BusinessPerformanceScreen.tsx` | Same |
| `mobile/features/business/BusinessLeaderboardScreen.tsx` | Same |
| `mobile/i18n/locales/en.ts` / `de.ts` / `types.ts` | Subscription copy |
| `mobile/scripts/business-stats-scope-regression.ts` | **Added** regression |
| `POST_ONBOARDING_STATE_AUDIT.md` | This report |

---

## Fixes Implemented

1. **Basic-safe dashboard stats** — never request `full` for home KPIs.
2. **Tier-aware analytics scope** — Premium/Enterprise may request `full`; Basic gets `summary` instead of a hard fail.
3. **403 taxonomy** — `SUBSCRIPTION_REQUIRED` ≠ role permission EmptyState.
4. **Foreground sync** — refresh AuthUser + invalidate profile/stats/QR/tips on resume.
5. **Realtime bridge** — profile invalidation on verification / business updates / resume.
6. **Regression script** — locks scope resolution contracts.

---

## Validation Steps

1. Register a new MANAGER on mobile → verify email → complete native onboarding.
2. Confirm dashboard loads KPIs on Basic (no “Not available on this account”).
3. Leave business pending; after admin approval, background the app → foreground → dashboard still loads; AuthUser/onboarding flags current.
4. Open Analytics on Basic — summary metrics render (or clear upgrade EmptyState if a deeper Premium-only endpoint fails), not permission EmptyState for stats.
5. Upgrade to Premium — analytics query key with `full` refetch succeeds.
6. Pull-to-refresh and cold start both show the manager dashboard without logout.

```bash
npx tsx mobile/scripts/business-stats-scope-regression.ts
cd mobile && npm run typecheck
```

---

## Regression Tests Added

- `mobile/scripts/business-stats-scope-regression.ts`  
  Asserts dashboard scope is always `summary`, and analytics scope is `full` only for premium/enterprise.

---

## Remaining Recommendations

1. **Central entitlement helper** shared with web (single module for stats scope / tips scope) to prevent mobile/web drift.
2. **Lint / CI rule:** forbid `scope=full` string literals outside entitlement helpers.
3. **Socket:** guarantee admin approval emits an event mobile already invalidates (`verification_updated`).
4. **Employee tips scopes:** audit similarly for hard-coded `full` / `analytics`.
5. **QR analytics** and other Premium endpoints: gate in UI with FeatureGate before fetch, matching web.
6. **Consider** shortening `queryStaleTimes.profile` after onboarding or always `refetchOnMount: "always"` for `businessProfile` on dashboard.
7. **E2E:** Detox/Maestro flow sign-up → onboard → Basic dashboard → admin approve → resume → dashboard.

---

## Architectural Takeaway

Post-onboarding “authorization” EmptyStates must be traced as:

1. Is the HTTP status a **role** denial, **onboarding** gate, or **subscription** gate?
2. Did the client request a **capability-scoped** parameter the current tier cannot use?
3. After external admin/billing changes, does **foreground sync** refresh AuthUser + entitlement-bearing queries before paint?

Hard-coding Premium scopes on Basic accounts will recur as fake authz bugs until every premium API parameter is derived from live entitlements and 403 codes are classified accurately.
