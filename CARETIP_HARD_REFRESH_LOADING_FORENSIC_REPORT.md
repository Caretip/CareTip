# CareTip — Hard Refresh Infinite Loading / Loader Overlay Forensic Audit

**Date:** 2026-10-03  
**Scope:** Authenticated dashboard cold refresh (forensic only — **no remediation implemented**)  
**Severity classification:** **P0** (application can remain permanently unusable after refresh when certain latch + request conditions align)

---

## 1. Exact reproduction steps (observed / inferred)

**Reporter symptom**

1. Hard refresh on an authenticated business URL (e.g. `/dashboard/billing/subscription`).
2. Brief flash.
3. Full-screen CareTip branded loader with DE copy: **„Ihr Arbeitsbereich wird vorbereitet…“**.
4. Loader remains; dev console repeats `[LoaderDiag] Snapshot — periodic (overlay visible)` with the same `pathname`.

**Recommended local reproduction matrix** (production-equivalent: `npm run build` + `vite preview`, backend reachable, logged-in business manager):

| Action | Route examples |
|--------|----------------|
| Ctrl/Cmd+R | `/dashboard`, `/dashboard/billing/subscription`, `/dashboard/settings`, `/dashboard/team/performance` |
| Address bar enter | Same URLs while session cookie + `localStorage` user exist |
| New tab | Open deep link while logged in |
| After idle | Refresh after 15–60 min (access token expired, refresh cookie still valid) |
| Slow network | Throttle refresh + billing API |

**Determinism:** Code paths suggest **intermittent** behavior tied to refresh outcome (transient bootstrap), billing/API latency, and whether the global overlay was latched by page boot helpers. Not fully reproduced in this pass without a live authenticated session in CI.

---

## 2. Affected routes

Any **protected business dashboard** deep link on **cold document load** (hard refresh or new tab), especially routes using **`useBusinessPageBoot`**:

- `/dashboard/billing/subscription` (confirmed reporter path)
- Other billing/settings pages using the same boot pattern
- Less likely on SPA in-app navigation after `markAppShellInteractive()` (soft-nav suppressions)

Employee/platform-admin cold paths share the same **global overlay manager** and **auth bootstrap** but different guards and page boot keys.

---

## 3. Deterministic vs intermittent

| Factor | Effect |
|--------|--------|
| Session refresh succeeds quickly | Overlay often clears after auth + optional billing fetch |
| Refresh `transient_error` / pending validation | `app-auth-bootstrap` can hold **up to ~12s** (degraded settle + stuck warn) |
| `useExtendGlobalLoaderUntilReady` latch + slow/hung `/api/me/billing` | Overlay can remain **until request completes** (no page-level timeout found) |
| `onboarding_status_unconfirmed` guard wait | Blocks **route children** (no billing mount); overlay usually **auth/bootstrap**, not billing boot |
| Marketing shell / `SoftSpaRouteHold` | **Not on dashboard cold path** for overlay copy winner |

---

## 4. Full startup lifecycle (hard refresh on `/dashboard/billing/subscription`)

```
document load (#caretip-html-boot may show first)
  → React bootstrap (main.tsx / i18n)
  → AppLoadingManagerProvider
       • initial registration: app-boot (if !isPublicShellPath)
       • overlayPhase often "visible" on protected URLs
  → AuthBootstrapLoadingRegistrar
       • app-auth-bootstrap while authStatus === "initializing" OR isAuthRestorePending()
  → useAuthInitializer → ensureAuthSessionBootstrap → POST refresh (12s race timeout)
  → RouteNavigationLoadingRegistrar
       • route-navigation: OFF for dashboard URLs (shouldRegisterBrandedRouteNavigation → false)
  → ProtectedRoute + ApprovedBusinessGate
  → businessLayoutLazy chunk
  → BusinessLayout (data-caretip-dashboard-ready on shell)
       • useDashboardLayoutPaintReady (technical *-paint latch)
  → billing child chunk
  → BusinessBillingSubscriptionPage → BusinessSettingsBillingPanel
       • useBusinessPageBoot("billing-subscription", loading && !data)
       • useExtendGlobalLoaderUntilReady("business-billing-subscription-boot", …)
       • fetchBillingStatus → GET /api/me/billing
  → When all winning overlay registrations release → overlay exit debounce → markAppShellInteractive()
```

**SPA click navigation (A)** skips cold `app-boot` story and **suppresses** `useExtendGlobalLoaderUntilReady` when `isAppShellInteractive()` is true.

---

## 5. Loader ownership — who shows / hides

| Layer | Shows | Hides when |
|-------|--------|------------|
| `#caretip-html-boot` | First paint | `dismissHtmlMarketingBootBridge` / overlay exit; protected handoff waits for `[data-caretip-dashboard-ready]` |
| `AppBrandedLoadingScreen` | `AppLoadingManager` when `renderReactOverlay` && winner requested | All **eligible** global registrations cleared + exit debounce + fade |
| `AuthBootstrapShell` | Public cold chunk holds only — **not** the dashboard overlay winner in normal design |
| `AppRouteGateShell` | `GlobalAppLoadingHold` under overlay — **no second spinner** |

**Overlay winner selection:** `pickOverlayWinner()` in `appLoadingJourney.ts` — highest journey tier + priority; **technical** `*-paint` / `*-chunk` keys excluded from winning.

**German string mapping:** `common.loading.dashboard` → „Ihr Arbeitsbereich wird vorbereitet…“ via `resolveRouteLoadingMessage()` for any `/dashboard/*` path (`appLoadingContexts.ts`). Initial `app-boot` copy for dashboard URLs uses **`startup`** until registrars update the message to **dashboard** via `app-auth-bootstrap`.

---

## 6. LoaderDiag — what snapshots mean

**Implementation:** `LoaderDiagRuntime.tsx` (DEV only), `loaderDiagFlags.ts`, traces from `AppLoadingManager.register()`.

| Field | Meaning |
|-------|---------|
| `activeRegistrations` | Keys with `reg:<key> → ACTIVE` in diag map (global overlay registrars only) |
| `flags` | `authLoading`, `sessionLoading`, `routeLoading`, `onboardingLoading`, etc. |
| Periodic log | Fires every 5s while `useAppLoadingOverlayActive()` is true |

**Does not change production behavior** — read-only logging (plus 8s/10s deadlock warnings in dev).

**When stuck, capture:** `activeRegistrations[0]` (overlay winner), `flags`, and `[GlobalAppLoading] state` debug object (`winner`, `activeKeys`).

---

## 7. Exact state preventing loader release (ranked hypotheses)

### H1 — **P0: `business-{page}-boot` latched global extension** (billing route)

`useExtendGlobalLoaderUntilReady` (`useExtendGlobalLoaderUntilReady.ts`):

- On cold refresh, if overlay is visible and `useBillingStatus()` is still `loading`, **`latchedRef` stays true**.
- Registers `business-billing-subscription-boot` at `ROUTE_GUARD` priority — **eligible overlay winner** (not a technical key).
- Holds until `fetchBillingStatus()` settles (`finally { setLoading(false) }`).
- **If `/api/me/billing` never completes** (hung TCP, proxy, backend stall), overlay can stay **indefinitely**.
- **Not gated on `isProtectedApiReady()`** — request may run before refresh completes (401/retry behavior depends on `apiRequest`).

### H2 — **P1: `app-auth-bootstrap` extended past user expectation**

`AuthBootstrapLoadingRegistrar` blocks while:

- `authStatus === "initializing"` (`!authHydrated || !sessionValidated`), or
- `isAuthRestorePending()`, or
- `hasPendingStoredSessionWithoutUser(user)`.

`useAuthInitializer` on `transient_error`:

- Applies cached user via `setAuthUser(stored)` **without** immediate `markSessionBootstrapSettled()`.
- Recovery: retries + `TRANSIENT_DEGRADED_SETTLE_MS` (12s) → `markSessionBootstrapDegraded()`.
- Separate `GLOBAL_LOADER_STUCK_WARN_MS` (12s) also calls `markSessionBootstrapDegraded()`.

Usually **bounded ~12s**, not truly infinite — unless bootstrap promise never settles (see H4).

### H3 — **P1: Route guard `onboarding_status_unconfirmed`**

`resolveAuthenticatedAppGuard`: business user with `!hasCompletedOnboarding` and `!onboardingStatusFromServer` → `{ kind: "wait" }`.

- `ProtectedRoute` returns `AppRouteGateShell` — **children (billing page) never mount**.
- `shouldRegisterBrandedRouteGuard`: **false** when `user && !authBlocking` on dashboard path — overlay should **not** be attributed to guard registration, but **auth bootstrap** may still cover the screen with dashboard copy.

If `markOnboardingStatusFromServer()` never runs (stuck bootstrap), guard can wait a long time with **empty shell under overlay**.

### H4 — **P2: Bootstrap single-flight hang**

`runSessionBootstrapOnce` — if `run()` promise **never resolves/rejects** (theoretical browser/network bug), `sessionValidated` stays false until degraded timers — edge case.

### H5 — **P3: `app-boot` orphan**

`BOOTSTRAP_OVERLAY_MAX_MS` (15s) clears overlay **only if** `app-boot` is the **sole** registration. With `app-auth-bootstrap` or `business-*-boot` active, this safety net **does not** force full dismiss.

---

## 8. Pending promises / requests (billing path)

| Request | Required for shell? | Blocks global overlay? |
|---------|---------------------|-------------------------|
| `POST /api/auth/refresh` (bootstrap) | Yes (session) | Via `app-auth-bootstrap` |
| `GET /api/me/billing` | No (page data) | **Yes, if latched** via `business-billing-subscription-boot` |
| Entitlements (`useSubscriptionEntitlements`) | No | Only if separate registration active (shell provider; not global winner by default) |

**Architectural mismatch:** optional page data can extend the **global** branded overlay on cold entry.

---

## 9. Auth / session behavior

- JWT in memory + HttpOnly refresh cookie; hard refresh restores user JSON from `localStorage` early, then refresh.
- `sessionValidated` flips true on: authenticated, unauthenticated, or `markSessionBootstrapDegraded()`.
- `onboardingStatusFromServer` set on successful `persistAuthResponse` / bootstrap success — required to exit onboarding guard wait.
- Logout/post-login transitions intentionally clear many registrations (`registerAuthSoftNavColdBootDismiss`).

---

## 10. i18n behavior

- Loader copy comes from i18n (`de.json` `common.loading.dashboard`).
- **Not blocked on language init** for overlay text — `i18n` loads in `main.tsx` before app render.
- `LanguageChangeLoadingRegistrar` can suppress overlay exit while language change active — unrelated to hard refresh unless user switches language during load.

---

## 11. Suspense / lazy-route behavior

- `/dashboard` → `businessLayoutLazy` + billing child lazy modules.
- Dashboard uses `RouteChunkBoundary variant="shell"` → `BusinessSubPageShellSkeleton` in main column, **not** global branded overlay.
- Chunk failure surfaces `ErrorBoundary` — would not typically leave infinite **loader** unless overlay registration stuck separately.

---

## 12. API / data-loading behavior

- `useBillingStatus` always mounts `reload()` on effect — no `enabled: authReady` guard.
- Errors set `loading: false` — should release latch unless overlay winner is a **different** key still active.

---

## 13. Server / direct-URL behavior

- SPA entry: `dist/index.html` + client routing (no SSR).
- Deep link `/dashboard/billing/subscription` should return same `index.html` as `/` (verify hosting rewrites in deployment; local `vite preview` serves SPA correctly).
- Stale chunk / SW issues can cause chunk errors — usually error UI, not infinite loader; still worth checking service worker on production.

---

## 14. Did recent performance work contribute?

| Change | Dashboard hard refresh impact |
|--------|-------------------------------|
| Marketing `MarketingShellLayout` | **None** on `/dashboard/*` |
| `SoftSpaRouteHold` / marketing navigation | **None** on cold dashboard (suppressed after interactive; dashboard not marketing shell) |
| `shouldRegisterBrandedRouteGuard` dashboard exception | **Reduces** guard-driven overlay on dashboard when user hydrated |
| `useExtendGlobalLoaderUntilReady` + `useBusinessPageBoot` | **Directly involved** in extending cold overlay for billing — pre-existing pattern, exacerbated on billing deep links |

**Conclusion:** Not caused by marketing navigation rollback candidate; investigate **global loader extension + auth bootstrap + billing fetch**.

---

## 15. Root cause (forensic conclusion)

**ROOT CAUSE:** The global `AppLoadingManager` overlay can remain the active UI because **`useExtendGlobalLoaderUntilReady` latches `business-billing-subscription-boot` (and siblings) to the fullscreen loader on cold refresh until initial page data (`useBillingStatus` / `GET /api/me/billing`) completes**, while **auth bootstrap** (`app-auth-bootstrap`) may simultaneously or sequentially hold the overlay with **dashboard** i18n copy. **There is no hard cap that clears `business-*-boot` if the billing request hangs.** Secondary: **auth transient bootstrap** can extend the same overlay for up to ~12s. Tertiary: **onboarding guard wait** can prevent billing page mount while auth overlay still shows.

---

## 16. Secondary contributing causes

- `BOOTSTRAP_OVERLAY_MAX_MS` only clears lone `app-boot` — ineffective when other keys active.
- Billing fetch not gated on `isProtectedApiReady()`.
- Guard wait without server onboarding confirmation blocks outlet mount.
- Dev `LoaderDiag` periodic logs correctly indicate `overlayVisible` — not the bug itself.

---

## 17. Minimal safe remediation (not implemented)

1. **Never let `business-*-boot` win the global overlay past auth + layout paint** — use local skeleton only; or cap extension with bounded wait then release (product decision).
2. **Gate `useBillingStatus` initial fetch on `isProtectedApiReady()`** and ensure `loading` becomes false on auth failure/timeout.
3. **Add request timeout** to billing status (or global `apiRequest` for `/api/me/*`) so `finally` always runs.
4. **Onboarding guard:** after bootstrap degraded or timeout, set `onboardingStatusFromServer` or redirect — avoid infinite `wait` with global overlay.
5. **Strengthen overlay safety net:** if `[data-caretip-dashboard-ready]` and `sessionValidated`, force demote/remove non-CRITICAL `business-*-boot` registrations.

---

## 18. Regression tests required (for remediation PR)

- Hard refresh on `/dashboard/billing/subscription` with mocked hung billing API → overlay must clear within bounded time; page shows error/skeleton.
- Hard refresh with transient refresh failure → overlay clears ≤12s; shell visible.
- Hard refresh with completed onboarding in storage + successful refresh → no infinite guard wait.
- SPA navigation billing → no global branded overlay (existing architecture tests).
- `test:app-performance-architecture` + loader diag snapshot asserting no winner `business-*-boot` after shell ready.

---

## Summary block

**ROOT CAUSE:** Cold-refresh **global overlay latch** via `useExtendGlobalLoaderUntilReady` + **`useBusinessPageBoot`** tied to **`useBillingStatus`**, combined with **`app-auth-bootstrap`** on session restore — **no guaranteed release if billing API hangs**.

**AFFECTED:** Business dashboard deep links on hard refresh (billing/subscription primary); potentially any page using `useBusinessPageBoot`.

**SAFE FIX:** Decouple **optional page data** from **global overlay winner**; bound auth bootstrap; gate billing fetch on API readiness + timeout.

**REGRESSION RISK:** Soft SPA dashboard navigation must stay free of branded overlay; post-login handoff paint latches; checkout/Stripe critical loaders.

**STATUS:** **READY FOR REMEDIATION**

**Classification:** **P0** when billing (or similar) HTTP hang occurs with latch armed; **P1** for long but bounded auth transient windows.
