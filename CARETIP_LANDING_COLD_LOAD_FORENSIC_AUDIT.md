# CareTip landing cold-load forensic audit

**Scope:** Direct URL entry to `https://caretip.de/` (and local equivalent).  
**Phase:** Read-only — no application code changes.  
**Date:** 2026-03-28.

---

## 1. Executive summary

Cold landing load is dominated by a **single intentional full-screen surface**: static HTML `#caretip-html-boot` (branded icon + orbiting arc + one tagline). React is **blocked until `ensureI18nReady()` finishes** loading a full locale JSON bundle, then mounts with **`createRoot` (not `hydrateRoot`)**. The boot overlay is held until `.caretip-landing` / `[data-caretip-route-ready]` exists, then fades (~180ms).

What users often interpret as a **“second loader”** on `/` is usually one or more of:

1. **Tagline text swap** on the **same** HTML boot node (e.g. inline German → `boot-locale.js` → optional React-driven `setHtmlBootBridgeTagline`).
2. **Boot fade revealing an empty hero slot**, then the hero **portaling in** one frame later (layout/pop-in, not a second full-screen loader).
3. **Hero copy motion** (`LandingHeroAnimatedWord`, lazy `AnimatedHeading`, CSS scroll-reveal) mistaken for remount.
4. On **lazy public routes** (not `/`), a **second branded shell** (`AuthBootstrapShell` / `PublicRouteChunkHold`) can mount in `#root` under the HTML boot — same visual language as the boot screen.

**React StrictMode is not enabled** in `main.tsx` (no double-mount from StrictMode in dev/prod entry).

**SEO prerender does not hydrate React content** — static `#caretip-static-summary` is removed before first paint of the app tree.

**Verdict (see §17):** **B, C, E, F (clarified), and D** — multiple contributing factors with evidence; not a single bug label.

---

## 2. Exact observed loading sequence (logical order)

| Step | What happens | Evidence |
|------|----------------|----------|
| 1 | Browser requests HTML | `index.html` |
| 2 | **HTML boot visible immediately** (`#caretip-html-boot { display: flex }`, `html.caretip-html-boot-active`) | `index.html` inline CSS |
| 3 | `theme-init.js` runs (theme class on `<html>`) | `index.html` |
| 4 | **`boot-locale.js` runs**: sets `lang`, tagline (`gettingReady` → EN: **"Just a moment…"**, DE: **"Einen Moment bitte…"**), `installPublicLandingBootRetain()` patches `remove` / `removeChild` / `classList.remove` so boot cannot disappear before landing commits | `public/boot-locale.js` |
| 5 | Parser continues; **`#caretip-static-summary`** present (SEO body, non-interactive under boot) | `index.html` |
| 6 | **`#root` empty** | `index.html` |
| 7 | CSS: `caretip-font-faces.css`, font preload | `index.html` |
| 8 | Hero image preloads (AVIF, media queries) | `index.html` |
| 9 | **Module graph**: `/src/main.tsx` — CSS imports, `prefetchPublicEntryGraph()` → `import("./app/pages/LandingPage")` in parallel | `src/main.tsx` |
| 10 | **`ensureI18nReady()`** — dynamic `import` of **entire** `de.json` or `en.json`; **no React until resolved** | `src/main.tsx`, `src/i18n/i18n.ts` |
| 11 | **`removeStaticCrawlerSummary()`** — removes `#caretip-static-summary` from DOM | `src/main.tsx`, `documentSeo.ts` |
| 12 | **`createRoot(#root).render(<App />)`** | `src/main.tsx` |
| 13 | Provider tree: `AppLoadingManager`, `AuthProvider` (session bootstrap **async**, anonymous skips refresh), `RouterProvider` | `App.tsx`, `useAuthInitializer.ts` |
| 14 | **Public `/`**: no initial `app-boot` overlay registration (`shouldRegisterInitialAppBoot` false for `isPublicShellPath`) | `AppLoadingManager.tsx`, `publicRoutes.ts` |
| 15 | **`htmlBootOwnsVisual === true`** — React **does not** mount `AppBrandedLoadingScreen` while HTML boot node exists | `AppLoadingManager.tsx` L187–190, L742–748 |
| 16 | `RootLayout` → `LandingHeroPersistenceLayer` + eager **`LandingPage`** (not RR `lazy` on `/`) | `routes.tsx` L208–212 |
| 17 | **`LandingPage` mounts** with `class="caretip-landing"` + `data-caretip-route-ready` — satisfies `publicLandingRouteCommitted()` / `shouldRetainHtmlBootUntilLandingCommit` | `LandingPage.tsx` |
| 18 | **`useLandingShellReady`** (on hero layer) **`completeHtmlBootAfterPublicPaint()`** in `useLayoutEffect`: `beginHtmlBootBridgeExit` → fade class → remove boot node | `useLandingShellReady.ts`, `htmlMarketingBootBridge.ts` |
| 19 | **`markAppShellInteractive()`** — soft navigations stop re-registering global loader | `appShellLifecycle.ts` |
| 20 | Hero: **`useLayoutEffect` sets portal target** `#landing-hero-slot`; **`CareTipLandingHero` portals in** | `LandingHeroPersistenceLayer.tsx` |
| 21 | Below-fold sections load via **`LandingLazySection`** (intersection / prefetch), not blocking first paint | `LandingPageBelowFold.tsx` |

E2E contract: landing must exist **before** boot is gone (≤50ms ordering tolerance). See `e2e/landing-html-boot-handoff.spec.ts`.

---

## 3. Initial HTML analysis

| Question | Answer |
|----------|--------|
| What HTML is sent before JS? | Full `index.html` with inline boot CSS, boot markup, static SEO `<main>`, empty `#root`, script tags. |
| Branded loader in HTML? | **Yes** — `#caretip-html-boot` with SVG icon + CSS orbit animation + `#caretip-html-boot-tagline`. |
| "Just a moment…" in initial HTML? | **Not literally** in source HTML — default tagline is **"Einen Moment bitte…"**; EN users get **"Just a moment…"** when `boot-locale.js` runs (~step 4). |
| Landing hero in initial HTML? | **No** — only generic SEO copy in `#caretip-static-summary`, not the React hero. |
| `#root` empty initially? | **Yes**. |
| Static SEO summary? | **Yes** — `#caretip-static-summary` (hidden visually behind boot via `pointer-events: none` on boot-active). |
| Boot overlay? | **Yes** — primary cold-load UI. |
| More than one loading UI in HTML? | **One** full-screen loader; SEO main is not a loader. |
| First loader static vs React? | **First paint is static HTML boot**; React overlay is **suppressed** on `/` while boot node exists. |

Post-`npm run build`, `scripts/prerender-public-seo-html.ts` rewrites `<main id="caretip-static-summary">` per route; **boot block unchanged**.

---

## 4. Complete loader inventory

| ID | Component / surface | File(s) | Trigger | Mount | Unmount |
|----|---------------------|---------|---------|-------|---------|
| **A** | HTML boot | `index.html`, `public/boot-locale.js` | Always on cold load | Parser + CSS | `dismissHtmlMarketingBootBridge()` after public commit + fade |
| **B** | `AppBrandedLoadingScreen` | `AppBrandedLoadingScreen.tsx`, `AppLoadingManager.tsx` | Overlay registrations + `overlayPhase === visible` | When `shouldMountReactBootOverlay` && no `.caretip-landing` yet | Overlay exit + fade; **blocked on `/` while A present** |
| **C** | `AuthBootstrapShell` | `AuthBootstrapShell.tsx` | `PublicRouteChunkHold`, `RootSpaRouteHold`, auth pages | Lazy public chunk / RR `navigation.state === loading` **after** shell interactive | Route idle / navigation complete |
| **D** | `PublicRouteChunkHold` | `PublicRouteChunkHold.tsx` | `MinimalRouteFallback` when Suspense suspends | Lazy public routes (not eager `/`) | Child route resolved |
| **E** | `MinimalRouteFallback` | `DashboardOutletFallback.tsx` | `RouteChunkBoundary` Suspense | Lazy route suspend | Resume |
| **F** | `GlobalAppLoadingHold` | `GlobalAppLoadingHold.tsx` | Dashboard / customer shells under overlay | Protected flows | Paint ready / registration off |
| **G** | `app-boot` registration | `AppLoadingManager.tsx` | `shouldRegisterInitialAppBoot` | Protected / non-public-shell cold entry | `releaseAppBootOverlay` / winner change |
| **H** | `app-auth-bootstrap` | `AuthBootstrapLoadingRegistrar.tsx` | `authStatus === initializing` on **non**-public-shell paths | Protected cold / stored session | Bootstrap settled |
| **I** | `route-navigation` | `RouteNavigationLoadingRegistrar.tsx` | `!isAppShellInteractive() && navigation.state === loading` on marketing paths | Cold RR navigation (rare on eager `/`) | `navigation.state === idle` |
| **J** | `*-chunk` (technical) | `RouteChunkBoundary`, `useRegisterGlobalAppInit` | `!isAppShellInteractive() && branded chunk` | Excluded from overlay **winner** (`isTechnicalOverlayRegistration`) | Chunk loaded |
| **K** | Sign-in / logout covers | `SignInHandoffCover`, `AuthLogoutHandoffCover` | Auth transitions | Intentional auth UX | Transition end |
| **L** | PWA / language | — | `LanguageChangeLoadingRegistrar` is **no-op** | — | — |

**For `/` cold load, active user-facing loaders:** primarily **A**; **B** should not stack on A; **H** does not block overlay on public shell (`shouldBlockGlobalAuthLoader` → false for `isPublicShellPath`).

**Competing systems:** **A + AppLoadingManager handoff logic** (tagline sync, MutationObserver, retain patches) + **deferred hero portal** (perceived as “app appeared twice”).

---

## 5. App loading manager (public landing)

- **Initial `app-boot`:** **Not registered** for `/` (`isPublicShellPath` includes `/`).
- **`htmlBootOwnsVisual`:** true while `#caretip-html-boot` in DOM; prevents **B** from mounting.
- **Handoff:** `completeHtmlBootAfterPublicPaint()` + MutationObserver on `data-caretip-route-ready`, `.caretip-landing`, dashboard attrs.
- **Tagline updates:** `useEffect` sets `setHtmlBootBridgeTagline(displayOverlayMessage)` while `htmlBootOwnsVisual` — can change copy **without** new DOM node.
- **Timing knobs:** `OVERLAY_SHOW_THRESHOLD_MS = 200`, `OVERLAY_FADE_MS = 180`, `DEFAULT_MIN_OVERLAY_VISIBLE_MS = 0` (`appLoadingTiming.ts`).
- **Auth bootstrap:** Runs in `AuthProvider` but **anonymous** path returns quickly (`anonymous_skip_refresh`) — **does not gate** public landing overlay.
- **Stripe / logout / post-login holds:** Not on anonymous `/` cold load.

---

## 6. Route / lazy-chunk loading (`/`)

| Question | Finding |
|----------|---------|
| Is `/` lazy? | **No** — `Component: LandingPage` eager; comment documents white-screen fix if lazy. |
| `React.lazy` on `/`? | **No** for page component. |
| When is landing code available? | Pulled via `routes.tsx` → large shared entry graph; `main.tsx` also `prefetchPublicEntryGraph()` → `LandingPage`. |
| Suspense on outlet? | `RouteChunkBoundary variant="minimal"` wraps `<Outlet />` — **does not suspend** for eager `LandingPage`. |
| `root-route-chunk` registration | May register technically during cold boot but **filtered from overlay winner** (`-chunk` suffix). |
| Vite | `modulePreload: false`; manual vendor chunks (`vendor-i18n`, `vendor-react`, etc.). |

**Lazy loading** applies to **below-fold** `LandingLazySection` chunks and **other routes**, not the `/` page component itself.

---

## 7. “Loader remount” — evidence

**Most likely sequence on `/` (production-shaped):**

```
STATIC HTML BOOT (A)
  → tagline may update in place (boot-locale / optional React tagline sync)
  → boot fade-out (caretip-html-boot--exiting, 180ms)
  → LANDING SHELL visible (#root; nav + empty hero slot)
  → HERO PORTAL mounts (CareTipLandingHero)
```

**Not** the typical pattern:

```
STATIC BOOT → unmount → REACT AppBrandedLoadingScreen (B) → unmount → page
```

**B** is explicitly prevented while A exists (`shouldMountReactBootOverlay` + `publicDestinationReady`).

**Exception path (other URLs):** STATIC BOOT **+** `PublicRouteChunkHold` (**C**, same visual family as boot) in `#root` until lazy page commits — can feel like “loader remount” on **pricing/features/etc.**, less so on `/`.

**Proof assets:** `e2e/landing-html-boot-handoff.spec.ts` (no empty `#root` while boot visible; landing before boot gone).

**Dev-only:** `LoaderDiagRuntime` lazy in `RootLayout` — diagnostic, not a second customer loader.

---

## 8. “Just a moment…” — sources

| Source | Type | When on `/` |
|--------|------|-------------|
| `public/boot-locale.js` `COPY.en.gettingReady` | Pre-React DOM text | EN locale after script runs |
| `src/i18n/locales/en.json` `common.gettingReady`, `loading.landing`, etc. | i18n strings | After React; may feed `displayOverlayMessage` / registrars |
| `AuthBootstrapShell` / `PublicRouteChunkHold` | React | Lazy public routes; `t("common.gettingReady")` |
| `RootSpaRouteHold` | React | After shell interactive + RR loading (soft nav cold) |
| `AppBrandedLoadingScreen` | React | Protected / overlay winner paths; suppressed on `/` with HTML boot |
| Suspense fallback | `MinimalRouteFallback` | Not for eager `/` |

**Multiple instances:** Same **sentence**, different **layers** (HTML tagline vs React shell on other routes). On `/`, usually **one DOM loader** with possible **in-place tagline change**.

---

## 9. Hero text “remount” — evidence

| Hypothesis | Assessment |
|------------|------------|
| A. True unmount/remount | **Partial** — `LandingHeroPersistenceLayer` keeps one hero instance per session, but **portal target** is `null` on first render, then set in `useLayoutEffect` → hero **attaches after** landing shell (feels like pop-in). |
| B. Double render, same instance | **Yes** — normal React render + portal attach. |
| C. Animation only | **Yes** — `LandingHeroAnimatedWord` (4.2s rotate, enter/exit CSS); `AnimatedHeading.lazy` Suspense fallback → full heading; scroll-reveal classes on sections. |
| D. Language swap | **Unlikely on first paint** if `boot-locale` + `ensureI18nReady` agree on `readDocumentOrStoredLanguage()`. |
| E. Route change | **No** on cold `/`. |
| F. SEO handoff | **No** — static summary removed pre-render; not hero HTML. |
| G. StrictMode | **No** — not used in entry. |
| H. `useMediaQuery` false-start | **Mitigated** — `useSyncExternalStore` reads `matchMedia` on first client render (`use-media-query.ts`). |

**Parent chain (hero):** `RootLayout` → `LandingHeroPersistenceLayer` → portal → `#landing-hero-slot` inside `LandingPage` → `CareTipLandingHero`.

**Boot dismissal vs hero:** `shouldRetainHtmlBootUntilLandingCommit` clears when **`.caretip-landing` exists**, which is **before** hero portals into slot — user can see **nav/layout without hero** during boot fade.

---

## 10. React StrictMode

- **Not enabled** in `src/main.tsx` (`createRoot` → `<App />` only).
- Comments elsewhere mention StrictMode for deduplication; **not** a factor for observed double-mount on landing entry.

---

## 11. i18n cold path

```
HTML lang + tagline (boot-locale.js)
    ↓
main.tsx ensureI18nReady() [BLOCKS React]
    ↓ load one locale JSON (dynamic import)
    ↓ i18n.init({ lng, fallbackLng: lng, load: "currentOnly" })
    ↓ document.documentElement.lang = lng
removeStaticCrawlerSummary()
    ↓
createRoot().render()
```

- **Second language bundle** not loaded until user switches (`changeAppLanguage`).
- **Visible flash** if stored language is EN but user briefly sees DE HTML tagline before `boot-locale.js` runs (narrow window).

---

## 12. SEO prerender / “hydration”

| Topic | Finding |
|-------|---------|
| React hydration? | **No** — `createRoot`, not `hydrateRoot`. |
| Prerendered body | `#caretip-static-summary` for crawlers; **removed** before React render. |
| Mismatch warnings | N/A for React hydration; no SSR tree. |
| Double hero from SEO | **No** — summary is generic H1/paragraphs, not hero component. |
| Boot during “hydration” | Boot retained until React landing markers — by design. |

Build: `vite build` + `prerender-public-seo-html.ts` injects per-route SEO into `dist/**/index.html`.

---

## 13. Network waterfall (critical vs non-critical)

**Critical for first meaningful paint (landing behind boot):**

- `index.html`
- Inline boot CSS (in HTML)
- `/boot-locale.js`, `/theme-init.js`
- `/src/main.tsx` (+ Vite dev transform) or production `assets/index-*.js` entry
- **Locale JSON chunk** (via dynamic import inside `ensureI18nReady`)
- **Large app graph**: `App`, `routes.tsx`, `LandingPage`, marketing CSS bundles (`marketing-shell.css`, `landing.css`)
- `/caretip-font-faces.css`, Inter preload
- Hero AVIF preloads (LCP)

**Non-critical / deferred (should not block boot dismiss logic, may affect perceived richness):**

- `wakeRemoteApi()` — deferred `scheduleMobileDeferredWork` (900ms desktop / 3500ms mobile)
- PWA `registerSW` — prod, deferred
- Below-fold `LandingLazySection` chunks
- `LandingOnboardingAssistantHost` (feature flag, dynamic import)
- Manrope `heroDisplay` font — `scheduleHeroDisplayFont()` dynamic import
- Socket / dashboard vendors — not needed for `/` first paint

**`modulePreload: false`** — fewer automatic preloads; relies on explicit hero preloads + prefetch in `main.tsx`.

*Note: No live production trace was run in this audit environment (no `dist/` build artifact confirmed). Waterfall is from source analysis.*

---

## 14. Timing measurements (model + E2E constraints)

**Not measured in this session:** full Production WebPageTest / trace on caretip.de. Use the model below + run `npm run build && npm run test:e2e -- e2e/landing-html-boot-handoff.spec.ts` locally for ordering proofs.

**Approximate relative timeline (desktop, good network, production build):**

| Relative time | Event |
|---------------|--------|
| 0 ms | TTFB / HTML first bytes |
| +10–50 ms | Boot painted (CSS inline) |
| +20–80 ms | `boot-locale.js` tagline finalized |
| +100–400 ms | Main entry JS download start (varies) |
| +200–800 ms | Entry evaluated; `ensureI18nReady` fetch+parse locale JSON |
| +… | **React first render** (blocked until i18n promise resolves) |
| +… | `.caretip-landing` in DOM |
| +0–1 frame | `completeHtmlBootAfterPublicPaint` |
| +180 ms | Boot fade completes, node removed |
| +0–2 frames | Hero portal into `#landing-hero-slot` |
| +0–500 ms | `AnimatedHeading` chunk may swap fallback → animated headline |

**Warm SPA navigation to `/`:** `isAppShellInteractive()` true → no HTML boot; hero may already exist in persistence layer — **much smoother**.

**Hard refresh vs client nav:** Cold path hits **A + i18n gate + full JS**; client nav reuses shell.

---

## 15. Duplicate bootstrap work

| Work | Duplicate on `/` cold? |
|------|-------------------------|
| i18n init | **Once** (but blocks React) |
| `boot-locale` + `readDocumentOrStoredLanguage` | **Aligned by design** |
| Auth session refresh | **Skipped** for anonymous |
| `prefetchPublicEntryGraph` + route import of `LandingPage` | **Overlapping** prefetch (intentional overlap, not double UI) |
| `warmLandingHeroLcpImage` | `LandingPage` module eval + `useLandingShellReady` |
| HTML boot retain patches | **Once** per document (`data-caretip-boot-retain`) |
| AppLoadingManager MutationObserver + `useLandingShellReady` handoff | **Redundant triggers**, same outcome (idempotent dismiss) |

---

## 16. Remount triggers (landing-specific)

- **Portal slot:** `useState<HTMLElement | null>(null)` → `getElementById(LANDING_HERO_SLOT_ID)` in layout effect.
- **No `key={pathname}` on hero** for `/`.
- **`landingHeroEverActivated` module flag** — survives route away and back.
- **Lazy** `AnimatedHeading` inside hero — subtree swap after chunk loads.
- **`LandingHeroAnimatedWord` `useEffect` on `safeWords`** — resets indices when words array identity changes (language change).

---

## 17. Root causes (ranked)

| Rank | Cause | Severity | Evidence |
|------|--------|----------|----------|
| 1 | **`ensureI18nReady()` gates all React** | High — extends boot visibility | `main.tsx` L129–136 |
| 2 | **Large entry graph** (routes + landing CSS + hero deps) before first landing commit | High | `routes.tsx`, `LandingPage.tsx` imports |
| 3 | **Hero portals after landing shell**; boot can dismiss before hero paints | Medium — perceived “flash/remount” | `LandingHeroPersistenceLayer.tsx`, `htmlMarketingBootBridge.ts` retain rules |
| 4 | **Tagline update on same boot** (DE HTML → EN “Just a moment…”) | Medium — “loader changed” | `index.html`, `boot-locale.js` |
| 5 | **Hero motion / lazy heading** | Medium — looks like text remount | `LandingHeroAnimatedWord`, `AnimatedHeading.lazy` |
| 6 | **React overlay stack on lazy marketing routes** (not `/`) | Medium for other URLs | `PublicRouteChunkHold` |
| 7 | Auth bootstrap blocking UI on `/` | **Low / not applicable** for anonymous | `AuthBootstrapLoadingRegistrar` + `isPublicShellPath` |

---

## 18. Recommended remediation (phase 2 — not implemented)

1. **Shorten boot-covered work:** defer non-critical imports; consider rendering a minimal public shell before full locale JSON (risk: wrong-language flash — must align with `boot-locale`).
2. **Hero in first landing commit:** render hero inline in `LandingPage` (or synchronously fill slot) so boot fade reveals hero, not empty slot.
3. **Tagline consistency:** match `index.html` default tagline to `boot-locale` output or inline boot copy via build to avoid first text swap.
4. **Instrument boot phases** (dev-only Performance marks: `boot-locale`, `i18n-ready`, `landing-commit`, `boot-removed`, `hero-portal`) before tuning timeouts.
5. **Lazy public routes:** ensure `PublicRouteChunkHold` cannot show until HTML boot is exiting (z-index already below boot 9997 vs 9990).

---

## 19. Risks of proposed fixes

- Removing i18n gate → untranslated or wrong-language first paint.
- Removing HTML boot early → recurrence of documented white `#root` (see `routes.tsx` comment, e2e spec).
- Inlining hero → larger initial React tree; may help UX, hurt TTI if not measured.
- Reducing animations → accessibility/product preference tradeoffs.

---

## 20. What should NOT be changed (without evidence)

- Do not disable `boot-locale` retain patches (white flash regression).
- Do not remove SEO static summary without crawler alternative.
- Do not disable auth bootstrap globally (protected routes depend on it).
- Do not add arbitrary boot minimum timers (comments explicitly warn against second-loader feel).
- Do not assume StrictMode is the culprit.

---

## 21. Files / components for remediation phase

| Area | Files |
|------|--------|
| React bootstrap gate | `src/main.tsx`, `src/i18n/i18n.ts` |
| HTML boot | `index.html`, `public/boot-locale.js`, `src/app/lib/htmlMarketingBootBridge.ts` |
| Handoff timing | `src/app/context/AppLoadingManager.tsx`, `src/app/lib/useLandingShellReady.ts` |
| Hero mount | `src/app/components/landing/LandingHeroPersistenceLayer.tsx`, `src/app/pages/LandingPage.tsx`, `src/components/landing/CareTipLandingHero.tsx` |
| Overlay policy | `src/app/components/AppBrandedLoadingScreen.tsx`, `src/app/routing/PublicRouteChunkHold.tsx` |
| Route eager/lazy | `src/app/routes.tsx` |
| Tests | `e2e/landing-html-boot-handoff.spec.ts`, `scripts/customer-loading-language-runtime.ts` |
| Build SEO | `scripts/prerender-public-seo-html.ts`, `src/app/lib/seo/injectRouteSeoIntoHtml.ts` |

---

## 22. Final verdict

Select all that apply:

- **B. PERFORMANCE DELAY CONFIRMED — ROOT CAUSE IDENTIFIED** (`ensureI18nReady` + JS/CSS graph before landing commit).
- **C. LOADER DUPLICATION/REMOUNT CONFIRMED — ROOT CAUSE IDENTIFIED** (same HTML boot with tagline updates; duplicate branded shell on lazy public routes; not typically stacked React overlay on `/`).
- **D. HERO REMOUNT CONFIRMED — ROOT CAUSE IDENTIFIED** (portal deferral + animation/lazy heading — mostly **not** strict unmount).
- **E. MULTIPLE BOOTSTRAP/LOADING SYSTEMS ARE COMPETING** (HTML boot manager, AppLoadingManager, optional React overlay, chunk holds — coordinated on `/` but overlapping responsibilities).
- **F. HYDRATION/PRERENDER INTERACTION IS CONTRIBUTING** — **clarified:** prerender affects **static SEO HTML only**; React does **not** hydrate it. Contribution is **SEO summary removal + client-only render**, not hydration mismatch.

**Not selected:** **A. NO SIGNIFICANT PRODUCTION ISSUE** — user-visible stall on cold load is explained by architecture above.

---

*End of Phase 1 audit. No code changes were made except this report.*
