# CareTip Landing — Final Performance, Media & Language Audit + Remediation

**Date:** 2026-09-28  
**Context:** Builds on `CARETIP_LANDING_COLD_LOAD_FORENSIC_AUDIT.md` and Phase 2 cold-load remediation (`a91b71b1`). This pass targets **images**, **DE↔EN switching**, and **coherent landing architecture**—not boot timing hacks.

---

## 1. Baseline (measured vs source-level)

| Scenario | Measured locally | Notes |
|----------|------------------|--------|
| Cold `/` (dev `localhost:5173`) | E2E pass ~6–7s wall to assertions | Playwright `domcontentloaded`; not full Lighthouse |
| Hard refresh | Not instrumented in CI | Same stack as cold in dev |
| Warm SPA nav to `/` | Source: inline hero + `warmLandingHeroLcpImage` Map | Prior portal delay removed in Phase 2 |
| Mobile / desktop | E2E default desktop viewport | `scripts/landing-phase-validation.mjs` supports `VALIDATION_VIEWPORT=mobile` against preview |
| DE / EN cold | Single locale at boot (`load: "currentOnly"`) | ~350–378 KB JSON chunks per locale (gzip ~105–115 KB) per production build |
| DE→EN / EN→DE switch | **Before fix:** network wait for full alternate JSON on first switch | **After fix:** idle prefetch + menu-open prefetch |
| FCP / LCP / CLS / TBT | **Not captured** in this session | Use Lighthouse on `npm run build && npm run preview` + `?caretipPerfMarks=1` |

**Performance marks (dev / `?caretipPerfMarks=1`):**  
`caretip:boot-locale-ready`, `react-start`, `i18n-ready`, `landing-commit`, `hero-ready`, `boot-exit-start`, `boot-removed`, `lang-switch-start`, `lang-switch-complete`.

---

## 2. Image inventory (landing)

| Asset / area | Component | Format | Loading | Preload / warm | Notes |
|--------------|-----------|--------|---------|----------------|-------|
| Hero LCP frame `wyc` / mobile `formemobile01` | `LandingHeroStoryShowcase` | AVIF/WebP/JPEG via `<picture>` | `loading="eager"`, `fetchpriority="high"` on LCP | `index.html` link preload; `warmLandingHeroLcpImage()`; `ensureLandingHeroLcpPreloadLink()` | Second frame `wyo` deferred after LCP |
| Hero carousel frame 2 | Same | Dynamic import in `loadDeferredHeroStoryFrame` | Low priority after LCP | `preloadHeroFrame` | Crossfade only when ready |
| Customer journey mockups (4) | `LandingCustomerJourneySection` | WebP imports | `eager` + `fetchpriority="low"` | `warmLandingCustomerJourneyImages("high")` on mount | Fixed dimensions 320×640 |
| Industry teaser (6) | `IndustryPhotoGrid` | AVIF/WebP per card | `eager` index &lt; 6, else `lazy` | `warmIndustryHero(id, low)` on mount | Below-fold but warmed early |
| Audience benefits cards | `LandingAudienceBenefitsSection` | WebP + picture | Intersection / priority warm helper | Per-card warm on reveal | AVIF strip on error |
| Motivation recognition | `LandingMotivationRecognitionVisual` | picture | lazy path + error→webp | Section-level | |
| Live in Minutes phones | `LiveInMinutesOnboardingPhone` | 4× DE + 4× EN WebP | `eager` on active stack | `preloadLiveMinutesOnboardingScreens` | **Locale switch changes `src` keys** — mitigated by dual-locale idle preload |
| Payments badges | `PaymentsStripeBadge`, `PaymentsAcceptedMarks` | SVG/PNG | Default | None | Small |
| Footer / nav | No large photos | — | — | — | |

**Failure handling:** Hero and several sections strip AVIF `<source>` and fall back to WebP/JPEG on `onError`. `landingMediaResume.ts` re-decodes GPU-dropped tiles after tab hide.

---

## 3. Hero image — root cause analysis

**Symptom:** Hero image sometimes appears missing or late after cold load, warm return, or tab resume.

| Hypothesis | Verdict | Evidence |
|------------|---------|----------|
| A. Element never mounts | Unlikely on `/` post Phase 2 | Hero inline in `LandingPage`; E2E requires `#about-section` before boot exit |
| B. Request fails | Possible on AVIF | `handleFrameImageError` + warm `failToWebp` |
| C. Bytes loaded, not painted | **Yes (intermittent)** | Chrome GPU tile drop; `refreshLandingDecodedImages` |
| D. Hidden by CSS | **Mitigated** | Full-bleed: first `caretip-hero-bg-frame-layer` forced `opacity: 1` (see `caretip-landing-hero-story.css`) |
| E. Animation delay | Card variant only | Background hero: `transition: none` on first paint |
| F. Source swap | Carousel only | LCP frame stable until crossfade |
| G. Remount / new request | **Warm nav** | New hero instance on return to `/`; warm Map + DOM sync reduces blank gap |
| H. Preload URL mismatch | Low risk | Vite rewrites `index.html` preloads to hashed assets; JS warm uses bundled URLs |

**Primary causes addressed in this pass:**

1. **Warm cache not applied to React LCP state** — showcase could wait for `<img>` load even when `warmLandingHeroLcpImage()` had already decoded the bitmap.  
   **Fix:** `getWarmLandingHeroImage()` in `useLayoutEffect` → `handleLcpFrameLoad()`.

2. **Language switch unrelated to hero bytes** — hero photos are locale-agnostic; slowness was i18n + below-fold locale-specific screenshots.

---

## 4. Language switching — root cause

**Trace:** `LanguageSwitcher` → `changeAppLanguage` → `ensureLocaleBundle` → dynamic `import("./locales/{en|de}.json")` → `i18n.changeLanguage` → React re-render via `useTranslation`.

| Stage | Finding |
|-------|---------|
| Bundle at startup | **Only active locale** (`load: "currentOnly"`, one resource in `ensureI18nReady`) |
| First switch to alternate | **~350 KB JS chunk** download + parse (main delay) |
| Global loading overlay | `beginAppLanguageChange` / `endAppLanguageChange` exist but **no UI subscribes** — not a full-page loader |
| Hero remount | Language change re-renders hero for copy; **image URLs unchanged**; `memo(CareTipLandingHero)` limits unnecessary work |
| Live in Minutes | New locale ⇒ new `src` set ⇒ decode unless preloaded |

**Fixes:**

- `prefetchAlternateLocaleBundle()` — adds inactive locale to i18n resources during idle (after landing warm).  
- Scheduled from `LandingPage` (~2.5s desktop / ~5.5s mobile) and when language menu opens.  
- `preloadLiveMinutesOnboardingScreens(["en", "de"])` on same idle hook.  
- Marks: `lang-switch-start` / `lang-switch-complete`.

---

## 5. React / rendering

- **LandingPage** re-renders on language change (expected for `t()`).  
- **Hero** memoized; `imageAlt` string updates without remounting section id or picture keys (`key={frame.key}`).  
- **Persistence layer** off-home only; no portal gap on cold `/`.  
- No evidence of locale-driven `key=` on hero root.

---

## 6. JavaScript (landing critical path)

| Tier | Examples |
|------|----------|
| Critical | `preloadLocale`, `main`, active locale JSON, `LandingPage`, inline hero, `AnimatedHeading` (eager on hero) |
| Important | `warmLandingHeroLcpImage`, below-fold chunk prefetch (`prefetchLandingBelowFoldSections`) |
| Deferred | Alternate locale JSON (idle), onboarding DE+EN screens (idle), PWA, API wake-up, AI assistant host, second hero frame |

Landing route does **not** eagerly import dashboard/Stripe; below-fold sections remain lazy chunks.

---

## 7. CSS & fonts

- **Bundles:** `marketing-shell.css` + `landing.css` on `LandingPage` only.  
- **Hero:** Many layered rules; full-bleed LCP protected from 1.35s opacity fade.  
- **Fonts:** Inter in critical path; Manrope/hero display via `scheduleHeroDisplayFont()` deferred import on marketing paths.

---

## 8. Third-party / background

- Analytics / PWA / API wake-up already deferred via `scheduleMobileDeferredWork` in `main.tsx`.  
- No change required for this pass.

---

## 9. Animation

- Hero crossfade gated on `lcpComplete` and `frameReady`.  
- Reduced motion collapses to single frame.  
- Language switch does not restart hero carousel timers beyond normal re-render.

---

## 10. Mobile

- Responsive hero: `(max-width: 767px)` sources + matching preload media queries.  
- E2E language + boot tests pass on default Playwright viewport; dedicated mobile widths not re-run in this session.

---

## 11. Changes implemented (this pass)

| PROBLEM | ROOT CAUSE | CHANGE | IMPACT |
|---------|------------|--------|--------|
| Slow DE↔EN | Alternate locale JSON fetched on first switch | `prefetchAlternateLocaleBundle` + idle + menu-open prefetch | Switch should be near-instant after prefetch (defensible; E2E switch passes) |
| Slow EN switch on setup section | Onboarding WebPs loaded per locale on demand | Idle `preloadLiveMinutesOnboardingScreens(["en","de"])` | Decode before user switches at Live in Minutes |
| Hero blank after warm/cache | LCP React state ignored warm Map | `getWarmLandingHeroImage()` in showcase `useLayoutEffect` | Faster `lcpComplete`; fewer “empty hero” frames |
| Extra hero re-renders | Parent updates on i18n | `memo(CareTipLandingHero)` | Fewer subtree updates on language change |
| Observability | No switch timing | `lang-switch-*` marks | Dev/profiling only |

**Files touched:** `src/i18n/i18n.ts`, `src/app/pages/LandingPage.tsx`, `src/components/i18n/LanguageSwitcher.tsx`, `src/components/landing/LandingHeroStoryShowcase.tsx`, `src/components/landing/CareTipLandingHero.tsx`, `src/app/lib/landingColdLoadMarks.ts`, `e2e/landing-language-switch.spec.ts`, `scripts/landing-final-performance-runtime.ts`.

---

## 12. Before / after measurements

| Metric | Before (source / prior behavior) | After |
|--------|----------------------------------|--------|
| First locale switch latency | Network-bound (~100 KB gzip JSON) | Memory-bound if prefetch completed |
| Hero LCP state after warm | Could wait for DOM load event | Sync from warm Map |
| E2E boot handoff | 2 tests | 2 tests pass |
| E2E language + hero | N/A | **New test passes** |
| Lighthouse LCP/FCP | Not measured | Run locally on preview |

---

## 13. Tests

- `e2e/landing-html-boot-handoff.spec.ts` — pass  
- `e2e/landing-language-switch.spec.ts` — pass  
- `scripts/landing-final-performance-runtime.ts` — pass  

---

## 14. Remaining limitations

1. **Production RUM / Lighthouse** not recorded here.  
2. **Warm return to `/`** still mounts a fresh hero instance (by design post Phase 2); warm Map mitigates image gap, not full React state preservation.  
3. **Industry grid** still warms six hero assets on mount (low priority)—acceptable tradeoff for scroll smoothness; could be narrowed with IO if bandwidth becomes an issue.  
4. **Customer journey** uses four eager images; warmed but still competes for bandwidth below hero.  
5. **First language switch before idle prefetch completes** may still hit network once.

---

## 15. Performance tradeoffs

- Idle alternate-locale prefetch adds **~100 KB gzip** transfer after first paint—not on critical path.  
- Dual onboarding locale preload adds **8 WebP** fetches idle—improves switch UX in that section only.  
- Memo on hero: small memory, fewer renders.

---

## Verdict

# READY — LANDING PERFORMANCE PASS COMPLETE

The landing page now has a documented image strategy, deterministic hero LCP warm-path integration, idle alternate-locale architecture, and regression tests for boot + language + hero stability. Remaining items are **measurement on production** and optional tightening of below-fold image warming—not blockers for shipping this architecture.
