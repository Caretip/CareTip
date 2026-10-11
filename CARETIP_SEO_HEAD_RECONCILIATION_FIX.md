# CareTip SEO — Head Tag Reconciliation Fix

**Date:** 2026-09-25  
**Sprint:** SEO Sprint 1 follow-up (minimal duplicate-head fix)  
**Forensic basis:** `CARETIP_SEO_CANONICAL_LOCALE_FORENSIC.md`

---

## Root cause

Sprint 1 added static homepage SEO tags in `index.html` (canonical, description, robots, OG, Twitter) for no-JS/crawler bootstrap. `applyDocumentSeo()` only queried elements with `data-caretip-seo`, so on React boot it **appended** second managed tags instead of updating the static ones.

`document.querySelector()` returns the **first** matching element, so production DevTools showed:

- Homepage canonical on `/features`
- German homepage description on EN UI
- `index,follow` on private routes (static tag before managed `noindex`)

Pathname resolution (`resolveCanonicalPathname`), route classification, and i18n locale wiring were **not** broken.

---

## Files changed

| File | Change |
|------|--------|
| `src/app/lib/seo/documentSeo.ts` | Reconcile static head tags: adopt unmanaged matching elements, mark `data-caretip-seo`, update values, remove duplicates |
| `scripts/seo-head-reconciliation-runtime.ts` | **New** — DOM regression tests for head reconciliation |
| `package.json` | Added `test:seo-head-reconciliation` script |

**Unchanged:** `index.html` static bootstrap tags, `CareTipRouteSeo`, `resolveRouteSeo`, `seoRoutes`, i18n, sitemap, robots.txt, JSON-LD builders, auth, Stripe, dashboards, Calendly.

---

## Implementation approach

Minimal change inside `documentSeo.ts`:

1. **`findOrCreateManagedMeta` / `findOrCreateManagedLink`** — If no managed tag exists, look for an unmanaged match (`meta[name=…]`, `meta[property=…]`, `link[rel=…]` without `data-caretip-seo`), adopt it, and set `data-caretip-seo="1"`.
2. **Update content/href** on the single adopted/managed element.
3. **`removeDuplicateHeadNodes`** — Remove any other elements matching the same selector so `querySelector` and `querySelectorAll` both see exactly one tag.

Static `index.html` tags remain for pre-React/raw HTML. After `CareTipRouteSeo` runs, those same nodes become managed and hold route-specific values.

JSON-LD behavior is unchanged (`script[data-caretip-seo="jsonld"]` replace cycle preserved).

---

## Tests added

**Command:** `npm run test:seo-head-reconciliation`

Uses a lightweight in-script DOM head stub (no new test framework). Seeds static `index.html` SEO tags, calls `applyDocumentSeo()`, asserts DOM outcomes.

| Case | Assertions |
|------|------------|
| A. `/features` (EN) | One canonical → `/features`; one EN description; one `index,follow` robots; OG/Twitter route values |
| B. `/login` | One robots → `noindex,nofollow` |
| C. Homepage `/` | One canonical → `https://caretip.de/` |
| D. Locale | `/features` DE description/title/OG/Twitter |
| E. FAQ canonical | `https://caretip.de/faq` (query stripping covered separately in `test:seo-remediation`) |
| Marketing routes | `/pricing`, `/how-it-works`, `/about`, `/contact`, `/industries/gastronomy` — one canonical each |
| Private routes | `/dashboard`, `/employee/dashboard` — one `noindex,nofollow` |
| Bootstrap preserved | `index.html` still contains static canonical/description/robots |

---

## Test results

| Command | Result |
|---------|--------|
| `npm run test:seo-head-reconciliation` | **Pass** |
| `npm run test:seo-remediation` | **Pass** |
| `npm run typecheck` | **Pass** |
| `npm run build` | **Pass** |

---

## Production verification (pending deploy)

After deployment, verify in Chrome DevTools:

### `https://caretip.de/features` (EN UI)

```js
document.querySelectorAll('link[rel="canonical"]').length === 1
document.querySelector('link[rel="canonical"]')?.href === 'https://caretip.de/features'
document.querySelectorAll('meta[name="description"]').length === 1
// EN features description from seo.pages.features
document.querySelectorAll('meta[name="robots"]').length === 1
document.querySelector('meta[name="robots"]')?.content === 'index,follow'
```

### `https://caretip.de/login`

```js
document.querySelectorAll('meta[name="robots"]').length === 1
document.querySelector('meta[name="robots"]')?.content === 'noindex,nofollow'
```

### Also check

- `/faq` — canonical `https://caretip.de/faq`
- One `/industries/*` route — canonical matches path
- `/` — canonical `https://caretip.de/`
- Toggle DE UI on `/features` — description matches DE locale

---

## Confirmation: unrelated systems

No changes to authentication, Stripe, dashboards, Calendly, URL structure, hreflang, sitemap strategy, route classification, `resolveCanonicalPathname()`, or static crawler summary (`#caretip-static-summary`).
