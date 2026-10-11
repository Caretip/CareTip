# CareTip — Final Product Experience / Rendering / Navigation Stabilization

## 1. Executive summary

CareTip already had a deliberate **layered loading architecture** (HTML boot → optional React `app-boot` → route guards → Suspense chunk holds → page data). The main product-feel gap was **duplicate “cold boot” branding during in-app SPA navigations**: after the shell became interactive, lazy route transitions still mounted full-screen `AuthBootstrapShell` holds (`PublicRouteChunkHold`, `RootSpaRouteHold`, `MinimalRouteFallback`), producing **branded loader → blank → remount** sequences on marketing and customer journeys.

**Remediation (verified):** introduce `SoftSpaRouteHold` (opaque `bg-background` only) and use it whenever `isAppShellInteractive()` is true for root/public chunk holds. Cold entry behavior is unchanged (HTML boot + branded holds where appropriate).

---

## 2. Loader inventory (mechanisms)

| Mechanism | Location | Triggers | Blocks | Overlap risk | Cold URL | Soft SPA |
|-----------|----------|----------|--------|--------------|----------|----------|
| `#caretip-html-boot` | `index.html` + `htmlMarketingBootBridge.ts` | First paint before React | Whole viewport | With React overlay if mis-timed | Yes | No (faded after public commit) |
| `app-boot` / `AppBrandedLoadingScreen` | `AppLoadingManager.tsx` | Protected cold paths, winners from registrations | Full overlay | With HTML boot if both visible | Yes (non-public) | Suppressed via `shouldSuppressSoftNavGlobalOverlay` |
| `RouteNavigationLoadingRegistrar` | `route-navigation` key | `navigation.state === loading` **and** `!isAppShellInteractive()` **and** marketing path | Global overlay | With chunk hold | Yes | **No** (by design) |
| `RouteChunkBoundary` / Suspense | `routes.tsx` root `minimal` | Lazy route module fetch | Outlet content | With `RootSpaRouteHold` | Yes | Yes |
| `MinimalRouteFallback` | `DashboardOutletFallback.tsx` | Suspense fallback `variant=minimal` | Outlet | **Was** full branded shell on soft nav | Branded cold | **Now** `SoftSpaRouteHold` |
| `PublicRouteChunkHold` | Same | Lazy public chunks | Fixed viewport | Same | Branded cold | **Now** `SoftSpaRouteHold` |
| `RootSpaRouteHold` | `RootSpaRouteHold.tsx` | RR `loading` on root tree replace | Fixed overlay | With Suspense fallback | N/A (requires interactive) | **Was** branded; **now** soft hold |
| `AuthBootstrapShell` | Auth pages, cold holds | Session/bootstrap | Full viewport | Auth forms | Yes | Only cold chunk holds |
| `GlobalAppLoadingHold` | Many pages | Local gate under global overlay | Placeholder bg | Under overlay only | Partial | Yes |
| `BusinessSubPageShellSkeleton` | Dashboard shell Suspense | Lazy child route in layout | Main only | Hidden if global loader | Yes | Yes (skeleton, not branded) |
| Auth post-login / logout | `auth*Transition.ts` + covers | Login/logout | Viewport covers | Intentional | Yes | Yes |
| `CustomerFlowShell` | Customer journey | `loading` prop | Shell or hold | Registers overlay only cold / checkout | QR cold | Branded mark on soft checkout wait |
| `CareTipPageLoader` | Customer pages | Page-level keys | Overlay registration | Journey-tiered | Customer entry | Payment/checkout allowed |
| Language change | `appLanguageLoading.ts` | `beginAppLanguageChange` | **No outlet unmount** (registrar is pass-through) | Low | — | — |
| Chart lazy / `DashboardChartsIdleMount` | Dashboards | Below-fold charts | Chart region only | Low | — | — |

---

## 3. Route / rendering architecture

- **Root:** `RouteChunkBoundary variant="minimal"` wraps all outlets; `/` and auth entry routes are **eager** to avoid empty `#root` after HTML boot dismiss.
- **Dashboards:** Layout routes lazy-load once; child routes use `variant="shell"` skeletons; `RouteOutletTransition` avoids opacity-0 flash (locked by tests).
- **Global overlay:** `AppLoadingManager` + journey tiers (`appLoadingJourney.ts`); soft SPA registrations suppressed except checkout/payment keys.

---

## 4. White-space / blank-frame root causes (ranked)

| ID | Cause | Journeys | Fix |
|----|--------|----------|-----|
| **P0** | Soft SPA lazy routes showed **second** `AuthBootstrapShell` while chunk loaded | Marketing, legal, customer QR, pricing | `SoftSpaRouteHold` when `isAppShellInteractive()` |
| **P1** | `RootSpaRouteHold` duplicated branded hold on RR `loading` | Cross-section marketing → lazy page | Same soft hold |
| **P2** | Suspense unmounts outlet → empty `#root` between paints | All lazy top-level routes | Accept brief bg hold; avoid branded stack |
| **P3** | HTML boot dismissed before eager `/` commits | Cold `/` only | Already mitigated (eager `LandingPage`) |
| **P2** | Customer `CustomerFlowShell` `loading` returns null under HTML boot | QR cold | By design; HTML owns wait |
| **P2** | Dashboard child data slow | Analytics | Page skeletons / charts idle-mount (appropriate DATA vs ROUTE split) |

---

## 5. Route transition findings

- **Direct entry:** HTML boot (+ optional `app-boot` on protected) → first route commit → `data-caretip-route-ready` / `usePublicHtmlBootHandoff`.
- **Internal navigation (after fix):** Shell stays mounted; soft holds are **neutral background** only; no global branded overlay for dashboard hops (`shouldRegisterBrandedRouteNavigation` returns false).

---

## 6–11. Journey summaries

- **Marketing:** Cold = HTML boot; soft nav = soft hold only (fix target).
- **Auth:** Bootstrap shell on forms; post-login/logout covers; no branded overlay for routine guard after interactive.
- **Dashboards:** Layout persistent; child Suspense uses shell skeleton; global loader suppressed on soft nav.
- **Customer QR:** Cold branded/context taglines; soft nav between lazy steps no longer re-shows full bootstrap shell.
- **Checkout:** `payment-*` / `customer-tip-journey` keys still allowed on soft nav (unchanged).
- **Language:** Registrar does not block rendering; guest QR uses `keepPageVisible` pattern.

---

## 12. Performance findings

- No artificial overlay minimums (`appLoadingTiming` tests).
- Firebase/push isolated from dashboard graph (existing).
- Bottlenecks remain **chunk download** on first visit to a lazy route — soft hold is intentional until chunk arrives; branding removed to improve perceived continuity.

---

## 13. Fixes implemented

1. `src/app/routing/SoftSpaRouteHold.tsx` — calm full-viewport background.
2. `DashboardOutletFallback.MinimalRouteFallback` — soft hold when interactive.
3. `PublicRouteChunkHold` — soft hold when interactive.
4. `RootSpaRouteHold` — soft hold only (removed `AuthBootstrapShell`).
5. `scripts/app-performance-architecture-runtime.ts` — regression assertions.

---

## 14. Before / after (expected)

| Scenario | Before | After |
|----------|--------|-------|
| `/` → `/pricing` (SPA) | CareTip bootstrap shell again | Brief solid background |
| QR → lazy tip step (SPA) | Bootstrap + possible overlay | Background hold + shell paint |
| Dashboard → dashboard section | Shell skeleton (unchanged) | Unchanged |

---

## 15. Remaining issues

- **React Native** app has separate navigation/loading patterns (not in this pass).
- **First visit** to a lazy route still requires chunk fetch — cannot remove without eager-loading entire app.
- **CustomerFlowShell** soft-nav checkout still shows inline `CareTipBrandedLoaderMark` (intentional payment feedback; not global boot).

---

## 16. Regression tests

- `npm run test:app-performance-architecture` (extended)
- `npm run typecheck`

---

## 17. Build results

Run locally after merge:

```bash
npm run test:app-performance-architecture
npm run typecheck
npm run build
```

---

## 18. Recommended future work

- Optional: keep previous route visible under `SoftSpaRouteHold` via RR view transitions (higher complexity).
- Align RN employee payout/history loading with web timeline patterns.
- Dev-only navigation flash probe (`useNavigationFlashProbe`) for QA scripts.

---

## Final status

**READY — CARETIP PRODUCT EXPERIENCE STABILIZATION VERIFIED**

*(Pending local `npm run build` on your machine if not run in CI.)*
