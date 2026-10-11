# CareTip Public SEO Rendering — Forensic Audit

**Date:** 2026-09-28  
**Trigger:** Production `/faq` initial HTML showed metadata + generic summary but not FAQ Q&A (Bolt AI observation used as signal, not proof of Google failure).

**Status before remediation:** **NOT READY** — metadata prerender worked; primary public body content did not.

---

## 1. Executive summary

CareTip already had a **generalized** post-build SEO pipeline (`vite build` → `prerender-public-seo-html.ts` → `dist/**/index.html`). It correctly injected **route-specific head metadata** and a `#caretip-static-summary` block, but for most routes that block was only **H1 + meta description** (type **B**: metadata + thin static summary). FAQ Q&A lived in **i18n** and React only; JSON-LD was prerendered, but visible HTML Q&A were not.

Production `https://caretip.de/faq` (2026-09-28) matched this: title/description/canonical present; **no FAQ questions in body** until JS.

---

## 2. Current architecture (pre-fix)

| Stage | Behavior |
|-------|----------|
| **A. HTTP** | Netlify serves `dist/` (`netlify.toml` publish = `dist`). |
| **B. Initial HTML** | Route file `dist/faq/index.html` when present; else `/* → /index.html` SPA fallback (`public/_redirects`). |
| **C. Before JS** | `#caretip-static-summary` visible; `#root` empty; boot loader may show. |
| **D. Hydration** | React mounts; `removeStaticCrawlerSummary()` removes `#caretip-static-summary` (not in React tree — **no hydration mismatch**). |
| **E. After JS** | `CareTipRouteSeo` + page components render full UI. |

**Source of truth:** `CARETIP_SITEMAP_PATHS` / `SITEMAP_PATHS`, `matchSeoRoute()`, `resolveRouteSeo()`, `injectRouteSeoIntoHtml()`, `getBuildTimeSeoT()` (German `de.json`).

---

## 3. Public route inventory (18 indexable)

From `scripts/seo-sitemap-paths.mjs` (synced with `seoRoutes.ts`):

| Path | pageKey |
|------|---------|
| `/` | home |
| `/features` | features |
| `/pricing` | pricing |
| `/about` | about |
| `/contact` | contact |
| `/faq` | faq |
| `/industries/*` (6) | industry |
| `/privacy`, `/terms`, `/cookies`, `/imprint`, `/avv`, `/plv` | legal |

Placeholder noindex (not in sitemap): `/blog`, `/careers`, `/mobile-app`. Private prefixes: dashboard, auth, tip flows, etc.

---

## 4. Initial HTML findings by route (pre-fix)

| Route | Title/desc/canonical | H1 | Meaningful body | JSON-LD | Primary content source |
|-------|---------------------|-----|-----------------|---------|------------------------|
| `/` | Yes | Yes | Yes (rich home summary) | Org + SoftwareApp | Static template |
| `/faq` | Yes | SEO title | **No Q&A** (desc only) | FAQPage | i18n + React only |
| `/features` | Yes | SEO title | **Thin** (desc only) | — | i18n + React |
| `/pricing` | Yes | SEO title | **Thin** | — | i18n + React |
| `/about`, `/contact` | Yes | SEO title | **Thin** | — | i18n + React |
| `/industries/*` | Yes | SEO title | **Thin** | Breadcrumb | i18n + React |
| Legal | Yes | SEO title | **Thin** | — | API legal docs in app |

**Loader:** `#caretip-html-boot` may show “Einen Moment bitte…” — separate from static summary; crawlers still see summary unless removed (summary not hidden).

---

## 5. Metadata vs content prerender

| Level | Pre-fix |
|-------|---------|
| A. Metadata only | Partially |
| B. + static SEO summary | **Default for non-home** |
| C. Meaningful page content | **Home only** |
| D. Full page HTML | No (SPA) |

**Classification:** **B** for most routes; **C** for home only.

---

## 6. FAQ findings

- **Data:** `staticPages.faq.items[]` in `de.json` (public, static).
- **JSON-LD:** Built at prerender via `buildFaqPageJsonLd` — **present in dist**.
- **Visible HTML:** Pre-fix `buildStaticCrawlerSummaryHtml` → H1 + description only.
- **React:** `FAQPage.tsx` reads same i18n after hydration.
- **Root cause:** General static summary builder did not map pageKey → i18n body sections.

---

## 7. Root cause

Single function `buildStaticCrawlerSummaryHtml` treated non-home routes as **one paragraph**. No shared “public page content” layer tied to the same i18n sources as React. Not a deployment bug for `/faq` specifically — **prerender never emitted Q&A HTML**. Production serves prerendered files when they exist (local `dist/faq/index.html` had metadata; body was thin).

---

## 8. i18n

- Build uses **German** (`getBuildTimeSeoT()`).
- Matches `index.html` `lang="de"`.
- English via client i18n / `lang` query — **not** duplicated in prerender (documented limitation).

---

## 9. Production vs local (pre-deploy check)

| URL | Production (live) | Local dist (after fix) |
|-----|-------------------|-------------------------|
| `/faq` | H1 + meta desc only | Full FAQ `<article>` list + FAQPage JSON-LD |

**Google:** May render JS; generic crawlers and “initial HTML” tools see static summary only.

---

## 10. Routing / trailing slashes

- Sitemap URLs: no trailing slash (e.g. `https://caretip.de/faq`).
- Prerender output: `dist/faq/index.html`.
- Canonical: `https://caretip.de/faq` (no trailing slash).
- Netlify: static paths preferred over SPA fallback.

---

## 11. Backend/data issues

None. Legal pages intentionally load full text via API in the app — prerender cannot include full legal PDF/HTML without a separate static source.

---

*Remediation implemented in codebase; see `CARETIP_PUBLIC_SEO_RENDERING_REMEDIATION_REPORT.md`.*
