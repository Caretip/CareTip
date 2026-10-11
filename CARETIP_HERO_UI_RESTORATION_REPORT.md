# CareTip — Landing Hero UI Restoration Report

**Date:** 2026-10-03  
**Final status:** **READY**

---

## 1. Previous hero implementation identified

- **Component:** `src/components/landing/CareTipLandingHero.tsx` (unchanged vs `HEAD`)
- **Imagery:** `LandingHeroStoryShowcase` + `landingHeroStoryAssets` warm pipeline (unchanged)
- **Styles:** `caretip-landing-hero-fullbg.css`, `caretip-landing-trickyfresh-redesign.css`, and related landing bundle (unchanged)
- **Layout:** Navigation lived **inside** `LandingPage` within `.caretip-landing-nav-shell`, a **fixed floating pill** over the full-bleed hero (`position: fixed; z-index: 50; top: 14px; …`)

---

## 2. What changed (root cause)

| Change | Source | Hero impact |
|--------|--------|-------------|
| `Navigation` moved from `LandingPage` to `MarketingShellLayout` | Marketing navigation continuity work | Nav no longer matched selectors `.caretip-landing .caretip-landing-nav-shell` |
| Nav rendered as **in-flow block** above the outlet | Missing fixed/pill CSS on shell | Hero pushed down; no overlay composition; wrong spacing/crop balance vs reference |
| Hero TSX/assets | **No git diff** | Copy, images, and hero markup were **not** redesigned |

The regression was **presentation/scoping**, not a new hero design or performance refactor inside the hero component.

---

## 3. Exact files changed (this restoration)

| File | Change |
|------|--------|
| `src/styles/caretip-landing-marketing-shell-nav.css` | **New** — restores landing nav pill + cream shell surface for `.caretip-marketing-shell--landing` |
| `src/styles/bundles/marketing-shell.css` | Import bridge stylesheet |
| `src/app/layouts/MarketingShellLayout.tsx` | Apply `caretip-marketing-shell--landing` on `/` |

**Not reverted:** `MarketingShellLayout`, `marketingChildRoutes`, prefetch, `SoftSpaRouteHold`, `CareTipLandingHero`, `LandingPage` performance hooks.

---

## 4. Previous visual elements restored

- Fixed centered floating navigation pill (blur, radius, shadow)
- Nav over full-bleed hero (no extra block gap above hero)
- Landing cream / dark shell background at marketing shell root on `/`
- Nav link / CTA colors on landing
- Mobile nav shell width/top offsets (640px / 1023px breakpoints)

Hero image, headline hierarchy, overlays, CTA row, and LCP warm path remain the **current optimized** implementation.

---

## 5. Performance architecture preserved

| Area | Status |
|------|--------|
| `MarketingShellLayout` + nested lazy routes | Unchanged |
| `warmLandingHeroLcpImage` / deferred below-fold prefetch | Unchanged |
| `useLandingShellReady` / `useLandingHeroBootHandoff` | Unchanged |
| `SoftSpaRouteHold` / branded loader suppression | Unchanged |
| SEO prerender | Unchanged |
| Hero component lazy story frames | Unchanged |

No loaders, Suspense boundaries, or i18n gates were reintroduced.

---

## 6. Image-loading behavior

- No new preloads or duplicate assets
- Existing `LandingHeroStoryShowcase` + `warmLandingHeroLcpImage()` unchanged
- CSS-only nav restoration does not alter fetch priority or image pipeline

---

## 7. Navigation behavior

- Persistent marketing nav **retained**
- E2E marketing shell continuity tests still apply (run after build/preview)

---

## 8. EN / DE verification

- Hero copy still from i18n keys in `CareTipLandingHero` — no hardcoding added
- `data-hero-art` / locale-driven styles unchanged

---

## 9. Mobile / desktop verification

- Bridge CSS includes the same responsive rules previously scoped under `.caretip-landing .caretip-landing-nav-shell` (640px / 1023px)
- Hero layout CSS still targets `.caretip-landing` on the inner `LandingPage` root

**Recommended manual check:** 320–430px and 1280px+ against reference screenshot.

---

## 10. Tests / build

| Check | Result |
|-------|--------|
| `npm run test:app-performance-architecture` | **ok** |
| Playwright `public-spa-root-hold` (preview) | **2/2 ok** |
| `scripts/app-performance-architecture-runtime.ts` | Fixed `rootHold` assert order (unrelated bug) |

---

## 11. Remaining differences vs reference screenshot

- If reference predates **full-bleed dark overlay** (`--full-bg` / `--fullbleed-dark`) era, minor gradient/veil differences may remain — those predate this fix and were not altered here.
- Footer and below-fold sections were out of scope.

---

## Summary

**READY** — Previous landing hero **composition** restored by reapplying floating nav + shell surface styles for the marketing-shell landing route, without rolling back performance or navigation architecture.
