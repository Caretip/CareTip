# CareTip Homepage — AI/Crawler Readability Fix

**Date:** 2025-09-25  
**Scope:** Homepage initial HTML body readability for non-JavaScript / AI crawlers  
**Constraint:** No SSR migration, no routing/SEO metadata/canonical/sitemap/robots/structured-data changes

---

## Root cause

The homepage already shipped a pre-hydration crawler summary (`#caretip-static-summary` in `index.html`) with a useful H1, product copy, and internal links — but it used the HTML **`hidden`** attribute.

Effects:

1. **Raw HTML body** exposed the fixed `#caretip-html-boot` loader (“Einen Moment bitte…”) as the only non-hidden body content.
2. **Meaningful product copy** existed in the source but was marked non-visible (`hidden` ≈ `display: none` for parsers and accessibility trees).
3. **`<head>` metadata** (title, description, OG) was always present and strong — crawlers that only read meta tags could still infer topic, but **body-level** AI/search extractors saw a loading shell.

`removeStaticCrawlerSummary()` in `main.tsx` correctly removes the summary after i18n boot and **before** `createRoot().render()`, so React users never see duplicate homepage content once the app mounts.

---

## Evidence from raw HTML (production, 2025-09-25)

`curl -A "Googlebot"` against `https://caretip.de/` (pre-deploy baseline):

| Signal | Present in raw HTML? |
|--------|----------------------|
| `<title>` / meta description | Yes — digital tipping platform copy |
| `#caretip-html-boot` loader text | Yes — visible body content |
| `#caretip-static-summary` | Yes in source, but **`hidden`** |
| `<h1>` in body (non-hidden) | No |

Same `index.html` is served for `/features`, `/faq`, `/industries/*` (SPA rewrite). Subpages appeared “more readable” to some tools because:

- **After JavaScript runs**, `applyDocumentSeo()` sets route-specific titles/descriptions and `PublicPageShell` commits real page DOM.
- **Head metadata** alone is often enough for short subpage summaries.
- The homepage path keeps the boot overlay until `.caretip-landing` commits, so **body text** stayed loader-dominated longer for no-JS / HTML-only parsers.

---

## Fix (minimal)

### `index.html`

1. **Removed `hidden`** from `<main id="caretip-static-summary">`.
2. **Added scoped CSS** so the summary is styled but remains covered by the existing fixed boot overlay (`z-index: 9997`) until React handoff.
3. **Updated summary copy/links** (natural language, no stuffing):
   - DE + EN product paragraphs (QR tipping, hospitality teams, distribution/payouts)
   - Crawlable links: `/features`, `/faq`, `/industries/gastronomy`, `/industries/hotels`, `/pricing`, `/contact`
   - Removed dead `/how-it-works` link

### Regression tests

- New: `scripts/seo-homepage-crawler-runtime.ts` → `npm run test:seo-homepage-crawler`
- Extended: `scripts/seo-remediation-runtime.ts` asserts summary is not `hidden` and includes key links

### Unchanged

- Boot loader UI and fade-out (`htmlMarketingBootBridge.ts`, `usePublicHtmlBootHandoff.ts`)
- `removeStaticCrawlerSummary()` timing in `main.tsx`
- SEO metadata reconciliation, canonical, sitemap, robots, JSON-LD
- Landing React UI and marketing design

---

## Why the fix is safe

| Risk | Mitigation |
|------|------------|
| Visible flash of static summary | Summary removed at i18n ready **before** React paint; boot still covers viewport until landing commits |
| Duplicate homepage | Summary node deleted before `#root` renders |
| Hydration mismatch | Static summary is outside `#root` |
| Layout shift | Boot is `position: fixed`; summary does not affect painted viewport while boot active |
| DE/EN boot locale | `boot-locale.js` only updates boot tagline, not summary |
| noscript users | Existing noscript block still hides boot; summary becomes readable |

---

## Browser / loading impact

**Expected:** No visual change for normal browsers — boot screen unchanged; React landing unchanged.

**Handoff order (unchanged):**

1. HTML boot visible  
2. i18n ready → `removeStaticCrawlerSummary()`  
3. React render  
4. Landing / public shell commits → boot fade-out  

---

## Crawler / AI verification

### Local (this change)

- `index.html` source contains non-hidden `<h1>`, product paragraphs, and internal links
- `npm run test:seo-homepage-crawler` — pass
- `npm run test:seo-remediation` — pass
- `npm run test:seo-category-p1` — pass
- `npm run test:seo-head-reconciliation` — pass
- `npm run typecheck` — pass
- `npm run build` — pass (~build verified locally)

### Production (after deploy)

Run:

```bash
curl -sL -A "Mozilla/5.0 (compatible; Googlebot/2.1)" https://caretip.de/ | findstr /i "caretip-static-summary hidden Trinkgeld features gastronomy"
```

Confirm:

- `caretip-static-summary` is present **without** `hidden`
- Body includes H1 + QR/hospitality copy + `/features` link
- Loader markup still present (expected until JS)
- `/features`, `/faq`, `/industries/gastronomy`, `/industries/hotels` still return the same shell but with crawlable summary in source

Re-check Google Search Console after deploy (no metadata changes expected).

---

## Tests and results

| Command | Result |
|---------|--------|
| `npm run test:seo-homepage-crawler` | Pass |
| `npm run test:seo-category-p1` | Pass |
| `npm run test:seo-remediation` | Pass |
| `npm run test:seo-head-reconciliation` | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |

---

## Remaining production verification

1. Deploy to `caretip.de`
2. `curl` homepage as Googlebot — confirm non-hidden summary in HTML source
3. Spot-check normal browser: no flash, boot → landing unchanged
4. Optional: rerun `e2e/landing-html-boot-handoff.spec.ts` in CI
