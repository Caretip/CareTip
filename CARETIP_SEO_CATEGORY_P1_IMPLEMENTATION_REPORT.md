# CareTip SEO — Category Visibility P1 Implementation Report

**Date:** 2026-09-25  
**Scope:** Evidence-based category visibility improvements (internal linking, distribution copy, Organization `sameAs`)  
**Baseline audits:** `CARETIP_SEO_CATEGORY_VISIBILITY_AUDIT.md`, `CARETIP_SEO_CATEGORY_CODE_FORENSIC_AUDIT.md`

---

## 1. Files changed

| File | Change |
|------|--------|
| `src/app/components/Footer.tsx` | Added `/faq` to Company column |
| `src/components/public/features/FeaturesPageFinalCta.tsx` | Added `/how-it-works` secondary CTA link |
| `src/components/public/HowItWorksStepContent.tsx` | Industry links after step 8 (payouts/distribution) |
| `src/app/lib/caretipSocialLinks.ts` | `collectCareTipOrganizationSameAs()` + safe `viteEnv()` for Node/tests |
| `src/app/lib/seo/structuredData.ts` | Organization JSON-LD `sameAs` from verified social URLs |
| `src/i18n/locales/en.json` | Features distribution copy, how-it-works link, industry link labels |
| `src/i18n/locales/de.json` | DE equivalents |
| `scripts/seo-category-p1-runtime.ts` | **New** P1 regression tests |
| `package.json` | `test:seo-category-p1` script |

**Not changed:** `index.html`, `documentSeo.ts`, `seoRoutes.ts`, `robots.txt`, `sitemap.xml`, routing, homepage H1, performance code, soft-404 behavior.

---

## 2. Internal links added

| From | To | Anchor (EN) | Anchor (DE) |
|------|-----|-------------|-------------|
| Footer → Company | `/faq` | FAQs (`footer.linkFaq`) | FAQ (`footer.linkFaq`) |
| `/features` final CTA | `/how-it-works` | See how digital tipping works | Erfahren Sie, wie digitales Trinkgeld funktioniert |
| `/how-it-works` step 8 | `/industries/gastronomy` | Digital tipping for restaurants | Digitales Trinkgeld für Restaurants |
| `/how-it-works` step 8 | `/industries/hotels` | Digital tipping for hotels | Digitales Trinkgeld für Hotels |

`/faq` remains in main navigation; footer link closes the crawl graph gap identified in the forensic audit.

---

## 3. Copy changes

### Features — tip distribution depth (`landing.features.i4Text`)

**EN (before):** “A clear audit trail when finance needs answers fast.”

**EN (after):** “A clear audit trail of every tip. See how digital tips are recorded and reach your team on the schedule you configure.”

**DE (after):** “Lückenloser Nachweis jedes Trinkgelds. Sieh, wie digitale Trinkgelder erfasst werden und dein Team nach deinem festgelegten Ablauf erreichen.”

Aligned with `/how-it-works` step 8 (“Internal tip distribution stays on your schedule”). No new tax/legal claims.

### New i18n keys

- `landing.features.howItWorksLink`
- `staticPages.howItWorks.s8IndustryLinksLead`
- `staticPages.howItWorks.linkRestaurantTipping`
- `staticPages.howItWorks.linkHotelTipping`

---

## 4. JSON-LD changes

`buildOrganizationJsonLd()` now includes `sameAs` when `collectCareTipOrganizationSameAs()` returns non-empty URLs:

- Facebook (default configured)
- Instagram (default configured)
- TikTok (default configured)
- LinkedIn **only** if `VITE_SOCIAL_LINKEDIN_URL` is set

Empty values are excluded. Organization `name`, `url`, and `logo` unchanged. No duplicate Organization blocks. SoftwareApplication, FAQPage, and BreadcrumbList logic untouched.

---

## 5. Tests added/updated

### New: `npm run test:seo-category-p1`

`scripts/seo-category-p1-runtime.ts` verifies:

- Footer contains `/faq` + `footer.linkFaq`
- Features CTA contains `/how-it-works` + `landing.features.howItWorksLink`
- How-it-works step 8 contains gastronomy/hotels industry links
- EN/DE i18n strings for new copy
- `collectCareTipOrganizationSameAs()` returns valid HTTPS URLs only
- `structuredData.ts` wires `sameAs` conditionally
- `/login`, `/dashboard` remain `noindex`; `/`, `/faq` remain indexable

### Existing (re-run, unchanged)

- `npm run test:seo-remediation` — **pass**
- `npm run test:seo-head-reconciliation` — **pass** (single canonical, single robots meta, head adoption)

---

## 6. Test results

```
npm run test:seo-category-p1          → ok
npm run test:seo-remediation          → ok
npm run test:seo-head-reconciliation  → ok
npm run typecheck                     → ok
npm run build                         → ok (built in ~2m 18s)
```

---

## 7. Sprint 1 SEO behavior — confirmation

| Item | Status |
|------|--------|
| `public/robots.txt` / `sitemap.xml` | Unchanged |
| `matchSeoRoute` indexability | Unchanged |
| `applyDocumentSeo` head reconciliation | Unchanged — tests pass |
| Static `#caretip-static-summary` in `index.html` | Unchanged |
| Homepage Organization + SoftwareApplication JSON-LD | Enhanced only via optional `sameAs` |
| FAQ FAQPage + industry BreadcrumbList | Unchanged |
| Private/auth `noindex` | Unchanged |
| Homepage H1 | Unchanged |

No duplicate canonical/meta regression introduced.

---

## 8. Intentionally NOT changed

- No new SEO landing pages
- No homepage H1 rewrite
- No SSR/SSG, hreflang, or routing changes
- No performance optimizations (Three.js, Motion, boot overlay, hero persistence)
- No soft-404 / `/:businessSlug` routing changes
- No sitemap/robots/canonical architecture changes
- No industry cross-links block (i18n exists; deferred)
- No industry FAQ JSON-LD (deferred)

---

## 9. Recommended next separate sprints

1. **Production mobile performance investigation** — re-measure CrUX/Lighthouse on `caretip.de` (prior lab artifact was `127.0.0.1:4173`, LCP ~15.2s).
2. **Soft-404 investigation** — dedicated not-found UX for garbage URLs without breaking guest `/{businessSlug}` flows.
3. **GSC-driven iteration** — monitor impressions for category queries before any blog or page sprawl.

---

*End of implementation report.*
