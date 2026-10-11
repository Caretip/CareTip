# CareTip SEO — Category Visibility Code Forensic Audit

**Date:** 2026-09-25  
**Type:** Read-only code forensic audit — **no code changes**  
**Strategic baseline:** `CARETIP_SEO_CATEGORY_VISIBILITY_AUDIT.md`  
**Technical baseline:** Sprint 1 SEO (`75c24c94`) + head reconciliation (`69d28df0`), production-verified  
**Scope:** Category discoverability evidence from actual implementation (EN/DE), headings, internal links, schema, media, performance signals, SPA behavior, localization, entity consistency

---

## Executive summary

CareTip’s **category positioning is materially present in code** across metadata, homepage supporting copy, `/features`, `/how-it-works`, `/faq`, and industry pages. Sprint 1 technical SEO is **intact** — sitemap, robots, route SEO, static homepage summary, JSON-LD, and head reconciliation are implemented as designed.

**No P0 category-visibility blockers** were found in the codebase. Remaining gaps are **semantic depth**, **internal linking**, **entity/schema enrichment**, and **performance** — not indexability.

| Area | Code verdict |
|------|----------------|
| Category terms in crawlable copy | **Good but uneven** — strong in SEO layer + `platformLead`; weaker in some visible H1s |
| Industry pages (gastronomy/hotels) | **Solid template** — QR/cashless/hospitality clear; literal “restaurant/hotel tipping platform” phrases absent from H1s |
| `/how-it-works` | **Strongest explanatory asset** — 9 steps, explicit tip distribution in step 8 |
| Internal linking | **Moderate gaps** — `/how-it-works` not in main nav; `/faq` not in footer; weak cross-links from features/industries |
| Structured data | **Functional, minimal** — no invalid schema found; industry FAQs not in FAQPage schema |
| Non-JS / HTTP-only deep URLs | **Homepage OK**; **deep marketing routes depend on JS** for body copy |
| Soft 404 | **Present for unknown 1–2 segment paths** (business slug catch-all); mitigated by `noindex` |
| Mobile performance (repo artifact) | **~15.2s lab LCP** on local preview — likely dominated by JS (Three.js, Motion) + boot path; **not re-measured on production in this audit** |

**Core recommendation:** Strengthen **existing** high-value URLs with small, evidence-based copy/link changes; operate GSC; defer keyword landing-page sprawl. Treat performance and soft-404 as **separate sprints**.

---

## Methodology

1. Read strategic baseline `CARETIP_SEO_CATEGORY_VISIBILITY_AUDIT.md`.
2. Inspected page components, i18n (`en.json`, `de.json`), SEO system (`seoRoutes.ts`, `resolveRouteSeo.ts`, `structuredData.ts`, `documentSeo.ts`, `index.html`).
3. Traced routing (`routes.tsx`, `publicRoutes.ts`) for soft-404 and SPA behavior.
4. Mapped internal links (`Navigation.tsx`, `Footer.tsx`, CTAs, industry showcase).
5. Reviewed heading structure from components + i18n keys (H1/H2/H3).
6. Audited images/alt patterns on marketing components.
7. Analyzed `lighthouse-mobile.json` (local `127.0.0.1:4173` preview, mobile emulation, 2026-07-11).
8. **Did not** modify code, run builds, or invent search-volume / GSC / ranking data.

### Primary files inspected

| Area | Files |
|------|--------|
| Pages | `LandingPage.tsx`, `LandingPageBelowFold.tsx`, `FeaturesPage.tsx`, `HowItWorksPage.tsx`, `PricingPage.tsx`, `FAQPage.tsx`, `AboutPage.tsx`, `IndustryPage.tsx` |
| Templates / hero | `CareTipLandingHero.tsx`, `IndustryPageTemplate.tsx`, `HowItWorksPageHero.tsx`, `HowItWorksStepContent.tsx`, `HowItWorksStepVisual.tsx`, `HowItWorksProductMoment.tsx`, `PricingHero.tsx`, `FaqPageHero.tsx`, `AboutPageHero.tsx` |
| SEO | `index.html`, `documentSeo.ts`, `resolveRouteSeo.ts`, `seoRoutes.ts`, `structuredData.ts`, `CareTipRouteSeo.tsx`, `main.tsx` |
| Navigation | `Navigation.tsx`, `Footer.tsx`, `CTASection.tsx`, `SimpleSetupSection.tsx`, `IndustryShowcase.tsx`, `FeaturesPageFinalCta.tsx` |
| i18n | `src/i18n/locales/en.json`, `de.json`, `i18n.ts` |
| Routing | `routes.tsx`, `publicRoutes.ts`, `BusinessStaffDirectoryPage.tsx` |
| Performance | `lighthouse-mobile.json`, `index.html` (preloads, boot overlay) |

---

## 1. Existing public page content

### Category phrase coverage matrix (EN visible + SEO copy)

Evidence from i18n keys and components. Legend: **Clear** / **Partial** / **Buried** / **Missing** / **Product-only**

| Concept | `/` | `/features` | `/how-it-works` | `/industries/gastronomy` | `/industries/hotels` | `/faq` | `/pricing` | `/about` |
|---------|-----|-------------|-----------------|--------------------------|----------------------|--------|------------|----------|
| digital tipping platform | **Clear** (`platformLead`, SEO, static summary) | Partial (H1 “tipping platform”) | Partial (SEO title; H1 “CareTip Journey”) | Partial (SEO meta) | Partial (SEO meta) | Partial | Partial (`pageSubtitle`) | SEO only |
| tipping platform | Partial | **Clear** (H1) | Partial | Missing in H1 | Missing in H1 | Partial | Missing | Missing |
| digital tipping | **Clear** (hero description, meta) | Partial | **Clear** (steps 5–8) | Partial (“cashless”, “digital”) | Partial | **Clear** | Partial | Partial (story) |
| QR tipping / QR code tipping | **Clear** | **Clear** (`i1Title`) | **Clear** (steps 3–5) | **Clear** | **Clear** | **Clear** | Partial | Missing |
| cashless tipping | **Clear** (hero, trust) | Partial | Partial | **Clear** (subhead) | Partial (“digital”) | Partial | Partial | Partial |
| hospitality tipping | **Clear** (`platformLead`, sections) | **Clear** (subtitle) | Partial | Partial | Partial | **Clear** | **Clear** | Partial |
| restaurant tipping | Partial (marquee/teaser) | Partial | Partial | **Clear** (context; not literal “restaurant tipping platform”) | — | Partial | Partial | Partial |
| hotel tipping | Partial | Partial | Partial | — | **Clear** (context) | Partial | Partial | Partial |
| employee tip management | **Clear** (`platformLead`) | Partial (“Employee dashboards”) | Partial (steps 2, 6) | Partial | Partial | Partial | Missing | Partial |
| tip distribution | **Buried** (“Fair Distribution” below fold) | **Buried** (“Tip history”) | **Clear** (step 8 body + industry FAQ) | **Clear** (FAQ a2) | Missing | Partial | Missing | Partial (“fair distribution”) |
| employee payouts | Partial | **Clear** (`Instant Payouts`) | **Clear** (step 8) | Partial (“Real-time payout”) | Partial | **Clear** | Partial | Partial |

### Page-by-page evidence

#### `/` (Homepage)

| Element | Source | Wording (EN) |
|---------|--------|--------------|
| **H1** | `landing.showcase.heroHeadline` | “More tips for your team. Zero effort for your business.” |
| **Category definition** | `landing.showcase.platformLead` | “CareTip is the digital tipping platform for hospitality teams — QR code tipping, employee tip management, and secure payouts.” |
| **Hero description** | `landing.showcase.description` | “QR code tips, fast, cashless, and tax free.” |
| **Trust chips** | `landing.showcase.heroTrust.items` | Includes “Contactless tipping” |
| **SEO title** | `seo.pages.home.title` | “CareTip — Digital tipping platform for hospitality” |
| **Static HTML** | `index.html` `#caretip-static-summary` | DE H1 + EN paragraph with full category stack; nav links to key pages |

**Verdict:** Category is **clear** for crawlers and readers who see `platformLead`/meta/static summary. H1 is intentionally outcome-led (per product/strategic baseline).

#### `/features`

| Element | Source | Wording (EN) |
|---------|--------|--------------|
| **H1** | `landing.features.title` | “One connected **tipping platform**” |
| **Subtitle** | `landing.features.subtitle` | “QR codes, live analytics, and multi-location control…” |
| **Cards** | `landing.features.i1–i6` | QR tipping pages, Employee dashboards, Business analytics, Tip history, Instant Payouts, Feedback |
| **Final CTA** | `staticPages.features.ctaBody` | “Start accepting **digital tips**…” |

**Verdict:** Strong **platform + QR + payouts** signal. “Tip distribution” only indirectly via “Tip history” / audit trail.

#### `/how-it-works`

| Element | Source | Wording (EN) |
|---------|--------|--------------|
| **H1** | `staticPages.howItWorks.title` | “The CareTip Journey” |
| **SEO title** | `seo.pages.howItWorks.title` | “How CareTip works — QR digital tipping” |
| **Steps 1–9** | `staticPages.howItWorks.s{n}Title/Body` | Full journey: account → team → QR → placement → digital tips → notifications → analytics → **“Track & manage payouts”** (explicit **tip distribution**) → growth |

**Verdict:** Best **informational** page. Visible H1 underuses category terms; body copy compensates.

#### `/industries/gastronomy` & `/industries/hotels`

Shared template: `IndustryPageTemplate.tsx` + `industries.pages.{id}.*`.

**Gastronomy (EN):**
- H1: “More tips for your team. Zero hassle for your **restaurant**.”
- Subhead: “**cashless tipping via QR code** directly at the table”
- FAQ: “How are tips distributed?” — direct vs pooled
- SEO title: “Restaurant digital tipping — CareTip”

**Hotels (EN):**
- H1: “Discrete appreciation at the front desk and in **housekeeping**.”
- Subhead: “classy, **digital** way to tip… concierge, cleaning staff, and reception”
- SEO title: “Hotel digital tipping — CareTip”

**Verdict:** Strong **vertical + QR + cashless** coverage. Phrases like “restaurant tipping platform” / “hotel tipping platform” appear in **metadata**, not H1s — acceptable, not a blocker.

#### `/faq`

- H1: “Questions? We've got answers.”
- Subtitle explicitly mentions “digital tipping, team management, and Instant Payouts”
- Items cover QR safety, no guest app, tip attribution, payouts (`staticPages.faq.items`)

#### `/pricing`

- H1: “Fair and Transparent Price” (`staticPages.pricing.pageTitle`)
- Subtitle: “launch **digital tipping** for your hospitality business”
- CTA copy: “bring **digital tipping** to your team”

#### `/about`

- H1: `sr-only` — “About us” (`AboutPageHero.tsx`)
- Visible H2 story + mission; mentions cashless, payout, “fair distribution”
- Weak explicit “digital tipping platform” in visible body (SEO meta only)

### Concepts genuinely missing or weak

| Gap | Evidence |
|-----|----------|
| “Tipping app” as category | Product is web QR; FAQ denies guest app — **intentional mismatch** if targeted |
| “Tip distribution software” as head term | Only step 8 + dashboard product language; not homepage/features H1 territory |
| “Employee tipping software” | “Employee dashboards” / “team management” — product terms, not category phrases |
| “Contactless tipping” | Hero trust chip; not repeated on features/how-it-works H1s |
| Literal “restaurant tipping platform” in visible industry H1 | SEO title yes; headline is outcome/vertical story |

---

## 2. Heading structure

### Summary table

| Page | H1 | Major H2/H3 | Category in headings? | Notes |
|------|-----|-------------|----------------------|-------|
| `/` | Outcome headline (`CareTipLandingHero`) | Below-fold: industries teaser, audience benefits, simple setup (`id="how-it-works"` **anchor**, not route), motivation, CTA | **Partial** — not in H1; `platformLead` is body text | Do not change H1 for keywords |
| `/features` | “One connected tipping platform” | H2 per card = `i{n}Tag` (e.g. “Instant setup”); titles in card accent | **Good** on H1 | Card H2s are tags, not feature names |
| `/how-it-works` | “The CareTip Journey” | H2 per step title (×9); H2 “Trust and speed…”; H3 trust cards | **Weak in H1**; **good in step titles** | SEO title stronger than visible H1 |
| `/pricing` | “Fair and Transparent Price” | Plans section, tier cards | **Weak** | Commercial intent, not category |
| `/faq` | “Questions? We've got answers.” | Accordion questions as H3/buttons | **Weak in H1**; **good in Q text** | |
| `/industries/gastronomy` | Restaurant outcome headline | H2 “The process”; H2 benefits; H2 “Top FAQs” | **Moderate** — QR/cashless in subhead | |
| `/industries/hotels` | Hotel service headline | Same template | **Moderate** | |
| `/about` | `sr-only` “About us” | H2 story title; H2 mission; H2 CTA | **Weak** | Visible story H2 is founder narrative |

### Hierarchy quality

- **One H1 per page** — consistent across inspected templates.
- Industry pages: logical H1 → H2 sections → H3 step/benefit titles.
- Features page: H1 strong; card hierarchy uses tag as H2 — acceptable UX, slightly weak for scanners expecting feature name as H2.
- Homepage `#how-it-works` section ID on `SimpleSetupSection` is a **scroll anchor**, not a link to `/how-it-works` — naming collision only; no extra H1.

---

## 3. Internal linking

### Link graph (implemented)

```
index.html static summary → /features, /pricing, /how-it-works, /faq, /contact

Navigation (desktop + mobile):
  /features, Industries ▼, /pricing, /faq, /contact
  (NOT /how-it-works, NOT /about)

Footer:
  Product: /features, /pricing, /how-it-works
  Industries: all 6 industry paths
  Company: /about, /contact
  Legal: privacy, terms, avv, plv, cookies, imprint
  (NOT /faq)

Homepage:
  IndustryShowcase / teaser → /industries/*
  CTASection → /how-it-works
  HeroNestedCardSection legacy nav → /how-it-works (“Solutions”)
  SimpleSetupSection id="how-it-works" (anchor only)

/how-it-works → /pricing (CTA); no in-body links to industries
/features → /signup only (final CTA)
/industries/* → /signup, /pricing (final CTA); no /how-it-works
/about → /signup, /pricing
/faq → support CTAs (contact)
```

### Findings

| Issue | Severity | Evidence |
|-------|----------|----------|
| `/how-it-works` absent from main nav | **Moderate** | `Navigation.tsx` — features, pricing, faq only |
| `/faq` absent from footer | **Moderate** | `Footer.tsx` company/product columns |
| `/features` does not link to `/how-it-works` | **Moderate** | `FeaturesPageFinalCta.tsx` → `/signup` only |
| Industry pages lack cross-industry links | **Low–moderate** | `industries.shared.moreIndustries*` exists in i18n but **not rendered** in `IndustryPageTemplate.tsx` |
| `/about` weak inbound | **Low** | Footer only — expected for about |
| Generic anchors | **Low** | “View pricing”, “Start for free” — acceptable |
| Orphan/near-orphan | **None critical** | All indexable marketing URLs reachable from nav and/or footer and/or homepage |

### Natural linking opportunities (future — not implemented)

1. Footer → `/faq`
2. `/features` body or CTA → `/how-it-works` (“how digital tipping works”)
3. `/how-it-works` step 4/5 → `/industries/gastronomy` or `/industries/hotels`
4. Industry template → “Explore other industries” block (i18n ready)
5. FAQ answers → industry deep links where context fits

---

## 4. Industry page quality

### `/industries/gastronomy`

| Criterion | Assessment |
|-----------|------------|
| Category clarity | **Good** — QR, cashless, restaurant, no guest app |
| Commercial intent | **Good** — table QR, staff pooling, tax claims |
| Uniqueness vs template | **High** — restaurant-specific copy, icons, media |
| Heading quality | Outcome H1; process/benefits/FAQ H2s — **solid** |
| Depth | 3 steps + 3 benefits + 2 FAQs + trust row — **not thin** |
| Internal linking | Inbound strong; outbound weak (signup/pricing only) |
| CTA relevance | **Good** — “Start for free now” |
| Structured data | `BreadcrumbList` only — **no** `FAQPage` for on-page FAQs |
| Metadata | `seo.industries.gastronomy` — “Restaurant digital tipping” |
| Thin-content risk | **Low** |
| Duplicate-template risk | **Medium** across 6 industries — mitigated by distinct copy/media |
| “restaurant digital tipping” / “restaurant tipping platform” | **Moderate** — meta + body; not literal platform phrase in H1 |

### `/industries/hotels`

| Criterion | Assessment |
|-----------|------------|
| Category clarity | **Good** — hotel departments, digital, cashless |
| Commercial intent | **Good** — reception, housekeeping, international payments |
| Uniqueness | **High** |
| “hotel digital tipping” / “hotel tipping platform” | **Moderate** — meta + context; H1 is service-story |
| Other criteria | Same template strengths/limits as gastronomy |

---

## 5. How-it-works content

### Coverage of required topics

| Topic | Crawlable text? | Where |
|-------|-----------------|-------|
| How digital tipping works | **Yes** | Steps 3–5 (`s3`–`s5` body) |
| How QR tipping works | **Yes** | Steps 3–4 |
| How customers tip | **Yes** | Step 5 — scan, no app, card/wallet |
| Tip attribution | **Partial** | Step 5–6; stronger on `/faq` |
| Team distribution | **Yes** | Step 8 — “Internal tip distribution stays on your schedule” |
| Payouts | **Yes** | Step 8 — Instant Payouts, audit trail |
| What businesses manage | **Yes** | Steps 1–2, 7 |

### Information only in visuals / UI

| Asset | Issue |
|-------|-------|
| `HowItWorksStepVisual` / `ImageMoment` | Step photos use `alt=""`; label in `<figcaption>` only — decorative treatment |
| Hero `HowItWorksHeroVisual` | Timeline mock — supplementary |
| `HowItWorksStepContent` extras | `HOW_IT_WORKS_STEPS` uses `extras: null` for all steps in flow config — **no** chip/stat panels active; **all substance is in `s{n}Body` paragraphs** (good for SEO) |

**Verdict:** `/how-it-works` **sufficiently explains** the product journey in crawlable text. Step images are supplementary, not sole carriers of meaning.

---

## 6. Features page

### Category & differentiators

| Theme | Coverage |
|-------|----------|
| Tipping platform | **H1 explicit** |
| QR tipping | **Card 1** |
| Employee management | **Card 2** (“Employee dashboards”) |
| Tip distribution | **Weak** — “Tip history” / audit trail, not “distribution” |
| Payouts | **Card 5** — Instant Payouts |
| Analytics | **Card 3** |
| Business management | Implied via analytics + multi-location subtitle |

**Gap (meaningful only):** Tip **distribution** as a category concept is underrepresented vs `/how-it-works` step 8. No link to explanatory journey page.

**Note:** `staticPages.features` (older “Caring is Tipping” block) is **not** used for the main features grid — page uses `landing.features.*`. Final CTA pulls `staticPages.features.ctaTitle/ctaBody`.

---

## 7. Structured data

### Implemented JSON-LD (`structuredData.ts` + `buildJsonLdForRoute`)

| Schema | Page(s) | Properties provided | Accurate vs visible? |
|--------|---------|---------------------|----------------------|
| `Organization` | `/` | `name`, `url`, `logo` | **Minimal** — accurate but thin |
| `SoftwareApplication` | `/` | `name`, `applicationCategory`, `operatingSystem: Web`, `url`, `description` (from SEO home) | **Accurate** — no `featureList`, `offers` |
| `FAQPage` | `/faq` | All `staticPages.faq.items` Q/A | **Accurate** |
| `BreadcrumbList` | `/industries/*` | Home → industry label | **Accurate** |

### Not present (evaluation only)

| Opportunity | Notes |
|-------------|-------|
| `Organization.sameAs` | Social URLs in `caretipSocialLinks.ts` not in schema |
| `FAQPage` on industry pages | On-page FAQs exist but no JSON-LD |
| `SoftwareApplication` on `/features` | Not implemented — probably unnecessary duplicate |
| Invalid/duplicate schema | **Not found** post head-reconciliation |

### Potentially misleading

- None identified — descriptions align with visible marketing copy.
- Tax-related claims in industry copy are **marketing/legal** concern, not schema mismatch.

---

## 8. Image / media SEO

### Homepage hero (LCP candidate)

| Item | Implementation |
|------|----------------|
| Preload | `index.html` — `formemobile01.avif` (mobile), `wyc.avif` (desktop), `fetchpriority="high"` |
| Alt | `landing.showcase.tabQrAlt` — “Phone showing CareTip QR tipping screen” |
| Loading | Hero via `LandingHeroStoryShowcase` — background crossfade |

### Industry pages

- Hero: `industries.pages.{id}.heroAlt` — **descriptive, vertical-specific**
- Benefits image: `benefitsAlt` — descriptive
- `loading="lazy"` on benefits images

### How-it-works

- `hw01.webp`–`hw09.webp` — **`alt=""`** with figcaption labels from `staticPages.howItWorks.visual.*`
- **SEO gap (minor):** step images could carry alt text; explanatory text exists in adjacent paragraphs

### Other marketing images

| Component | Alt quality |
|-----------|-------------|
| `HeroSectionNew.tsx` | “Digital tipping platform” (hardcoded EN) |
| `QRTippingSection.tsx` | “Guests at a table paying with a phone” |
| `LandingMotivationRecognitionVisual.tsx` | `alt=""` (decorative) |
| `LandingAudienceBenefitsSection` | i18n `imageAlt` keys |

### Performance vs SEO

- Hero preload + boot overlay affect **LCP timing** (performance), not alt/category semantics.
- Filename `wyc.avif`, `formemobile01.avif` — not keyword-rich; **low SEO impact**.

---

## 9. Mobile performance — forensic only

### Source artifact

`lighthouse-mobile.json`:
- **URL:** `http://127.0.0.1:4173/` (Vite **preview build**, not `caretip.de`)
- **Date:** 2026-07-11
- **Device:** Mobile emulation (Moto G Power class)
- **CPU warning:** Slower than Lighthouse expects

**This audit did not re-run Lighthouse on production.** Production CWV may differ (CDN, caching, real device mix).

### Key lab metrics (artifact)

| Metric | Value |
|--------|-------|
| LCP | **15.2 s** |
| FCP | 3.8 s |
| TBT | **9,250 ms** |
| Speed Index | 14.4 s |
| TTI | 17.5 s |
| CLS | ~0 (good) |
| Observed LCP (trace) | 8.3 s |

### Likely LCP element

- Homepage hero image path (`formemobile01.avif` / `wyc.avif`) preloaded in `index.html`
- LCP delayed by **long main-thread blocking** before paint completes

### Contributors (classified)

| Category | Contributors | Evidence |
|----------|--------------|----------|
| **A. CareTip-controlled** | Large JS bundles on landing route | `vendor-three-*.js` ~279KB (76% unused per LH); `vendor-motion-*.js` ~93KB (92% unused); `index-*.js` ~149KB |
| **A.** | HTML boot overlay | `#caretip-html-boot` fixed full-screen until React paints |
| **A.** | Render-blocking CSS/JS | `index-*.css` ~134KB; `theme-init.js`; `caretip-font-faces.css` |
| **A.** | Font preload | Inter woff preload in `index.html` |
| **A.** | Hero persistence layer | `LandingHeroPersistenceLayer` — keeps hero mounted across routes (session optimization; landing cold start still pays full cost) |
| **B. Third-party** | Low in this run | `third-parties-insight` score 1 — minimal third-party cost in preview |
| **C. Dev-only** | `LoaderDiagRuntime` in DEV | Not in production bundle |
| **D. Production** | CDN/compression/caching | Not measured here |

### SEO vs performance

- **Severe mobile LCP/TBT can hurt rankings** as a ranking signal — separate from category copy.
- **Not a crawl/index blocker.**

---

## 10. SPA / soft-404

### Unknown URL behavior

| URL pattern | HTTP | React behavior | SEO (`matchSeoRoute`) |
|-------------|------|----------------|------------------------|
| `/features`, known marketing paths | **200** (SPA `index.html`) | Correct page | `indexable: true` |
| `/industries/invalid` | **200** | `Navigate` → `/` | `notFound`, **noindex** |
| `/random-slug` (1 segment, not reserved) | **200** | `BusinessStaffDirectoryPage` → API error UI | `notFound`, **noindex** |
| `/slug/employee` (2 segments) | **200** | Staff tip page or error | `private` / `notFound` |
| `/blog`, `/careers`, `/mobile-app` | **200** | Placeholder pages | **noindex** (placeholder set) |
| No matching route (e.g. 3+ unknown segments) | **200** | Likely empty `Outlet` or `ErrorBoundary` | `notFound`, **noindex** |

### Distinction

| Risk | Search visibility impact |
|------|--------------------------|
| **Soft 404** (200 + thin/error for garbage URLs) | **Low–moderate** — `noindex` on unknowns reduces index pollution; slug catch-all is product-required |
| **True blocker** | **None found** for legitimate marketing URLs |

Fixing true HTTP 404 would require server/deployment coordination — **separate sprint**; must not break `/{businessSlug}` guest flows.

---

## 11. AI / non-JS discoverability

### Sprint 1 static strategy — status

| Mechanism | Status |
|-----------|--------|
| `index.html` title, description, canonical, robots | **Intact** (DE default) |
| `#caretip-static-summary` | **Intact** — DE + EN category paragraph + nav links |
| Removal on React boot | `main.tsx` → `removeStaticCrawlerSummary()` — summary **removed after JS runs** |
| `CareTipRouteSeo` | Updates head per route when JS executes |

### Fetcher behavior

| Fetcher | `/` | Deep marketing URL (e.g. `/how-it-works`) |
|---------|-----|-------------------------------------------|
| Googlebot (JS) | Full content after render | Full content |
| HTTP-only / no JS | Homepage meta + **hidden** static summary in HTML | **Homepage shell meta only** — route body requires JS/i18n |
| AI crawlers (variable) | Likely see static summary + meta | Likely see generic `index.html` bootstrap |

### Remaining gaps

1. Deep URLs have **no static per-route HTML body** — acceptable for SPA with sitemap + JS rendering; not equivalent to SSR.
2. Static summary uses `hidden` attribute — still in DOM for initial fetch; removed post-hydration.
3. Category proposition on `/` **without JS** is **adequate** via meta + static summary; **not** repeated on other URLs without JS.

**SSR/SSG not recommended** from this evidence alone — homepage static layer + JS rendering is functioning as designed.

---

## 12. Localization (DE/EN)

### Architecture

- Default locale: **`de`** (`i18n.ts`, `index.html lang="de"`)
- URL: **no locale path prefix** — language via client i18n + `boot-locale.js`
- Canonical: `lang` query stripped (`resolveCanonicalPathname`)
- **No hreflang** (per project constraint)

### Category parity

| Key area | DE | EN | Parity |
|----------|----|----|--------|
| `seo.pages.home` | “Digitale Trinkgeld-Plattform” | “Digital tipping platform” | **Yes** |
| `landing.showcase.platformLead` | DE equivalent in `de.json` | Full category stack | **Yes** |
| `seo.industries.gastronomy/hotels` | DE vertical titles | EN vertical titles | **Yes** |
| Industry headlines | DE restaurant/hotel copy | EN copy | **Yes** |
| `/how-it-works` H1 | Localized “CareTip Journey” equivalent | Same pattern | **Yes** |
| Static `index.html` | DE-primary | EN paragraph in static summary | **By design** |

### Gaps

- Hardcoded EN alts in a few components (`HeroSectionNew`, `QRTippingSection`) — minor DE parity issue for image SEO.
- SEO-relevant content **changes with language toggle** — same URL serves both; acceptable without hreflang if primary market is DE.

**Category visibility issue from locale architecture:** **None material** — both locales communicate the same concepts.

---

## 13. Brand / entity consistency

| Signal | Implementation | Gap |
|--------|----------------|-----|
| Product name | **CareTip** dominant | Occasional “Caretip” in legal strings |
| Legal entity | **CareTip UG** — `staticPages.imprint` | — |
| Domain | **caretip.de** in FAQ, imprint, canonical | — |
| Emails | info@caretip.de, support@caretip.de | — |
| Social | Facebook, Instagram, TikTok in `caretipSocialLinks.ts` | LinkedIn empty unless env set |
| Organization schema | Minimal — no `sameAs` | **Entity signal gap (low–medium)** |
| About | Founder story — supports E-E-A-T, weak category | — |

No invented registration numbers — imprint uses i18n placeholders as implemented.

---

## 14. Search intent coverage

Classification: **Strong** / **Moderate** / **Weak** / **Missing** / **Intent mismatch**

| Intent group | Term | Rating | Evidence |
|--------------|------|--------|----------|
| **Category** | digital tipping platform | **Strong** | `platformLead`, `seo.pages.home`, static summary |
| | tipping platform | **Strong** | `/features` H1, footer blurb, metadata |
| | digital tipping | **Strong** | Homepage, FAQ, how-it-works, pricing subtitle |
| **Technology** | QR tipping | **Strong** | Across homepage, features, how-it-works, industries, FAQ |
| | QR code tipping | **Strong** | Same |
| | cashless tipping | **Strong** | Hero, gastronomy, trust chips |
| | contactless tipping | **Moderate** | Trust chip; not repeated widely |
| **Vertical** | restaurant tipping | **Moderate** | Gastronomy page + landing teaser; not literal head term in H1 |
| | restaurant tipping platform | **Moderate** | SEO meta gastronomy; body close |
| | hotel tipping | **Moderate** | Hotels page + landing real-life section |
| | hotel tipping platform | **Moderate** | SEO meta hotels |
| | hospitality tipping | **Strong** | `platformLead`, features, FAQ |
| **Product** | employee tip management | **Moderate** | `platformLead`, features card, FAQ |
| | digital tip distribution | **Moderate** | How-it-works step 8; buried elsewhere |
| | employee tipping software | **Weak** | Product/dashboard language only |
| **Informational** | how digital tipping works | **Strong** | `/how-it-works` + FAQ |
| | how QR tipping works | **Moderate–strong** | How-it-works steps 3–5; FAQ |
| | how restaurants distribute digital tips | **Moderate** | Step 8 + gastronomy FAQ a2 |

**Intent mismatch:** “tipping app” — **Mismatch** if pursued aggressively (no guest app).

---

## 15. Content / page sprawl risk

| Proposed URL | Can existing pages satisfy intent? | Verdict |
|--------------|-----------------------------------|---------|
| `/digital-tipping-platform` | **Yes** — `/`, `/features`, `/how-it-works` | **Do not build** — duplicate |
| `/tipping-app` | **Partial** — would mislead (web QR product) | **Do not build** — intent mismatch |
| `/qr-tipping` | **Yes** — homepage, features, how-it-works, FAQ | **Do not build** |
| `/tip-distribution-software` | **Partial** — how-it-works step 8; needs copy depth not new URL | **Defer** — improve existing |
| `/restaurant-tipping` | **Yes** — `/industries/gastronomy` | **Do not build** |
| `/hotel-tipping` | **Yes** — `/industries/hotels` | **Do not build** |

---

## 16. Maintenance / complexity (future improvements)

| Improvement | Complexity | Maintenance | Regression risk | Dependencies |
|-------------|------------|-------------|-----------------|--------------|
| Footer + FAQ link | **Low** | Low | Very low | None |
| Features → how-it-works link | **Low** | Low | Very low | None |
| How-it-works → industry links (1–2 sentences) | **Low** | Low | Low | i18n EN/DE |
| Industry “more industries” block | **Low–medium** | Low | Low | i18n exists |
| Strengthen step 8 / features distribution copy | **Low** | Low | Low | Legal review if tax/payout claims expand |
| Organization `sameAs` in JSON-LD | **Low** | Low | Very low | Confirm social URLs |
| Industry FAQPage schema | **Medium** | Medium | Medium | Keep in sync with accordion content |
| Nav: add how-it-works | **Low** | Low | Low | UX decision |
| Soft-404 dedicated page + routing | **High** | Medium | **High** | Must not break `/{businessSlug}` |
| Mobile perf (defer Three/Motion on landing) | **High** | Medium | Medium | QA hero visuals |
| SSR/SSG per-route static HTML | **Very high** | High | High | **Not justified** by this audit |

Favor **i18n edits + a few links** over new routes or architecture.

---

## 17. Prioritization

### P0 — genuine blockers

**None.** Sprint 1 technical SEO intact; no regression found in canonical/robots/sitemap/static summary.

### P1 — high-value

1. **Internal links:** footer → FAQ; features → how-it-works; how-it-works → gastronomy/hotels (contextual).
2. **Copy depth:** one natural sentence on tip distribution on `/features` or step 8 intro (EN+DE) — align with product truth.
3. **GSC operations:** submit sitemap, monitor queries for category terms (see §18).
4. **Organization schema `sameAs`** — low effort entity boost.

### P2 — useful later

1. Industry cross-links (`moreIndustries` UI).
2. Industry page FAQ JSON-LD.
3. How-it-works step image alt text.
4. Nav inclusion of `/how-it-works`.
5. Earned authority (case studies) — off-site.

### P3 — do not pursue now

1. Keyword landing page fleet.
2. `/tipping-app` targeting.
3. SSR/SSG migration for SEO alone.
4. hreflang / locale URLs.
5. Homepage H1 rewrite for keywords.

---

## 18. Google Search Console dependencies

**Wait for real GSC data before:**

| Decision | GSC signals needed |
|----------|-------------------|
| Whether to add blog/guide content | Impressions for informational queries; CTR on `/how-it-works` vs `/faq` |
| Whether gastronomy/hotels need more “platform” wording | Queries containing “restaurant tipping platform”, “hotel digital tipping” |
| Whether to build any new URL | Indexed pages report — cannibalization vs existing URLs |
| Priority of DE vs EN content investment | Query language split |
| Performance sprint urgency | **CrUX / CWV** field data vs lab `lighthouse-mobile.json` |
| Soft-404 cleanup priority | “Crawled – currently not indexed”, soft 404 reports |
| Industry page indexation | Coverage for `/industries/*` |

**Do not invent:** impressions, clicks, positions, or rankings.

---

## 19. Final recommendation

### A. IMPLEMENT NEXT

Smallest evidence-based set:

1. **Footer link to `/faq`** — FAQ is indexable and strong for category Q&A; currently nav-only.
2. **One contextual link `/features` → `/how-it-works`** with anchor like “how digital tipping works”.
3. **One contextual link `/how-it-works` → `/industries/gastronomy` and/or `/industries/hotels`** in relevant steps.
4. **Optional i18n tweak:** single natural mention of “tip distribution” on `/features` (card or subtitle) — mirror step 8 truth.
5. **Add `sameAs` to Organization JSON-LD** from `caretipSocialLinks.ts`.
6. **Submit/monitor GSC** — sitemap, homepage + 6 industries + how-it-works + features.

### B. AUDIT/FIX SEPARATELY

1. **Mobile performance sprint** — defer `vendor-three` / `vendor-motion` on landing; boot overlay timing; re-measure on **production** CrUX.
2. **Soft-404 strategy** — dedicated not-found UX for non-slug garbage URLs without breaking `/{businessSlug}`.
3. **Legal review** of industry tax claims (“100% tax-free”) before amplifying in SEO copy.

### C. WAIT FOR GOOGLE SEARCH CONSOLE DATA

1. Whether blog articles add unique value beyond `/how-it-works`.
2. Whether restaurant/hotel pages need stronger “platform” phrasing in visible H2s.
3. Whether DE or EN deserves disproportionate content investment.
4. Whether any industry URL should be deprioritized.

### D. DO NOT BUILD

- `/digital-tipping-platform`, `/qr-tipping`, `/restaurant-tipping`, `/hotel-tipping`, `/tip-distribution-software` as standalone SEO URLs.
- `/tipping-app` as SEO target.
- Mass blog generation, thin landing pages, link schemes.
- hreflang / locale URL architecture.
- SSR/SSG solely for category terms already covered on homepage + how-it-works.
- Homepage H1 replacement for keyword insertion.

---

## Checks performed

| Check | Result |
|-------|--------|
| Code inspection (pages, SEO, routing, i18n) | Completed |
| Lighthouse JSON review (`lighthouse-mobile.json`) | Completed — local preview only |
| Production Lighthouse / CrUX | **Not run** in this audit |
| `npm test` / build | **Not run** (read-only scope) |
| Code modifications | **None** |

---

## Important finding (no immediate P0)

**Sprint 1 SEO implementation is intact.** The highest-impact remaining work is **(1)** small internal linking + distribution copy on existing URLs, **(2)** GSC-driven iteration, and **(3)** a **separate production mobile performance** investigation — lab LCP ~15.2s on local preview is a ranking *signal* risk, not a crawl blocker.

---

*End of forensic audit — read-only, no code changes.*
