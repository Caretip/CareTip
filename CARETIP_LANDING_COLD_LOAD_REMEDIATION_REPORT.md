# CareTip Landing Cold-Load Remediation Report (Phase 2)

Source audit: `CARETIP_LANDING_COLD_LOAD_FORENSIC_AUDIT.md`  
Date: 2026-09-28

## 1. Baseline timings

| Signal | Pre-change (evidence) | Post-change (measured) |
|--------|----------------------|-------------------------|
| Production RUM / trace | Not captured in this session | Not captured |
| `npm run build` | Not re-run on pre-change tree | **Succeeded** (~10m vite + prerender) |
| E2E `landing-html-boot-handoff.spec.ts` | Contract existed; browsers not installed in first attempt | **2/2 passed** on `http://localhost:5173` (dev, ~22s per test) |
| Performance marks | N/A | Available in **dev** or `?caretipPerfMarks=1` (see §12) |

**Note:** A true before/after wall-clock comparison on production cold load was not available locally. Improvements below are justified by **critical-path sequencing** (hero before boot exit, overlapping i18n fetch) and **E2E/runtime contracts**, not by shortening loader duration.

## 2. Root causes addressed

1. **Shell-before-hero boot dismiss** — Boot retain and handoff treated `.caretip-landing` / `data-caretip-route-ready` as sufficient, while the hero was portaled one frame later.
2. **Portal delay on `/`** — `LandingHeroPersistenceLayer` rendered before `<Outlet />`, so `#landing-hero-slot` was missing on the first layout pass.
3. **Premature handoff hook** — `useLandingShellReady` called `completeHtmlBootAfterPublicPaint()` on shell commit, not hero commit.
4. **AnimatedHeading.lazy** — Lazy chunk could swap fallback → real heading during first paint.
5. **Boot tagline flash** — Static German sentence in HTML could paint before `boot-locale.js` applied stored/query language.
6. **i18n JSON waterfall** — `ensureI18nReady()` in `main.tsx` started only after the main module graph began evaluating.

## 3. Files changed

| Area | Files |
|------|--------|
| Boot / handoff | `public/boot-locale.js`, `index.html`, `src/app/lib/htmlMarketingBootBridge.ts`, `src/app/lib/landingHeroReadyDom.ts`, `src/app/lib/landingHeroBootHandoff.ts`, `src/app/lib/useLandingShellReady.ts`, `src/app/context/AppLoadingManager.tsx` |
| Landing hero | `src/app/pages/LandingPage.tsx`, `src/app/components/landing/LandingHeroPersistenceLayer.tsx`, `src/components/landing/CareTipLandingHero.tsx` |
| i18n / entry | `src/i18n/preloadLocale.ts`, `src/main.tsx` |
| Instrumentation | `src/app/lib/landingColdLoadMarks.ts` |
| Tests / contracts | `e2e/landing-html-boot-handoff.spec.ts`, `scripts/landing-hero-return-lifecycle-runtime.ts`, `scripts/ux-stability-remediation-runtime.ts`, `scripts/caretip-web-branded-loader-contract.mjs` |

## 4. i18n gate changes

- Added `src/i18n/preloadLocale.ts` exporting `landingI18nPreload = ensureI18nReady()` (single promise, no double init).
- `index.html` loads `preloadLocale.ts` **before** `main.tsx` so locale JSON fetch overlaps main graph download.
- `main.tsx` awaits `landingI18nPreload` (same guarantee: no render before active locale bundle; no DE↔EN flash).
- **Not changed:** React still waits for i18n before `createRoot().render()` — required because landing copy uses `t()` everywhere; removing the gate without untranslated keys would violate the audit constraints.

## 5. Hero readiness changes

- `isLandingHeroCommitted()` (`landingHeroReadyDom.ts`): `.caretip-landing #about-section.caretip-hero-section` or `[data-caretip-hero-ready]`.
- `shouldRetainHtmlBootUntilLandingCommit()` and `publicLandingRouteCommitted()` on `/` now require **hero committed**, not shell-only.
- `useLandingHeroBootHandoff` sets `data-caretip-hero-ready` and calls `completeHtmlBootAfterPublicPaint()` only for `id="about-section"` on cold load.
- `useLandingShellReady` only releases the React app-boot overlay and marks `caretip:landing-commit`; it no longer dismisses HTML boot.
- `AppLoadingManager` MutationObserver watches `data-caretip-hero-ready`.

## 6. Portal changes

- **Cold `/`:** `CareTipLandingHero` renders **inline** in `LandingPage` (synchronous with shell commit).
- **Warm off-home:** `LandingHeroPersistenceLayer` keeps a **hidden** hero (`about-section-persisted`) after the first home visit — no portal on `/`, no duplicate home hero.
- Rationale: portal was the main source of “empty hero slot” after boot; persistence for soft navigation is preserved off-home without blocking cold load.

## 7. Hero animation changes

- `CareTipLandingHero` imports `AnimatedHeading` directly (not `AnimatedHeading.lazy`) so the critical hero heading does not lazy-chunk swap during boot handoff.
- Intentional motion (scroll reveal, rotating words, story showcase) unchanged.

## 8. Boot tagline changes

- `#caretip-html-boot-tagline` starts **empty** in HTML; `boot-locale.js` fills copy synchronously after the boot node exists (avoids DE-then-EN flash when stored language is English).
- Generic `aria-label="CareTip"` until boot copy runs; full label set in `applyHtmlBootCopy`.
- Dev/test mark `caretip:boot-locale-ready` when localhost or `?caretipPerfMarks=1`.

## 9. Loading architecture changes

- HTML boot safety (`caretip-html-boot`, boot retain patches, landing-before-boot) **preserved** and **strengthened** for `/`.
- React branded loader on `/` unchanged (still suppressed while HTML boot node exists).
- Protected routes / auth bootstrap **not** modified.

## 10. Tests

| Test | Result |
|------|--------|
| `e2e/landing-html-boot-handoff.spec.ts` | Pass — landing before boot exit; **hero before boot exit** |
| `scripts/landing-hero-return-lifecycle-runtime.ts` | Pass |
| `scripts/ux-stability-remediation-runtime.ts` | Pass |
| `scripts/caretip-web-branded-loader-contract.mjs` | 1 pre-existing failure: noscript `#caretip-html-boot { display: none }` matches contract regex (unrelated to this remediation) |

## 11. Before/after timing (marks)

Use dev tools → Performance, or load `/` with `?caretipPerfMarks=1` and read marks:

| Mark | Meaning |
|------|---------|
| `caretip:boot-locale-ready` | Boot copy applied |
| `caretip:react-start` | `main.tsx` evaluation |
| `caretip:i18n-ready` | Locale bundle ready, render scheduled |
| `caretip:landing-commit` | Landing shell `useLayoutEffect` |
| `caretip:hero-ready` | Home hero `about-section` committed |
| `caretip:boot-exit-start` | HTML boot fade class applied |
| `caretip:boot-removed` | Boot node removed |

**Expected order:** boot-locale → react-start → (i18n-ready) → landing-commit → hero-ready → boot-exit-start → boot-removed.

## 12. Mobile / desktop / language verification

| Check | Status |
|-------|--------|
| Desktop cold `/` (dev + E2E) | Verified via Playwright |
| Mobile viewport | Not manually throttled in this session; same DOM contract applies |
| DE default boot | `boot-locale.js` + empty HTML tagline |
| EN stored / `?lang=en` | Boot copy from `readBootLanguage()` before paint when script runs immediately after boot node |
| Soft client navigation | Persistence layer off-home only; home hero inline |

**Manual follow-up recommended:** hard refresh on caretip.de, slow 4G, DE/EN stored prefs.

## 13. Remaining limitations

1. React render still gated on full active locale JSON (overlap helps latency, not correctness tradeoff).
2. Warm return to `/` remounts inline hero (hidden persistence is off-home only; acceptable trade for cold-load correctness).
3. Production RUM not collected here — validate marks and UX on deployed build.
4. Below-fold sections, analytics, PWA, and dashboard chunks remain off the critical path (unchanged).

## 14. Did cold-load UX improve?

**Yes, structurally** — the boot should no longer fade while the hero slot is empty, tagline should not flip DE→EN from static HTML, and i18n fetch starts earlier. **Perceived** improvement on production depends on network; the fix targets the sequence the audit identified, not hiding the loader sooner.

**Definition of done alignment:** Boot → fade should reveal a **complete home hero** (heading without lazy swap), then below-fold content continues loading.
