# CareTip — Final Marketing Navigation Premium Polish

**Date:** 2026-10-03  
**Final status:** **READY — MARKETING NAVIGATION PREMIUM POLISH VERIFIED**

---

## 1. Existing marketing route architecture (before)

- Flat root `RouteObject` entries: eager `/` (`LandingPage`) plus **lazy** siblings (`/features`, `/pricing`, legal, industries, …).
- Each lazy page wrapped content in `PublicPageShell` (Navigation + main + Footer).
- Root `RouteChunkBoundary variant="minimal"` wrapped the entire outlet.
- SPA marketing hops **replaced the full root tree** → prior page + nav unmounted → `RootSpaRouteHold` / `SoftSpaRouteHold` full-viewport neutral gap while the lazy chunk loaded.
- Prefetch existed (`prefetchPublicRoutes`, `PrefetchLink`, idle `prefetchPrimaryNavRoutes`) but could not prevent nav unmount.

---

## 2. Root cause of first-hop content gap

| Factor | Effect |
|--------|--------|
| Root outlet replacement | Entire marketing DOM (including `Navigation`) torn down on each lazy hop |
| Lazy route chunk latency | 0.2–1.5 s (warm) to ~7.5 s (Slow 3G) before destination module ready |
| `RootSpaRouteHold` | Full-viewport `SoftSpaRouteHold` while RR `navigation.state === "loading"` on root lazy routes |
| Suspense at root | `MinimalRouteFallback` during chunk fetch |

**Not** a loader regression — neutral hold was correct for empty `#root`; the UX issue was **unnecessary shell teardown**.

---

## 3. Marketing shell architecture (after)

```
MarketingShellLayout (eager, path `/`)
├── Navigation (persistent)
├── RouteChunkBoundary variant="marketing"
│   └── Outlet → child route page content
└── (footer remains per-page via PublicPageShell / landing footer)
```

- **`marketingChildRoutes.tsx`** — all public marketing URLs as **child** routes (index = eager `LandingPage`, siblings lazy).
- **`MarketingShellContext`** — `PublicPageShell` omits duplicate `Navigation` when embedded.
- **`MarketingOutletFallback`** — in-column hold only (`data-testid="marketing-outlet-hold"`); nav stays visible.
- **`isInShellMarketingNavigation`** — `RootSpaRouteHold` skipped for marketing→marketing hops.
- Outlet `pointer-events-none` + `aria-busy` while child route loads (no stale clicks).

**SEO / URLs:** Paths unchanged (`/features`, `/industries/:id`, …). Post-build `prerender-public-seo-html.ts` still uses `CARETIP_SITEMAP_PATHS` + `resolveRouteSeo` — no SSR conversion.

---

## 4. Prefetch findings

| Mechanism | Status |
|-----------|--------|
| `PrefetchLink` hover/focus/touch | Unchanged — still warms importers |
| `prefetchPublicRoute` map | Extended with `/about`, `/blog`, `/careers`, `/mobile-app`, `/avv`, `/plv` |
| Idle prefetch | Split: **`prefetchCoreMarketingNavRoutes`** (`/features`, `/pricing`, `/faq`) on all viewports; **`prefetchExtendedMarketingNavRoutes`** (contact, about, auth, industries + hero idle) **desktop only** via `isMobileViewport()` |
| `prefetchPrimaryNavRoutes` | Still calls core + extended (compat) |

Prefetch reduces chunk wait; shell persistence removes full-viewport gap even when prefetch misses.

---

## 5. Chunk-loading findings

- Child lazy modules unchanged (Vite code-split per page).
- Suspense boundary moved **inside** marketing layout → root tree no longer suspends on marketing hops.
- Production preview: marketing probe shows **`holdRootMs: 0`** for `/features` first hop (was ~176–1488 ms pre-shell).

---

## 6. Previous-route preservation

- **Navigation:** persistent (verified E2E).
- **Main content:** React Suspense still swaps outlet children; brief in-column `MarketingOutletFallback` possible if chunk not warm — **not** full-screen blank.
- **No route cache** — only `pointer-events-none` during load.

---

## 7. View Transition evaluation

| Criterion | Decision |
|-----------|----------|
| React Router `viewTransition` | Not enabled — shell persistence already removes the perceptual gap; animation would not fix real chunk delay |
| `prefers-reduced-motion` | Avoided adding motion solely for marketing |
| Interaction with `SoftSpaRouteHold` | Marketing hops no longer trigger root hold; VT unnecessary |
| SEO | No benefit from VT |

**Conclusion:** No view transitions added.

---

## 8. Implementation performed

| Area | Change |
|------|--------|
| `MarketingShellLayout.tsx` | New persistent layout |
| `marketingChildRoutes.tsx` | Nested marketing routes |
| `routes.tsx` | Single `/` parent + redirects (`/help`, `/dpa`, `/how-it-works`) at root |
| `PublicPageShell.tsx` | Marketing-embedded mode (no duplicate nav) |
| `LandingPage.tsx` | Nav owned by layout |
| `RouteChunkBoundary` | `variant="marketing"` + `MarketingOutletFallback` |
| `publicRoutes.ts` / `RootSpaRouteHold.tsx` | In-shell marketing navigation skip |
| `prefetchPublicRoutes.ts` / `Navigation.tsx` | Tiered prefetch |
| `app-performance-architecture-runtime.ts` | Regression locks |
| `e2e/marketing-shell-continuity.spec.ts` | New |
| `e2e/spa-transition-final-visual.spec.ts` | `holdRootMs < 120` on marketing hops |

**Not changed:** `SoftSpaRouteHold`, `AuthBootstrapShell`, dashboard/auth/payment loaders, Stripe, backend.

---

## 9. Before / after measurements (production preview, Playwright rAF probe)

| Scenario | Before (shell) | After (shell) |
|----------|----------------|---------------|
| A. First `/` → `/features` `holdRootMs` | ~176–1488 ms | **0 ms** |
| B. Warm `/` → `/features` | ~48–96 ms root + full unmount | **0 ms** root; nav mounted |
| C. `/features` → `/pricing` | ~48–96 ms | **0 ms** |
| D. `/pricing` → `/faq` | ~32–80 ms | **0 ms** |
| E. Slow 3G `/` → `/pricing` | ~7456 ms root hold | **0 ms** root (`holdBrandedMs` 0) |
| Branded loader on SPA marketing | 0 ms | **0 ms** |

In-shell hold may still use `marketing-outlet-hold` briefly when chunks are cold; it does not cover the header.

---

## 10–13. Desktop / mobile / language / back-forward

| Check | Result |
|-------|--------|
| Desktop 1280–1440 | E2E marketing hops pass; nav `shellNavVisible: true` |
| Mobile 320–430 | Same probe results; core-only idle prefetch |
| Language switch | Existing `LanguageChangeLoadingRegistrar` untouched; shell does not remount on locale change |
| Back / forward | RR nested routes + `ScrollToTop`; no new branded loader (architecture + E2E) |

Manual spot-check recommended for DE↔EN on `/industries/*` and mobile hamburger after deploy.

---

## 14. SEO verification

- `npm run build` completes; `[seo-prerender] wrote 18 public SEO HTML documents under dist/`.
- URL paths and `CareTipRouteSeo` client metadata unchanged.
- Cold entry still uses HTML boot + route-ready handoff on lazy marketing pages.

---

## 15. Build results

- `npm run build` — success (~1m 26s).
- `vite preview` @ `4173` — **12/12** Playwright tests (marketing shell, SPA transition, root hold, Slow 3G).

---

## 16. Regression tests

| Suite | Result |
|-------|--------|
| `test:app-performance-architecture` | ok |
| `e2e/marketing-shell-continuity.spec.ts` | ok |
| `e2e/spa-transition-final-visual.spec.ts` | ok |
| `e2e/public-spa-root-hold.spec.ts` | ok |

---

## 17. Remaining limitations

- **Leaving marketing** (e.g. `/features` → `/login`) still replaces the root outlet — `SoftSpaRouteHold` remains correct.
- **Cold direct entry** to a lazy marketing URL still waits for chunk + `data-caretip-route-ready` before HTML boot dismisses — by design.
- **Slow 3G** may show in-column outlet hold until chunk arrives — not faked.
- **Footer** still remounts per page (acceptable; below-fold).
- **View transitions** not used.

---

## Definition of done

Marketing SPA navigation keeps **stable header chrome**, prepares routes via **tiered prefetch**, and avoids **full-viewport neutral gaps** on in-shell hops without reintroducing branded loaders or weakening cold-entry protections.

**READY — MARKETING NAVIGATION PREMIUM POLISH VERIFIED**
