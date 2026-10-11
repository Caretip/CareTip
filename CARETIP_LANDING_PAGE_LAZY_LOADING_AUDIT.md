# CareTip Landing Page — Lazy Loading & Visual Loading Audit

**Date:** 2025-09-25

---

## 1. Summary

The landing page uses a **layered deferral strategy**:

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Route | Hero in persistence slot; below-fold in `LandingPageBelowFold` | Fast LCP path |
| Sections | `LandingLazySection` + `React.lazy` + `IntersectionObserver` (`900px` margin for near sections) | Code-split + mount near viewport |
| Images | Mix of `eager` / `lazy` + `warm*` preloads | Balance LCP vs bandwidth |

No SEO metadata, crawler summary, or routing was changed.

---

## 2. Images audited

| Asset / area | Loading | Reserved space | Verdict |
|--------------|---------|----------------|---------|
| Hero LCP | `warmLandingHeroLcpImage()` on route eval; hero `loading="eager"` | Hero layout CSS + story frames | **Appropriate** |
| Industries grid (6) | `eager` + `fetchpriority high` for first 3; `warmIndustryHero` on mount | Card aspect in `caretip-industry-photo-grid` | **Appropriate** |
| Audience phone / dashboard | Section **`eager`**; phone `loading="eager"`; dashboard embedded | Matched-height visuals, `48rem` lazy host N/A (eager) | **Appropriate** |
| **Guest journey WebPs (×4)** | Was `loading="lazy"` inside IO-deferred section | `--caretip-journeymockup-h` + `width`/`height` 320×640 | **Fixed** — see §8 |
| Payments marks / Stripe | `lazy` (below fold, decorative) | Compact section `14rem` reserve | **Appropriate** |
| Setup onboarding phones | `eager` in carousel; `preloadLiveMinutesOnboardingScreens` | Stage aspect in live-minutes CSS | **Appropriate** |
| Recognition photo | `lazy` | Split layout column | **Appropriate** |
| Logos / trust | `lazy` | Inline intrinsic sizes | **Appropriate** |

Background images: section gradients in CSS only (no deferred URL loads).

---

## 3. Section lazy loading

**Pattern:** `LandingLazySection` — prefetch chunk on landing mount (staggered via `scheduleMobileDeferredWork`), observe with `LANDING_NEAR_VIEWPORT_ROOT_MARGIN` (`900px`), Suspense fallback with shimmer placeholder.

| Section | eager? | minHeight reserve | prefetch |
|---------|--------|-------------------|----------|
| Industries | no | `68rem` (CSS var) | yes |
| Audience benefits | **yes** | — | yes |
| Guest journey | no | `52rem` | yes + **image warm** |
| Payments | no | `14rem` | yes |
| Setup | no | `40rem` | yes |
| Recognition | no | `44rem` | no |
| Final CTA | no | `22rem` | no |

**Finding:** When a lazy section resolved, `minHeight` on the host was **removed**, which could cause a **CLS jump** if the estimate differed from rendered height.

**Finding:** Guest journey mockups used `loading="lazy"` *after* the section itself was already deferred → risk of **staggered / empty phones** in one row.

---

## 4. Layout shift (CLS)

| Risk | Mitigation |
|------|------------|
| Lazy host height dropped after mount | **Fix:** keep `minHeight` on `[data-landing-lazy-host]` for full lifecycle |
| Journey mockups without decode | Fixed height band on `.caretip-customerjourney__visual` + intrinsic `width`/`height` on `<img>` |
| Industries / audience | Existing card + grid CSS |

---

## 5. Above-the-fold

- Hero warms LCP image before below-fold prefetch (`LandingPage.tsx`).
- No below-fold section uses `eager` except **audience benefits** (intentional product proof).
- `#caretip-static-summary` / crawler behavior untouched.

---

## 6. Customer journey (focus)

**Before:** Chunk IO-deferred → four `lazy` images could load sequentially → row looked incomplete.

**After:**

1. `warmLandingCustomerJourneyImages()` on landing prefetch (with chunk) and on section mount (`high`).
2. Mockups: `loading="eager"`, `fetchpriority="low"`, `decoding="async"`.
3. Stable visual slot via `--caretip-journeymockup-h` (unchanged sizing per product request).

Section remains code-split (not globally eager).

---

## 7. Responsive notes

- Mobile: `900px` root margin loads next sections before thumb scroll reaches them.
- Journey 2×2 / 1-col retains shared mockup height variable per breakpoint.
- Lazy fallback shimmer respects `prefers-reduced-motion`.

---

## 8. Fixes made

| File | Change |
|------|--------|
| `warmLandingCustomerJourneyAssets.ts` | Preload four WebP URLs |
| `LandingPageBelowFold.tsx` | Prefetch journey chunk + warm images |
| `LandingCustomerJourneySection.tsx` | `eager` images + mount warm + `fetchpriority="low"` |
| `LandingLazySection.tsx` | Retain `minHeight` after resolve |

---

## 9. Performance tradeoffs

- Journey images may download earlier when prefetch runs (low priority) — acceptable vs visible pop-in.
- Persistent lazy `minHeight` may leave slight extra whitespace if estimate > actual height — preferred over collapse CLS.
- Did **not** disable lazy loading globally or mark all images eager.

---

## 10. Tests

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `npm run test:seo-category-p1` | Pass |
| `npm run test:seo-remediation` | Pass |
| `npm run test:seo-head-reconciliation` | Pass |

**Manual:** Hard refresh → scroll hero → industries → benefits → guest journey; confirm four mockups fill slots together and no empty shimmer row.

**E2E (optional):** `e2e/live-ux-validation.spec.ts` — landing empty-root probe.

---

## 11. Intentionally unchanged

- Hero lazy/eager strategy and LCP warm path
- Industry image priority ladder
- Payments / recognition `lazy` images
- SEO / sitemap / robots / canonical
- Industry How It Works pages
- Crawler static summary removal on boot
