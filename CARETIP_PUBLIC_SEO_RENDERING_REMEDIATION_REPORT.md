# CareTip Public SEO Rendering — Remediation Report

**Date:** 2026-09-28

---

## 1. Executive summary

Implemented a **generalized build-time public body** layer: `buildPublicSeoStaticMainHtml()` maps each `SeoPageKey` to the **same German i18n sources** used by public React pages. FAQ, features, pricing, about, contact, and industry pages now emit substantive `<article>` sections in `#caretip-static-summary`. No FAQ-only branch in the prerender script; no SSR migration.

**Production status:** **NOT READY** until this commit is deployed — live `https://caretip.de/faq` still shows pre-fix HTML (verified 2026-09-28).

**Local / post-build status:** **READY — GENERAL SEO RENDERING ARCHITECTURE VERIFIED** (tests + regenerated `dist/`).

---

## 2. Architectural solution

```
CARETIP_SITEMAP_PATHS
  → matchSeoRoute + resolveRouteSeo (unchanged)
  → injectRouteSeoIntoHtml(template, seo, match, t)
       → head: metadata + JSON-LD (unchanged)
       → body: buildPublicSeoStaticMainHtml(seo, match, t)
  → dist/{route}/index.html
```

New modules:

| File | Role |
|------|------|
| `src/app/lib/seo/publicSeoStaticContent.ts` | Page-key dispatch → HTML sections from i18n |
| `src/app/lib/seo/faqStaticContent.ts` | Shared FAQ parse for HTML + JSON-LD |

---

## 3. Files changed

- `src/app/lib/seo/publicSeoStaticContent.ts` (new)
- `src/app/lib/seo/faqStaticContent.ts` (new)
- `src/app/lib/seo/injectRouteSeoIntoHtml.ts` — uses `t` for full body
- `src/app/lib/seo/structuredData.ts` — FAQ JSON-LD uses `parseStaticFaqItems`
- `scripts/prerender-public-seo-html.ts` — passes `t`
- `scripts/seo-initial-html-runtime.ts` — content regression tests

---

## 4. Build pipeline

Unchanged command: `npm run build` → Vite → `prerender-public-seo-html.ts`.

Manual verify: `node ./node_modules/tsx/dist/cli.mjs ./scripts/prerender-public-seo-html.ts` → 18 documents.

---

## 5. Hydration safety

- `#caretip-static-summary` is **outside** `#root`.
- `removeStaticCrawlerSummary()` in `main.tsx` removes it after boot — **no React hydration of static block**.
- React pages continue to render full UI from i18n; static HTML is a **crawler/non-JS fallback**, not a duplicate React tree.

---

## 6. Content by pageKey (post-fix)

| pageKey | Static body source |
|---------|-------------------|
| home | Existing rich home copy |
| faq | `staticPages.faq` + all `items[]` Q&A |
| features | `landing.features` i1–i6 |
| pricing | `staticPages.pricing` subtitle + hero features |
| about | story paragraphs + mission articles |
| contact | headline, supporting text, intent cards |
| industry | `industries.pages.{id}` headline, steps, FAQ |
| legal | SEO description (+ note when no static legal API text) |

---

## 7. Tests executed

| Command | Result |
|---------|--------|
| `npm run test:seo-initial-html` | **Pass** (includes metadata-only regression + FAQ question in HTML) |
| `npm run test:seo-remediation` | Pass |
| `npm run test:seo-homepage-crawler` | Pass |
| `npm run typecheck` | Pass |

New assertions:

- Substantive body on `/faq`, `/features`, `/pricing`, `/about`, `/contact`, `/industries/hotels`
- First FAQ question string in injected HTML
- `dist/faq/index.html` substantive when dist present

---

## 8. Production verification

| Check | Result |
|-------|--------|
| `https://caretip.de/faq` body | **Pre-deploy:** H1 + description only |
| Local `dist/faq/index.html` | **Post-fix:** multiple `<h2>` FAQ questions + JSON-LD |

**Deployment requirement:** Run `npm run build` on CI/Netlify and publish `dist/` including per-route `index.html` files.

---

## 9. Remaining limitations

- Build-time language: **German only** for static body.
- Legal pages: full document text still loaded via API in SPA; prerender shows title + description.
- English public URLs: unchanged client behavior.
- Interactive UI (accordion, search) still JS-only — static HTML lists all FAQ items as articles.

---

## 10. Definition of done checklist

| Item | Status |
|------|--------|
| General architecture (not FAQ hack) | Done |
| All sitemap routes use same mechanism | Done |
| Meaningful body in initial HTML | Done (local build) |
| FAQ Q&A in initial HTML | Done (local build) |
| Metadata/canonical/sitemap preserved | Done |
| Hydration safe | Done |
| Private routes excluded | Done |
| Automated regression tests | Done |
| `npm run build` | Run on deploy (prerender script verified) |
| Production serves new HTML | **Pending deploy** |

---

## Final status

**NOT READY** for production SEO body content until deployment.

**READY — GENERAL SEO RENDERING ARCHITECTURE VERIFIED** in repository and local `dist/` after prerender.
