# CareTip Mobile — Flashing, Flickering & Visual Instability Audit

**Date:** 2026-08-10 (updated 2026-08-11 — logout flicker)  
**Scope:** CareTip mobile app (`mobile/`) visual stability only  
**Constraint:** No new loading pages/branded splash redesigns; no API/authz/tenant/onboarding behavior changes

---

## Logout flash / flicker follow-up (2026-08-11)

Physically observed: a few-millisecond flash when tapping **Sign Out**, before login settled.

### Root cause

The flicker was **not** a missing splash. It was teardown order + Expo Router group animation + a second `router.replace`:

1. **`await authService.logout()` ran before `setUnauthenticated`.** Authenticated dashboard stayed mounted (and eligible) during the network round-trip. In-flight React Query then emptied stores/cache while `(app)` Stack was still on screen → skeleton / empty dashboard frame.
2. **Root `Stack` used `animation: "fade"` (220ms)** for `(app)` → `(auth)`. Unmounting the dashboard left a hole; the fade composited that hole over `NativeSplashGate` orange / theme white for a few ms.
3. **Double navigation:** `(app)` layout `Redirect` **and** `router.replace("/(auth)/login")` from Sign Out callers (idle bridge, admin, privacy delete). Two route commits = a double swap.
4. **401 / refresh races during teardown** could call `notifySessionExpired` → a second `signOut` while the first was in flight.

Intermediate UI during the flash: **authenticated dashboard (or its emptied/skeleton state) fading through an empty `(app)` hole**, briefly showing **orange (splash gate) or white (theme stack bg)** before login. Not a new loading route.

### Exact fix

No new loading page, no branded splash, no `setTimeout` to hide the flash.

- **Same tick as Sign Out tap:** `beginAuthLogoutTransition()` + `setUnauthenticated()` + `bumpAuthSessionEpoch()` **before any await**. `(app)` Stack is ineligible that frame.
- **Single navigation:** layout `Redirect` only. Callers must not `router.replace`.
- **`(app)` hole** is the auth canvas (`authBrand.dark`), not orange/white/null.
- **Root / auth stacks:** `animation: "none"` while logout is active or the session is unauthenticated, so the group swap is one commit.
- **401 interceptor** skips refresh + `notifySessionExpired` while the logout flag is set; idle 401 path unchanged.
- Session revoke/clear still runs (`authService.logout` → secrets, RQ, Zustand domain stores).

### Files changed

| File | Why |
| --- | --- |
| `mobile/services/auth/sessionManager.ts` | Sync detach UI; bump epoch; re-entrant `signOut`; teardown after |
| `mobile/lib/authLogoutTransition.ts` | Flag + `isAuthenticatedAppShellEligible` |
| `mobile/hooks/useAuthLogoutTransition.ts` | `useSyncExternalStore` for layouts |
| `mobile/app/(app)/_layout.tsx` | No dashboard Stack after logout; dark canvas + Redirect |
| `mobile/app/(auth)/_layout.tsx` | Do not bounce to dashboard during teardown; no fade on swap |
| `mobile/components/navigation/ThemedRootNavigation.tsx` | `animation: "none"` + auth-dark canvas during logout/unauth |
| `mobile/hooks/useSignOutAction.ts` | No imperative `replace` |
| `mobile/components/providers/SessionExpiryBridge.tsx` | Ignore 401 expiry while logout already running |
| `mobile/components/providers/IdleSessionBridge.tsx` | `signOut()` only — no second replace / nested begin |
| `mobile/app/(app)/admin/index.tsx` | No `router.replace` after sign-out |
| `mobile/features/settings/sections/EmployeePrivacyDataSettingsScreen.tsx` | Same |
| `mobile/features/auth/LoginScreen.tsx` | Do not `navigateAfterAuth` during logout |
| `mobile/services/api/client.ts` | Skip refresh / expiry notify / refresh-cookie persist during logout |
| `mobile/scripts/logout-transition-runtime.ts` | Order + eligibility regression |
| `mobile/package.json` | `test:logout-transition` in `test:mobile-runtime` |

### Tests performed

| Check | Result |
| --- | --- |
| `npm run typecheck` (mobile) | **Pass** (2026-08-11) |
| `npm run test:logout-transition` | **Pass** |
| `npm run lint` (mobile) | Run with `test:mobile-runtime` below |
| `npm run test:mobile-runtime` | Includes logout-transition; see bottom Verification |
| Manual Sign Out / expiry / in-flight RQ / tabs / re-login / restart | No Android device/emulator attached (`adb devices` empty) |

### Real-device result

`adb devices` listed no emulator or phone. **Logout visual transition PASS is not claimed.** Code-level sequence: tap → shell ineligible same tick → one Redirect → login tree, with no dashboard/skeleton/orange/white fade and no second `replace`. Re-run Sign Out on a device to confirm.

---

## Executive Summary

Cold-start login flash for restored sessions is **already well gated** (native splash + `BrandSplashOverlay` + bootstrap/routing readiness + destination paint). The audit found real user-visible instability mainly in:

1. **Logout / session expiry** — React Query + user stores cleared while the dashboard was still mounted as authenticated  
2. **Period toggles / timeframe hydrate** — full-screen skeletons on every timeframe change and a default→stored period remount  
3. **Theme defaulting to dark** until AsyncStorage hydrate (light-mode flash after splash)  
4. **Root stack staying brand-orange** after boot (orange flashes between app screens)

These were fixed with minimal rendering/state-order changes. Intentional animations (FadeIn entrance, splash reveal, billing sync overlay) were left alone.

| Metric | Count |
| --- | ---: |
| Issues discovered | 14 |
| Fixed | 8 |
| Intentionally left unchanged | 6 |

**Overall assessment:** Startup and auth restoration are stable. Dashboards and logout transitions should now feel polished without content↔skeleton thrashing or empty-dashboard flashes on sign-out.

---

## Findings

| Screen/Flow | Issue | Severity | Cause | Fix |
| --- | --- | --- | --- | --- |
| Logout / session expiry | Dashboard / hole / orange fade before login | **Critical** | Network logout before unauth; root fade 220ms; double `replace` | Sync detach + animation none + single Redirect (see follow-up) |
| Business / employee / analytics period toggle | Content → full skeleton → content | **High** | New query key without previous data; `isLoading` gated full UI | `placeholderData: keepPreviousData`; skeleton only when no data |
| Dashboard cold open | Double stats fetch / second skeleton | **High** | `usePersistedTimeframe` started at default then AsyncStorage updated period | Gate stats queries on timeframe `ready` |
| Theme after splash | Dark → light flash for light preference users | **High** | Default `mode: "dark"`; splash didn’t wait for theme hydrate | Default `system`; include `theme.hydrated` in `useBootstrapReady` |
| Auth ↔ app navigation | Brand-orange flash between screens after boot | **High** | Root `Stack` always `authBrand.orange` | Orange only until bootstrap ready; then theme background |
| Auth/app layouts while routing | Blank `null` under overlay if early reveal | **Medium** | Layouts returned `null` when `!routingReady` | Orange boot stub `View` |
| QR Studio refresh | Possible full loading swap on refetch | **Medium** | `isLoading` OR of queries | Skeleton only when no data yet |
| Offline banner | Content jumps when banner inserts | **Low–Medium** | Conditional height insert | Left unchanged (overlay/reserve would be a small UX redesign) |
| Cold start logged-in | Login before dashboard | — | Already mitigated by splash gates | No change |
| FadeIn on first content paint | Sections fade from 0 once | **Low** | Intentional entrance | Left unchanged |
| Lazy insight screens | Skeleton on first open | **Low** | Code-split Suspense | Left unchanged (acceptable) |
| Role tab Redirect | Wrong tree then redirect | **Medium** | Role guard in tab layouts | Left unchanged — rare; post-auth href already primary |
| Dual post-login navigate | Possible double replace | **Low** | Layout Redirect + imperative navigate | Left unchanged — not visibly flaky in practice |
| Splash fallback reveal | Mid-route paint if destination slow | **Medium** | 1600ms fallback | Left unchanged — safety net; destination path preferred |

---

## Authentication Stability

| Concern | Status |
| --- | --- |
| Auth restoration flicker (login before dashboard) | **Stable** — splash + `useSessionRoutingReady` + index redirects; auth not set authenticated until refresh succeeds |
| Protected screens flash while determining auth | **Stable** — `(app)` waits routing ready; returns orange stub then Redirect |
| Login → dashboard | **Stable** — intentional fade; stack bg switches to theme after bootstrap |
| Logout / session expiry | **Fixed (2026-08-11)** — sync UI detach, no group fade, single Redirect; see follow-up |
| Google / social auth | **Stable** — uses existing OAuth error paths; no remount-key storms found |
| Session expiry redirect | **Stable** — same teardown order via `SessionExpiryBridge` → `sessionManager.signOut` |

---

## Loading Stability

| Concern | Status |
| --- | --- |
| Initial dashboard load | Skeleton until first profile/stats (expected) |
| Period toggle | **Fixed** — keep previous metrics; soft refresh via `isRefreshing` / pull-to-refresh |
| Timeframe preference hydrate | **Fixed** — queries wait until storage read completes |
| Empty state flash before data | Reduced on period change; tips list already used `isLoading && items.length === 0` |
| Pull-to-refresh | Already uses refresh control, not full-screen loader |
| Offline QR | Already tenant-safe (`live \|\| (!loading ? cached)`) |

---

## Navigation Stability

| Concern | Status |
| --- | --- |
| Screen transitions | Fade 220ms while authenticated; **none** during logout / unauth group swap |
| Tab switches | Stable keys; no remount storm |
| Modal / idle warning | `animationType="none"` where used — reduces flicker |
| Back navigation | No confirmed remount flicker |
| Auth ↔ app | Improved by stack background switch + logout order |

---

## Performance / Rendering

| Concern | Confirmed? | Action |
| --- | --- | --- |
| Unnecessary remount on period change | Yes (query key + skeleton swap) | keepPreviousData + ready gate |
| Effect loop | No confirmed user-visible loop | — |
| Unstable keys | Not found on tabs/providers | — |
| State reset on logout while mounted | Yes | Auth flip first |
| Repeated API from timeframe default→stored | Yes | `timeframeReady` |

---

## Changes Made

| File | Why |
| --- | --- |
| `mobile/services/auth/sessionManager.ts` | Logout: unauthenticate before clearing caches |
| `mobile/lib/authLogoutTransition.ts` | Document teardown intent |
| `mobile/hooks/usePersistedTimeframe.ts` | Expose `ready` after AsyncStorage read |
| `mobile/features/business/useBusinessDashboard.ts` | keepPreviousData + ready gate + initial-only skeleton |
| `mobile/features/business/useBusinessAnalytics.ts` | Same for analytics/QR period queries |
| `mobile/features/employee/useEmployeeDashboard.ts` | Same for tips period |
| `mobile/features/employee/EmployeeDashboardScreen.tsx` | Align tips loading gate with hook |
| `mobile/hooks/useQrStudio.ts` | Avoid refetch full-screen loading |
| `mobile/store/themeStore.ts` | Default theme `system` |
| `mobile/hooks/useAppReady.ts` | Wait for theme hydrate before splash reveal |
| `mobile/components/navigation/ThemedRootNavigation.tsx` | Theme stack bg after bootstrap |
| `mobile/app/(auth)/_layout.tsx` | Orange stub instead of `null` |
| `mobile/app/(app)/_layout.tsx` | Orange stub instead of `null` |
| `docs/MOBILE_VISUAL_STABILITY_AUDIT.md` | This report |

---

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` (mobile) | **Pass** (re-run 2026-08-11) |
| `npm run lint` | Pre-existing ESLint ignore config (not introduced by this work) |
| `npm run test:mobile-runtime` | **Pass** (2026-08-11; includes `test:logout-transition`) |
| `npx expo export --platform web` | **Pass** (prior audit) |
| Device/emulator visual pass (logout) | **Not run** — `adb devices` empty; do not claim logout PASS until observed |

Commands from `mobile/`:

```bash
npm run typecheck
npm run lint
npm run test:mobile-runtime
npx expo export --platform web --output-dir .tmp-export-check
```
