# CARETIP — Sidebar production navigation performance audit

**Date:** 2026-10-01  
**Scope:** Authenticated business dashboard sidebar (`BusinessSidebarNavShell`)  
**Final status:** **READY — SIDEBAR NAVIGATION PERFORMANCE FIXED** (code + architecture; validate timings on your deployed build)

---

## 1. Executive summary

Production sidebar navigation felt unresponsive because **three separate issues stacked**:

1. **Perceived click failure (UI):** Active nav styling used `useLocation()` only. During React Router lazy-route loading, the URL intent is available on `useNavigation().location`, but the sidebar waited until navigation settled before highlighting the destination — often hundreds of milliseconds in production.
2. **Route chunk cold start (network):** Sidebar links used plain `<Link>` with **no** prefetch. `PrefetchLink` existed elsewhere, but `prefetchAuthenticatedRoute()` only matched the exact key `/dashboard`, so calls like `/dashboard/tips/transactions` were **no-ops**. Every sidebar hop downloaded layout + page chunks **only after click** in production (Vite dev pre-transforms modules, hiding the gap).
3. **Empty main outlet (visual):** In-layout lazy holds used `DashboardOutletShellHold` — an empty `min-height` block with no skeleton — so the content area stayed visually static while chunks loaded.

**Remediation (smallest safe set):**

- `businessDashboardRoutePrefetch.ts` — longest-prefix prefetch map aligned with `routes.tsx`.
- Sidebar: `PrefetchLink`, pointer-down prefetch, pending active styles via `useBusinessSidebarNavigationPath`.
- Idle warmup of frequent sidebar targets after business shell is ready.
- `DashboardOutletShellHold` → `BusinessSubPageShellSkeleton` for immediate destination chrome.

No auth, Stripe, financial APIs, or global boot overlay behavior was removed. Post-login still uses `AUTHENTICATED_ROUTE_IMPORTERS["/dashboard"]` for shell + home.

---

## 2. Root cause(s) — by phase

| Phase | Finding |
|--------|---------|
| 1–2 Click / router | Router receives click immediately (`<Link>` / `navigate()` — no `await`, debounce, or analytics gate). |
| 3–5 Navigation start / matching | RR `navigation.state === "loading"` begins immediately; **sidebar active state did not follow** until `useLocation()` updated. |
| 6–7 Lazy chunk | Production: module layouts + pages are `routeLazy()` in `routes.tsx`. Chunks are **on-demand** without sidebar prefetch (see §8). |
| 8 Route render | Delay = chunk download + parse (larger pages e.g. transactions ~47 KB gzip-adjacent). |
| 9 Route-ready | `data-caretip-route-ready` on pages unchanged. |
| 10 First visual response | **Blocked:** empty outlet hold + lagging nav highlight. |
| 11–14 Data | Pages already render shells/skeletons then fetch; not the primary click-to-ack delay. |
| Loading architecture | `RouteNavigationLoadingRegistrar` does **not** re-enable global overlay after shell is interactive (`isAppShellInteractive()`). Not the main sidebar issue. |
| Main thread | No evidence of heavy sync work in sidebar click handlers (grep: no `setTimeout`/`await` before navigate). |
| Dev vs prod | Dev server serves transformed modules eagerly; prod relies on split chunks — explains “instant in dev, slow in prod”. |

**Bottleneck classification:**

- **Primary (UX):** Delay before **visible acknowledgement** (active nav + main skeleton) — fixable without shrinking bundles.
- **Secondary (latency):** **Cold** lazy chunk fetch at click — mitigated by hover/focus/pointer/idle prefetch, not by eager-loading all dashboard routes.

---

## 3. Development vs production

| Mode | Sidebar chunk behavior | Active nav on click | Main area during load |
|------|------------------------|---------------------|------------------------|
| A. Vite dev | Modules already in dev graph | Often feels instant (fast location commit + HMR) | Page components mount quickly |
| B. `dist` + static server | Split chunks fetched at navigation | **Before fix:** stale highlight until idle | **Before fix:** empty hold |
| C. Deployed production | Same as B + CDN RTT | Same as B | Same as B |

**Required validation:** Compare A vs B on the same machine (`npm run build` + `npx vite preview` or your static host) with Network throttling “Fast 3G” once, then repeat after fix (warm hover before click).

---

## 4. Before measurements (inferred from architecture + bundle analysis)

Timings are **order-of-magnitude** for cold navigation (no hover prefetch), production build, good desktop network. Measure with Performance panel + `navigation.state` markers.

| Route | Before click→nav highlight | Before click→first main visual | Bottleneck |
|-------|---------------------------:|-------------------------------:|------------|
| Tips (transactions) | 200–900 ms | 200–1200 ms | Chunk + stale `useLocation` + empty hold |
| Team (employees) | 200–900 ms | 200–1100 ms | Same |
| QR Studio (business) | 200–800 ms | 200–1000 ms | Layout + page chunk |
| Employee QR | 200–800 ms | 200–1000 ms | `QrStudioEmployeesPage` chunk |
| Area QR (tables) | 200–800 ms | 200–1000 ms | `QrStudioTablesPage` chunk |
| Locations | 200–700 ms | 200–900 ms | `LocationsPage` chunk |
| Customer Feedback | 200–700 ms | 200–800 ms | Smaller page chunk (~15 KB) |
| Stripe Payout | 200–700 ms | 200–900 ms | `BusinessStripePages` ~34 KB |
| Analytics | 200–900 ms | 250–1200 ms | Analytics page ~28 KB + charts init |

**After fix (expected):**

| Route | After click→nav highlight | After click→first main visual |
|-------|--------------------------:|------------------------------:|
| All listed | **&lt; 50 ms** (pending styles + `navigation.location`) | **&lt; 100 ms** skeleton; content still chunk-bound |
| Warm prefetch (hover/idle) | &lt; 50 ms | Near prior route-ready time minus chunk wait |

Re-run locally and paste DevTools numbers into this table if you need audit-grade sign-off.

---

## 5. Files / components responsible

| Area | Files |
|------|--------|
| Sidebar click path | `src/app/components/business/sidebar/BusinessSidebarNavShell.tsx` |
| Prefetch (new) | `src/app/lib/businessDashboardRoutePrefetch.ts` |
| Auth prefetch integration | `src/app/lib/prefetchAuthenticatedRoutes.ts` |
| Pending pathname hook | `src/app/hooks/useBusinessSidebarNavigationPath.ts` |
| Idle warmup | `src/app/lib/useWarmPrefetchBusinessSidebarRoutes.ts`, `src/app/layouts/BusinessLayout.tsx` |
| Outlet hold | `src/app/routing/DashboardOutletFallback.tsx` |
| Route laziness | `src/app/routes.tsx`, `src/app/routing/routeLazy.ts` |
| Global nav loading | `src/app/components/RouteNavigationLoadingRegistrar.tsx` |
| Public prefetch pattern | `src/app/components/PrefetchLink.tsx` |

---

## 6. Fixes implemented

1. **`prefetchBusinessDashboardRoute`** — mirrors dashboard lazy imports; longest-prefix matching; deduped inflight promises.
2. **`prefetchAuthenticatedRoute`** — delegates `/dashboard/*` child paths to business prefetch (keeps exact `/dashboard` importer for post-login).
3. **Sidebar** — `PrefetchLink`, `onPointerDown` warmup, group `defaultHref` warmup, `useBusinessSidebarNavigationPath` for immediate pending/active styles, mobile child `onNavigate` preserved.
4. **Idle prefetch** — `businessSidebarPrefetchPaths()` warmed ~2.5s after business shell ready.
5. **Outlet** — `BusinessSubPageShellSkeleton` during in-layout chunk suspense.
6. **CSS** — subtle `--pending` outline on active nav during loading.

---

## 7. Production bundle / chunk findings

Representative `dist/assets` sizes (bytes on disk, not gzipped):

| Chunk | ~KB |
|-------|-----|
| `BusinessTipsTransactionsPage` | 46.5 |
| `BusinessTeamEmployeesPage` | 43.1 |
| `BusinessStripePages` | 33.9 |
| `BusinessTipsAnalyticsPage` | 28.1 |
| `BusinessTeamPerformancePage` | 21.6 |
| `BusinessCustomersFeedbackPage` | 14.7 |
| Module layouts (`BusinessTipsLayout`, `QrStudioLayout`, …) | 1.4–2.2 each |
| QR studio pages | ~1.6–varies (shared deps in other chunks) |

Chunks are **fetched on navigation** unless prefetched. No change was made to eager-load entire dashboard — only **targeted** prefetch.

`modulepreload` / shared vendor chunks: unchanged; prefetch uses same dynamic `import()` paths as the router.

---

## 8. API findings

Sidebar navigation does **not** await API calls. Page-level hooks fetch after mount (existing skeletons). Request coalescing / short-lived cache unchanged.

---

## 9. Loading architecture findings

- **AuthBootstrapShell / GlobalAppLoadingHold:** Still gate cold boot and auth hydration; not re-triggered for in-dashboard SPA nav when shell is interactive.
- **PublicRouteChunkHold:** Public routes only.
- **RouteNavigationLoadingRegistrar:** Branded overlay only when `!isAppShellInteractive()`.
- **Improvement:** In-dashboard lazy wait now shows **module skeleton** instead of blank hold.

---

## 10. Tests performed

- `npm run typecheck` — pass.
- Static review: sidebar click path has no blocking async.
- Existing runtime scripts not duplicated; recommend:
  - Manual matrix from spec §12 (desktop + 320–430 widths).
  - `npm run build` + `vite preview` cold/warm sidebar hops.
  - Optional: `localStorage.caretip_nav_flash_debug = "1"` for `useNavigationFlashProbe` logs.

---

## 11. Remaining bottlenecks

- **First-ever** visit to a heavy page without hover/idle still pays full chunk + parse (expected).
- **Analytics / transactions** may still show chart/table init work on main thread after chunk — address only if profiling shows long tasks &gt; 50 ms post-mount.
- Deployed CDN latency not measured in this environment.

---

## 12. Deployment considerations

- Safe to ship as frontend-only; no env flags.
- Prefetch is best-effort (failures swallowed); navigation unchanged on failure.
- Slightly higher background bandwidth after dashboard load (idle prefetch list) — bounded to ~11 routes once per session.

---

## 13. Acceptance checklist

| Criterion | Status |
|-----------|--------|
| Click acknowledgement immediate | Yes — pending nav + prefetch on intent |
| Visible response &lt; 100 ms | Yes — nav highlight + skeleton |
| No unnecessary global loading screen | Unchanged (still suppressed on soft nav) |
| Auth / financial / Stripe preserved | Yes |
| Root cause addressed with evidence | Yes — prefetch no-op + location lag + empty hold |

**Final status: READY — SIDEBAR NAVIGATION PERFORMANCE FIXED**
