# CareTip SEO Remediation Report

**Date:** 2026-09-25  
**Sprint:** SEO Remediation Sprint 1 (based on `CARETIP_SEO_FORENSIC_AUDIT.md`)

---

## Audit Findings Addressed

| Audit finding | Status |
|---------------|--------|
| Invalid `robots.txt` (SPA HTML) | **Fixed** — static `public/robots.txt` + Netlify exceptions |
| Missing `sitemap.xml` | **Fixed** — generated at build time |
| Duplicate global `<title>` / meta description | **Fixed** — `CareTipRouteSeo` per public route |
| No canonical URLs | **Fixed** — client-side canonical per route |
| No `noindex` on private routes | **Fixed** — route classifier + `CareTipRouteSeo` |
| Homepage missing “digital tipping platform” intent | **Fixed** — SEO copy + `platformLead` on hero |
| Raw HTML only showed loading overlay | **Fixed** — `#caretip-static-summary` in `index.html` |
| Incomplete Open Graph | **Fixed** — full OG + Twitter tags via SEO layer |
| No structured data | **Fixed** — Organization, SoftwareApplication (home), FAQPage (`/faq`), BreadcrumbList (industries) |
| Orphan `/how-it-works` | **Fixed** — footer product link |
| Blog/careers/mobile-app placeholder indexing | **Mitigated** — `noindex` (excluded from sitemap) |
| Soft HTTP 404 on unknown URLs | **Partial** — app-level `noindex` for unknown/slug paths; **HTTP 200 remains** (hosting limitation) |
| Vercel sitemap.xml SPA swallow | **Fixed** — `.xml` excluded from rewrite |
| Relative OG image URLs | **Fixed** — absolute URLs in SEO layer + `index.html` |

---

## Changes Implemented

### 1. robots.txt & sitemap.xml

- **What:** `scripts/generate-seo-static-files.mjs` writes `public/robots.txt` and `public/sitemap.xml` on `prebuild`.
- **Why:** Crawlers need valid directives and URL discovery.
- **Files:** `scripts/generate-seo-static-files.mjs`, `scripts/seo-sitemap-paths.mjs`, `public/robots.txt`, `public/sitemap.xml`, `package.json` (`prebuild`)
- **Routes:** 19 indexable marketing/legal URLs in sitemap; disallow rules for private prefixes.
- **User-facing:** None.

### 2. Deployment static-file routing

- **What:** Netlify `_redirects` serves `/robots.txt` and `/sitemap.xml` before SPA fallback; Vercel rewrite excludes `.xml`.
- **Why:** Prevent SPA shell from replacing crawler files.
- **Files:** `public/_redirects`, `vercel.json`

### 3. Central SEO system

- **What:** `CareTipRouteSeo` in `RootLayout` applies title, description, canonical, robots, OG, Twitter, JSON-LD on navigation.
- **Why:** Replace single global `index.html` metadata for all public pages.
- **Files:** `src/app/lib/seo/*`, `src/app/components/seo/CareTipRouteSeo.tsx`, `src/app/routes.tsx`
- **Routes:** All public marketing/legal/industry pages; private/auth/transactional → `noindex`.

### 4. i18n SEO copy (EN + DE)

- **What:** `seo.pages.*`, `seo.industries.*` in `en.json` / `de.json`; homepage `platformLead`.
- **Why:** Language-appropriate metadata without keyword stuffing.
- **Files:** `src/i18n/locales/en.json`, `de.json`, `scripts/seo-i18n-*.json` (merge source)

### 5. Homepage search intent

- **What:** Visible `platformLead` paragraph under hero H1; updated default `index.html` title/description.
- **Why:** Close audit gap for “digital tipping platform” without rewriting hero headline.
- **Files:** `CareTipLandingHero.tsx`, `index.html`, locale files

### 6. Static crawler summary (non-JS / AI)

- **What:** Hidden `<main id="caretip-static-summary">` in `index.html` with DE+EN product summary and nav links; removed when React boots.
- **Why:** Raw HTTP clients see meaningful CareTip content, not only boot overlay text.
- **Files:** `index.html`, `src/main.tsx`, `documentSeo.ts`

### 7. Error boundary SEO

- **What:** `ErrorBoundary` applies forced `noindex` metadata.
- **Why:** Error states should not be indexed.
- **Files:** `src/app/routes.tsx`

### 8. Internal linking

- **What:** Footer product column includes `/how-it-works`.
- **Why:** Audit orphan page fix.
- **Files:** `Footer.tsx`

### 9. Regression tests

- **What:** `npm run test:seo-remediation`
- **Files:** `scripts/seo-remediation-runtime.ts`, `package.json`

---

## SEO Metadata

### Title strategy

- Format: `{Page topic} — CareTip` or natural variant per locale.
- Homepage EN: “CareTip — Digital tipping platform for hospitality”
- Homepage DE: “CareTip — Digitale Trinkgeld-Plattform für Gastgewerbe”
- Private routes: generic CareTip title + **`noindex,nofollow`**

### Description strategy

- One unique sentence per indexable page from `seo.pages.*` / `seo.industries.*` i18n keys.
- Homepage explicitly mentions digital tipping platform, QR tipping, employee tip management.

### Canonical strategy

- Base origin: `https://caretip.de` (from `VITE_CARETIP_APP_ORIGIN` / env at build, or `window.location.origin` in dev).
- **Stripped from canonical:** `lang`, `faq?q`, `contact?intent`, `contact?plan`
- **Not stripped:** other query params if present (rare on marketing routes).
- Same URL for EN/DE (hreflang deferred).

### Robots strategy

- **Indexable public pages:** `index,follow` via meta.
- **Private/auth/QR/dashboard/demo/placeholder blog:** `noindex,nofollow` via meta.
- **robots.txt:** Disallow hints for private prefixes (not a security boundary).

### OG strategy

- `og:title`, `og:description`, `og:url`, `og:type=website`, `og:site_name`, absolute `og:image` (`https://caretip.de/brand/caretip-logo-tagline.png`).
- Twitter: `summary_large_image` + matching title/description/image.

---

## Crawlability

| Asset | Location | Served as |
|-------|----------|-----------|
| `robots.txt` | `public/robots.txt` → `dist/` | Plain text |
| `sitemap.xml` | `public/sitemap.xml` → `dist/` | XML |
| SPA fallback | `_redirects` / `vercel.json` | Excludes `.txt`, `.xml` |

### SPA routing / 404 behavior

- **Unchanged:** All unmatched paths still return **HTTP 200** with SPA shell (hosting constraint).
- **Mitigation:** `noindex` for private paths, unknown nested paths (`notFound`), and business-slug catch-alls; error boundary `noindex`.
- **Remaining limitation:** True HTTP 404 requires edge/server routing beyond this sprint.

---

## AI / Non-JS Readability

Raw `index.html` now includes (before React removes it):

- `#caretip-static-summary` with H1, DE paragraph, EN paragraph, links to `/features`, `/pricing`, `/how-it-works`, `/faq`, `/contact`
- Updated default `<title>`, `<meta description>`, canonical, OG/Twitter (absolute image)
- `<noscript>` hides boot overlay when JS disabled

After React boot: static summary node is **removed**; marketing UI unchanged.

---

## Performance Changes

**None intentionally made** in this sprint (per scope). Calendly lazy-load architecture preserved.

---

## Tests Performed

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass |
| `npm run test:seo-remediation` | Pass |
| `npm run build` | Pass |

Build verified:

- `dist/robots.txt` — valid text
- `dist/sitemap.xml` — valid XML, 19 URLs
- `dist/index.html` — contains `#caretip-static-summary`

---

## Production Verification

**Production verification pending deployment.**

Pre-deploy local/production-build artifacts confirm expected files. After deploy, verify:

- `https://caretip.de/robots.txt`
- `https://caretip.de/sitemap.xml`
- Raw HTML on `/` contains static summary
- `/features`, `/pricing` show unique titles after JS (View Source vs Elements)

---

## Remaining Audit Findings

| Item | Reason deferred |
|------|-----------------|
| HTTP 404 for unknown URLs | SPA static hosting; needs edge config or SSR |
| hreflang EN/DE | No stable per-language URLs yet |
| Blog/careers/mobile-app in sitemap | Placeholder content — noindex only |
| `/:businessSlug` venue indexing policy | Intentionally noindex via slug classifier |
| Competitive ranking for “digital tipping platform” | Content/metadata improved; authority/competition external |
| Full SSR/SSG | Out of sprint scope |
| Mobile LCP ~15s (lab) | No broad perf refactor in this sprint |

---

## Deferred Work

- Full SSR / SSG migration
- hreflang + URL restructuring (`/de/`, `/en/`)
- Blog expansion + article routes
- Mass SEO landing pages
- RUM-driven LCP optimization pass
- Venue directory SEO policy decision
- Post-click Calendly optimization (documented only)

---

## Risk / Regression Assessment

| Risk | Mitigation |
|------|------------|
| Duplicate visible SEO content | Static summary `hidden` + removed on React boot |
| Dashboard title override (idle countdown) | Uses `document.title` base — compatible |
| QR landing dynamic titles | `QRLandingPage` effects run after route SEO; tip flows remain `noindex` |
| i18n missing SEO keys | Fallback `seo.pages.fallback.*` |
| Netlify robots still wrong if publish misconfigured | Explicit `_redirects` rules added |

**Tested:** typecheck, SEO runtime tests, production build. Auth, Stripe, and dashboard code paths were not modified.
