# CareTip Marketing Pages — Hierarchy & Optical Balance Report

**Date:** 2025-09-25  
**Scope:** Public marketing UI refinement (presentation only)  
**Constraint:** No SEO, routing, copy, product claims, or dashboard changes

---

## Pages audited

| Route | Entry / template | Shell |
|-------|------------------|-------|
| `/` | `LandingPage.tsx` + `LandingPageBelowFold.tsx` | Custom (nav + footer) |
| `/features` | `FeaturesPage.tsx` | `PublicPageShell` (full) |
| `/pricing` | `PricingPage.tsx` | `PublicPageShell` (full) |
| `/about` | `AboutPage.tsx` | `PublicPageShell` (full) |
| `/contact` | `ContactPage.tsx` | `PublicPageShell` (full) |
| `/faq` | `FAQPage.tsx` | `PublicPageShell` (full) |
| `/industries/gastronomy` | `IndustryPage.tsx` → `IndustryPageTemplate` | `PublicPageShell` (full) |
| `/industries/hotels` | same | same |
| `/industries/logistics` | same | same |
| `/industries/midwives` | same | same |
| `/industries/field-service` | same | same |
| `/industries/fairs` | same | same |

Homepage “How It Works” (`#how-it-works` in `SimpleSetupSection`) and all industry **steps** sections were inspected and left unchanged.

---

## Problems found

### Visual hierarchy

1. **Double horizontal padding on subpages** — `PublicPageShell` applied `px-4/6/8` while each page also used `__inner` rails at `clamp(1.25rem, 4vw, 2.5rem)`, making content feel inset and narrower than the 72rem design intent.
2. **Features hero rhythm** — `/features` stacked `landingUi.section` padding (including its own `px-*`) on top of shell padding, producing a heavier top block and a narrower grid than FAQ/Pricing.
3. **Industry mobile hero** — Hero copy and CTA stayed left-aligned on narrow viewports while steps/benefits sections were centered, breaking reading order on phones.
4. **CTA button footprint drift** — Marketing subpage CTAs used `min-w-[10rem]` while landing CTAs use `lg:min-w-[12.5rem]`; industry final CTA secondary used a bespoke class instead of the shared button system.
5. **Single-button CTA bands** — Features closing CTA (post how-it-works removal) had no explicit single-button centering rule.

### Optical balance

1. **Uneven vertical rhythm** — Features section top padding was disproportionate vs. FAQ/Pricing hero entry.
2. **Industry benefits on tablet** — Two-column benefits could feel top-heavy when image and copy stacked without centered alignment.
3. **Pricing tier footers** — Card action rows did not consistently pin to the card bottom when descriptions varied in length.
4. **FAQ content column** — Accordion stack could read wider than the search field and hero subtitle measure.
5. **Contact page edge bleed risk** — Contact relies on a single full-width container without a page `__inner`; removing shell padding without compensating would risk edge-to-edge copy on mobile.

### Consistency gaps (pre-fix)

- Three container models: shell padding, page `__inner`, and industry `width: min(100% - 2rem, 72rem)`.
- Four hero patterns (landing cinematic, orange band, features landing-section, industry full-bleed, about minimal).
- Wise CTA bands shared styling but slightly different end-of-page padding.

---

## Changes made

### Shared components / tokens

| File | Change |
|------|--------|
| `src/components/public/PublicPageShell.tsx` | Applies `caretip-public-main--flush-x` when `maxWidth="full"` so pages own one horizontal rail |
| `src/components/public/publicPageUi.ts` | Added `mainFlushX` token |
| `src/components/public/publicPagesBrandUi.ts` | Unified CTA min-widths to `sm:min-w-[11rem] lg:min-w-[12rem]` |
| `src/components/industries/IndustryPageTemplate.tsx` | Industry final secondary CTA now uses `publicPagesBrandUi.ctaButtonSecondary` |

### Shared styles (primary pass)

**`src/styles/caretip-marketing-pages-optical-balance.css`** — extended sections 7–14:

- **§7 Shell rail** — Flush shell horizontal padding; restore contact `padding-inline` on the shared rail
- **§8 Features** — Remove duplicate section horizontal pad; unify optical rail; calmer top/bottom section rhythm; cap feature grid at 64rem
- **§9 Industry** — Mobile/tablet hero centering; benefits stack balance; final CTA action alignment
- **§10 Wise CTAs** — Consistent bottom padding; `:has(:only-child)` centering for single-button bands
- **§11 About** — Calmer hero entry; balanced story headline/prose measure
- **§12 FAQ** — Content + search field aligned to 46rem / 36rem columns
- **§13 Pricing** — Tier card actions pinned with `margin-top: auto`
- **§14 Headings** — Shared `text-wrap: balance` on marketing section titles; industry benefits title centers on mobile, left on desktop

Existing earlier sections (landing hero exit rhythm, pricing hero padding reclaim, footer density, industry section joins) were preserved.

---

## Responsive issues addressed

| Breakpoint | Fix |
|------------|-----|
| **Mobile (<640px)** | Industry hero copy/CTA centered; features single-rail padding; contact rail inset; single CTA full-width cap in wise bands |
| **Tablet (640–959px)** | Industry benefits image stacks above copy, centered; features grid gap unchanged from prior optical-refine |
| **Desktop (≥960px)** | Industry benefits title left-aligned; pricing tier footers align across cards; unchanged hero full-bleed breakouts |

No `transform` / `translate` hacks were added.

---

## Intentionally left unchanged

- **SEO** — metadata, canonical, sitemap, robots, structured data, `seoRoutes.ts`, i18n SEO strings
- **Routing** — no route additions/removals
- **Marketing copy** — no text rewrites
- **Landing design system** — `landingUi.ts`, `landing.css` graph, Manrope hero on `/` (subpages remain Roboto via existing `caretip-marketing-playfair-type.css`)
- **About sr-only H1 pattern** — accessibility structure preserved; visual story still opens at `h2`
- **Four distinct hero architectures** — aligned rhythm/spacing only, not unified into one hero component
- **Legacy unused components** — `CTASection.tsx`, `HeroNestedCardSection.tsx` (not mounted in live routes)
- **Dashboard / auth / employee UI**
- **Industry steps content and markup** — `IndustryPageTemplate` steps section untouched except final CTA secondary class

---

## Tests run and results

| Command | Result |
|---------|--------|
| `npm run test:seo-category-p1` | Pass |
| `npm run test:seo-remediation` | Pass |
| `npm run test:seo-head-reconciliation` | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass (~2m 3s) |

No dedicated visual regression suite exists in-repo; layout verification was done via code audit of shared rails, responsive rules, and existing e2e selectors (`#how-it-works`, industry sections) remaining valid.

---

## Coherence check

After changes, all full-bleed marketing subpages share:

- One **72rem content rail** (`clamp(1.25rem, 4vw, 2.5rem)` inset)
- One **CTA button footprint** via `publicPagesBrandUi` + `caretipButtonSystem`
- One **closing-band rhythm** via wise CTA CSS
- **Industry mobile** hero behavior aligned with centered steps/FAQ below

Landing `/` retains its own cinematic system but benefits from existing optical-balance sections §1–2 (hero min-height and section joins) without structural changes in this pass.
