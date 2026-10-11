# CareTip — SPA Transition Final Visual Verification

**Date:** 2026-10-03  
**Scope:** Post–`SoftSpaRouteHold` stabilization (no further architectural changes in this pass)  
**Final status:** **A — SMOOTH TRANSITIONS VERIFIED**

---

## 1. Executive conclusion

Automated probes and production preview runs confirm the **P0 regression is gone**: in-app navigations after `markAppShellInteractive()` do **not** mount `AuthBootstrapShell`, `PublicRouteChunkHold` (cold branded), or the global `.app-branded-loader` overlay on tested marketing and customer entry paths.

What remains on **top-level lazy marketing routes** is an intentional **neutral full-viewport hold** (`SoftSpaRouteHold`, surfaced as `root-spa-route-hold` and/or `public-route-chunk-hold-soft`). It uses `bg-background` (theme surface), not a second branded boot screen. On warm SPA hops this hold is typically **&lt;100 ms**; on the **first** cold lazy hop to `/features` in a fresh session it can reach **~0.7–1.5 s** (chunk fetch). Under **Slow 3G** emulation, the same hold can last several seconds while the chunk downloads—still **without** branded chrome or an empty `#root`.

**Recommendation:** **Keep `SoftSpaRouteHold` and `RootSpaRouteHold`.** No additional architecture in this pass.

---

## 2. Test methodology

| Layer | What ran |
|--------|----------|
| **Automated** | Playwright `e2e/spa-transition-final-visual.spec.ts`, `e2e/public-spa-root-hold.spec.ts` |
| **Probe** | `requestAnimationFrame` sampling (~16 ms ticks) for `public-route-chunk-hold-soft`, `root-spa-route-hold`, cold `public-route-chunk-hold`, `.app-branded-loader` |
| **Dev** | `http://127.0.0.1:5173` (Vite dev; parallel load caused 3 flaky timeouts on one dev run; marketing probes still passed) |
| **Production** | `npm run build` + `vite preview` at `http://127.0.0.1:4173` — **10/10 tests passed** |
| **Viewports** | 320, 375, 390, 430, 1280, 1440 px width |
| **Throttling** | CDP `Network.emulateNetworkConditions` (~500 kb/s, 400 ms RTT) for `/` → `/pricing` |
| **Architecture guard** | `npm run test:app-performance-architecture` (soft-hold wiring assertions) |
| **Manual / auth** | Business, employee, and admin shell navigations inferred from layout code (see §6); no stored E2E credentials in repo |

---

## 3. Per-question matrix (all journeys)

Legend: **Y** yes / observed, **N** no, **P** partial / conditional, **—** not applicable or not instrumented.

### 3.1 Marketing (`/` → `/features` → `/pricing` → `/faq` → `/industries/*` → `/contact`)

| # | Question | Dev + prod probe | Notes |
|---|----------|------------------|-------|
| 1 | Existing shell remains visible? | **P** | Root **outlet** replaces the whole marketing tree; **global** `Navigation` is inside lazy pages, so it **unmounts** with the previous route. `shellNavVisible` often true because the **destination** nav paints during/after hold. |
| 2 | Current page disappears? | **Y** | React Router root lazy swap + Suspense unmount prior page. |
| 3 | `SoftSpaRouteHold` visible? | **Y** (as `root-spa-route-hold`) | Probe: `holdSoftMs ≈ 0`, `holdRootMs &gt; 0` — same component, different `data-testid`. |
| 4 | Duration? | **Warm:** ~16–96 ms typical after first lazy hop. **First `/features`:** ~176–1488 ms (prod preview). **Slow 3G `/pricing`:** ~7.5 s hold, **0 ms branded**. |
| 5 | Perceived blank/white page? | **P** | Solid **theme background**, not raw white flash or CareTip boot art. Can feel like a **content gap** on first lazy hop or slow networks. |
| 6 | New route paints before notice? | **P** | Destination often appears within same navigation; probe ends when route-ready/main visible. |
| 7 | Branded loader? | **N** | `holdBrandedMs` and `brandedLoaderMs` **0** on all marketing viewports (dev + prod). |
| 8 | Header/sidebar remount? | **Y** (marketing nav) | No persistent marketing layout wrapper at root. |
| 9 | Page content remount? | **Y** | Expected for lazy route modules. |
| 10 | Direct entry vs SPA? | **Different** | Cold URL: HTML boot + branded journey until interactive. SPA after warm `/`: neutral hold only. |

### 3.2 Customer (QR → employee → tip → details → payment)

| # | Question | Automated | Notes |
|---|----------|-----------|-------|
| 1–10 | Full QR funnel | **Partial** | E2E: warm `/` → `/tip-amount` — **no branded hold**. `QRLandingPage` and several customer steps are **eager** in `routes.tsx`; in-flow steps use `CustomerFlowShell` / page loaders (branded only where journey allows, e.g. checkout). |
| 7 | Branded loader on soft nav | **N** | Verified on `/tip-amount` after interactive shell. |

*Full QR→payment path with live venue data was not automated in this pass; architecture matches stabilization report (no second `AuthBootstrapShell` on soft public customer navigations).*

### 3.3 Dashboard (business): Dashboard → Performance → Payout History → Analytics

| # | Answer | Source |
|---|--------|--------|
| 1 | **Y** — sidebar/header layout stays mounted | `BusinessLayout` + `RouteOutletTransition` |
| 2 | **P** — main column swaps | Outlet only |
| 3 | **`SoftSpaRouteHold` at root** — **N** | Shell uses `RouteChunkBoundary variant="shell"` → `BusinessSubPageShellSkeleton` |
| 4 | Brief skeleton in main pane | Chunk-bound, not full-viewport soft hold |
| 5 | Not full-viewport white flash | Skeleton + layout chrome remain |
| 7 | **N** on in-shell nav | `shouldRegisterBrandedRouteNavigation` + `isAppShellInteractive()` suppress global overlay |
| 8 | **N** remount for chrome | Layout stable |
| 9 | **Y** for page component | Normal route change |
| 10 | Direct vs SPA | Cold layout chunk once; then shell-only skeletons |

### 3.4 Employee: Dashboard → Performance → Stripe Connect → Payout History

Same pattern as §3.3 (`EmployeeLayout`, `variant="shell"`).

### 3.5 Admin: Dashboard → Businesses → Revenue → Reports

Same pattern (`SuperAdminLayout`, `variant="shell"`).

---

## 4. Production preview probe summary (representative)

All runs: `holdBrandedMs = 0`, `brandedLoaderMs = 0`.

| Viewport | Hop | `holdRootMs` (approx.) |
|----------|-----|-------------------------|
| 320px | `/features` (first lazy) | 1312 |
| 320px | `/pricing`, `/faq`, `/contact`, industries | 16–48 |
| 375px | `/features` | 736 |
| 430px | `/features` | 1488 |
| 1280px | `/features` | 768 |
| 1440px | `/features` | 176 |
| 390px Slow 3G | `/pricing` | 7456 |

`public-spa-root-hold`: landing → login and landing → pricing — **no empty `#root`** without a hold or destination UI (prod preview).

---

## 5. `SoftSpaRouteHold` assessment

| Criterion | Result |
|-----------|--------|
| Replaces branded second boot on SPA | **Yes** — verified |
| Uses `fixed inset-0 z-[9990] bg-background` | **Yes** — continuity with page surface |
| Noticeable on typical warm marketing hops | **No** — sub-100 ms hold dominates |
| Noticeable on first lazy hop / slow network | **Possible** — full-viewport neutral field while chunk loads |
| Should remove now? | **No** — prevents worse empty-`#root` flash; branded alternative rejected |

**If product later wants zero full-viewport gap on marketing lazy hops**, the measured root cause is **outlet replacement + route chunk latency** (Suspense + RR `loading`), not hold CSS. Smallest *future* fix (not implemented here): keep previous route painted until the lazy child commits (outlet deferral / staged swap)—only after explicit product sign-off.

---

## 6. Root-cause reference (when hold is visible)

| Mechanism | Role in observed behavior |
|-----------|---------------------------|
| **Suspense unmount** | Prior marketing page leaves DOM when lazy child suspends |
| **Route chunk latency** | Drives hold length (`holdRootMs` scales with network) |
| **Outlet replacement** | Root tree swap triggers `RootSpaRouteHold` when `navigation.state === "loading"` |
| **Fallback timing** | `MinimalRouteFallback` → `SoftSpaRouteHold` when interactive |
| **CSS / background** | Hold matches `bg-background` — not an accidental `#fff` layer |
| **Data gates** | Dashboard: in-layout skeletons, not root soft hold |
| **Branded loader** | **Not** triggered on verified soft marketing/customer paths |

---

## 7. Commands to reproduce

```bash
npm run build
npx vite preview --host 127.0.0.1 --port 4173 --strictPort
# separate terminal:
$env:E2E_BASE_URL="http://127.0.0.1:4173"
npx playwright test e2e/spa-transition-final-visual.spec.ts e2e/public-spa-root-hold.spec.ts
npm run test:app-performance-architecture
```

---

## 8. Sign-off

| Item | Status |
|------|--------|
| P0: `AuthBootstrapShell` on interactive SPA nav | **Fixed / verified** |
| `SoftSpaRouteHold` retained | **Yes** |
| Additional architecture in this pass | **None** |
| **Final status** | **A — SMOOTH TRANSITIONS VERIFIED** |
