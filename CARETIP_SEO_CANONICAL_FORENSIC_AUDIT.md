# CareTip — Full Public SEO Canonical Forensic Audit

**Audit type:** Read-only forensic analysis (no application, deployment, or SEO metadata changes).  
**Repository:** CareTip-main (source of truth).  
**Production origin assumed:** `https://caretip.de` (matches `index.html`, `public/sitemap.xml`, `resolveRouteSeo.ts`).  
**Audit date:** 2026-09-26.

---

## 1. Executive Summary

### Observed Google Search Console anomaly (supplied evidence)

| Inspected URL | User-declared canonical | Google-selected canonical |
|---------------|-------------------------|---------------------------|
| `https://caretip.de/pricing` | `https://caretip.de/` | `https://caretip.de/faq` |

All other URLs: **Google-selected canonical — NOT AVAILABLE — GSC inspection required.**

### Primary conclusion (repository-evidenced)

**The `/pricing` canonical issue is not an isolated one-off bug in pricing-specific code.** It is consistent with a **shared SPA architecture** where:

1. **Every public URL is served the same static `index.html` shell**, which hard-codes homepage SEO (`<link rel="canonical" href="https://caretip.de/" />`, homepage `<title>`, homepage `meta description`, `og:url` → `/`).
2. **Route-specific canonicals are applied only in the browser** via `CareTipRouteSeo` → `applyDocumentSeo()` inside a **`useEffect`** (after paint), not in initial HTML and not via SSR/prerender.
3. **Automated tests explicitly require** the static homepage canonical to remain in `index.html` while asserting that `applyDocumentSeo()` overwrites it post-hydration (`scripts/seo-head-reconciliation-runtime.ts`).

Therefore, any crawler or GSC inspection pass that reads **initial HTML** or **does not reliably execute/reconcile client SEO** will report **user-declared canonical = homepage** for `/pricing`, `/features`, `/faq`, and all other deep marketing routes — not only `/pricing`.

The **Google-selected canonical of `/faq` for `/pricing`** is **not fully explainable from code alone**. Observable conflicting signals include: wrong user-declared canonical (`/`), sitemap listing both URLs as separate indexable pages, FAQ `FAQPage` JSON-LD on `/faq`, FAQ copy referencing pricing, and **identical static body copy** (`#caretip-static-summary`) on every SPA response until React removes it. **Further GSC URL inspections are required** to confirm patterns on other routes.

### Additional high-severity finding (non-canonical but SEO-critical)

**`/how-it-works` is indexable in `seoRoutes.ts` and listed in `sitemap.xml`, but there is no matching route in `src/app/routes.tsx`.** The URL likely resolves to the catch-all `/:businessSlug` (`BusinessStaffDirectoryPage`) while SEO still declares canonical `https://caretip.de/how-it-works`. This is a **routing / content / canonical mismatch**, not verified in a live HTTP fetch in this audit.

### Severity overview

| Severity | Issue |
|----------|--------|
| **CRITICAL** | Static homepage canonical + homepage meta on all URLs (initial HTML); GSC-confirmed on `/pricing`. |
| **CRITICAL** | `/how-it-works` in sitemap + SEO indexable list without dedicated React route. |
| **HIGH** | Shared static crawler summary (homepage H1/body) on every URL until JS. |
| **HIGH** | Client SEO runs in `useEffect` (late vs `useLayoutEffect` / SSR). |
| **MEDIUM** | Placeholder routes (`/blog`, `/careers`, `/mobile-app`) indexable in SEO table but `noindex` + omitted from sitemap (intentional). |
| **LOW** | `/about` omitted from some prefetch/boot path sets but routed and in sitemap. |
| **NO ISSUE** (post-hydration, if JS runs) | `resolveRouteSeo()` + `applyDocumentSeo()` logic produces correct absolute canonical per path (unit-tested). |
| **NO ISSUE** | Sitemap URLs align with `SITEMAP_PATHS` / expected canonical paths (no trailing-slash drift). |

---

## 2. Public SEO Route Inventory

**Sources:** `src/app/lib/seo/seoRoutes.ts`, `src/app/routes.tsx`, `public/sitemap.xml`, `public/robots.txt`.

| URL | Public? | Intended indexing | Canonical expected | Evidence |
|-----|---------|-------------------|--------------------|----------|
| `/` | Yes | Index | `https://caretip.de/` | `INDEXABLE_EXACT`, `routes.tsx` `LandingPage`, sitemap |
| `/features` | Yes | Index | `https://caretip.de/features` | `INDEXABLE_EXACT`, `routes.tsx`, sitemap |
| `/pricing` | Yes | Index | `https://caretip.de/pricing` | `INDEXABLE_EXACT`, `routes.tsx`, sitemap |
| `/how-it-works` | Yes (SEO) | Index | `https://caretip.de/how-it-works` | `INDEXABLE_EXACT`, sitemap — **no `routes.tsx` path** (see §9) |
| `/about` | Yes | Index | `https://caretip.de/about` | `INDEXABLE_EXACT`, `routes.tsx`, sitemap |
| `/contact` | Yes | Index | `https://caretip.de/contact` | `INDEXABLE_EXACT`, `routes.tsx`, sitemap |
| `/faq` | Yes | Index | `https://caretip.de/faq` | `INDEXABLE_EXACT`, `routes.tsx`, sitemap |
| `/industries/gastronomy` | Yes | Index | `https://caretip.de/industries/gastronomy` | `matchSeoRoute` industry branch, `routes.tsx`, sitemap |
| `/industries/hotels` | Yes | Index | `https://caretip.de/industries/hotels` | Same |
| `/industries/logistics` | Yes | Index | `https://caretip.de/industries/logistics` | Same |
| `/industries/midwives` | Yes | Index | `https://caretip.de/industries/midwives` | Same |
| `/industries/fairs` | Yes | Index | `https://caretip.de/industries/fairs` | Same |
| `/industries/field-service` | Yes | Index | `https://caretip.de/industries/field-service` | Same |
| `/industries/events` | Yes (redirect) | Index target: `/industries/fairs` | `https://caretip.de/industries/fairs` | `Navigate` in `routes.tsx` — **sitemap does not list `/industries/events`** |
| `/privacy` | Yes | Index | `https://caretip.de/privacy` | Legal routes, sitemap |
| `/terms` | Yes | Index | `https://caretip.de/terms` | Legal routes, sitemap |
| `/cookies` | Yes | Index | `https://caretip.de/cookies` | Legal routes, sitemap |
| `/imprint` | Yes | Index | `https://caretip.de/imprint` | Legal routes, sitemap |
| `/avv` | Yes | Index | `https://caretip.de/avv` | Legal routes, sitemap; `/dpa` → `/avv` redirect |
| `/plv` | Yes | Index | `https://caretip.de/plv` | Legal/pricing list page, sitemap |
| `/blog` | Yes | **Noindex** (placeholder) | Would be `https://caretip.de/blog` if indexed | `PLACEHOLDER_NOINDEX`, `routes.tsx`, **not in sitemap** |
| `/careers` | Yes | **Noindex** (placeholder) | Would be `https://caretip.de/careers` | Same |
| `/mobile-app` | Yes | **Noindex** (placeholder) | Would be `https://caretip.de/mobile-app` | Same |
| `/help` | Yes | **NOT VERIFIED IN CODEBASE** as indexable | Redirect → `/contact?intent=support` | `routes.tsx` `Navigate`; not in `INDEXABLE_EXACT` |
| `/{businessSlug}` | Yes (guest) | **Noindex** | N/A (private) | `isPublicBusinessSlugPath` + `matchSeoRoute` → `private` |
| `/login`, `/dashboard/*`, tip flows, QR, etc. | Yes | **Noindex** | Self-URL with `noindex` | `NOINDEX_PREFIXES`, `robots.txt` Disallow |

---

## 3. Complete Canonical Matrix

**Legend — Match?**

- **YES (hydrated)** — `resolveRouteSeo()` produces expected URL; `applyDocumentSeo()` sets it (per unit tests).
- **MISMATCH (static)** — Initial `index.html` / `dist/index.html` canonical is always `https://caretip.de/`.
- **GSC** — Only where evidence exists.

| Page | Expected canonical | User-declared (static HTML) | User-declared (post-hydration, code) | Google-selected | Match? | Root cause | Severity |
|------|-------------------|----------------------------|--------------------------------------|-----------------|--------|------------|----------|
| `/` | `https://caretip.de/` | `https://caretip.de/` | `https://caretip.de/` | NOT AVAILABLE | YES | Static shell matches home | NO ISSUE |
| `/features` | `https://caretip.de/features` | `https://caretip.de/` | `https://caretip.de/features` | NOT AVAILABLE | MISMATCH (static) / YES (hydrated) | Global static canonical; client override in `useEffect` | CRITICAL (static) |
| `/pricing` | `https://caretip.de/pricing` | `https://caretip.de/` | `https://caretip.de/pricing` | `https://caretip.de/faq` (GSC) | MISMATCH static; GSC vs declared | Static shell + **GSC evidence**; Google choice may reflect conflicting signals (§11) | CRITICAL |
| `/how-it-works` | `https://caretip.de/how-it-works` | `https://caretip.de/` | `https://caretip.de/how-it-works` | NOT AVAILABLE | MISMATCH (static); **content NOT VERIFIED** | Static shell + **missing route** (§9) | CRITICAL |
| `/about` | `https://caretip.de/about` | `https://caretip.de/` | `https://caretip.de/about` | NOT AVAILABLE | MISMATCH (static) / YES (hydrated) | Static shell | CRITICAL (static) |
| `/contact` | `https://caretip.de/contact` | `https://caretip.de/` | `https://caretip.de/contact` | NOT AVAILABLE | MISMATCH (static) / YES (hydrated) | Static shell | CRITICAL (static) |
| `/faq` | `https://caretip.de/faq` | `https://caretip.de/` | `https://caretip.de/faq` | NOT AVAILABLE | MISMATCH (static) / YES (hydrated) | Static shell | CRITICAL (static) |
| `/industries/*` (6 slugs) | `https://caretip.de/industries/{id}` | `https://caretip.de/` | Same path | NOT AVAILABLE | MISMATCH (static) / YES (hydrated) | Static shell | CRITICAL (static) |
| Legal (`/privacy` … `/plv`) | Matching path | `https://caretip.de/` | Matching path | NOT AVAILABLE | MISMATCH (static) / YES (hydrated) | Static shell | CRITICAL (static) |
| `/blog`, `/careers`, `/mobile-app` | N/A (noindex) | `https://caretip.de/` | Canonical URL still set; `robots: noindex,nofollow` | NOT AVAILABLE | robots correct when hydrated; static canonical still `/` | Placeholder policy + static shell | MEDIUM |

---

## 4. Affected Pages (by symptom)

### 4.1 Wrong user-declared canonical in initial HTML (homepage fallback)

**Affected:** All marketing and legal indexable routes served via SPA rewrite, including `/pricing`, `/features`, `/faq`, `/about`, `/contact`, `/how-it-works`, all `/industries/*`, and legal pages.

**Not affected (canonical in static HTML):** `/` only.

### 4.2 GSC user-declared canonical = `/` (confirmed)

**Affected:** `/pricing` (supplied GSC inspection).

**Assumed same mechanism for other deep URLs** until live GSC/HTML fetch proves otherwise — **NOT VERIFIED per URL**.

### 4.3 Google-selected canonical differs from user-declared (confirmed)

**Affected:** `/pricing` → Google selected `https://caretip.de/faq`.

### 4.4 Sitemap vs rendered experience

**Affected:** `/how-it-works` (listed in sitemap; route implementation missing).

---

## 5. Shared Root Causes

### ROOT CAUSE A — Global static homepage canonical on every SPA response

**Affected:** All non-home public SEO URLs (see §4.1).

**Reason:** `index.html` (and built `dist/index.html`) include a single hard-coded:

```html
<link rel="canonical" href="https://caretip.de/" />
```

Hosting (`vercel.json` rewrites, `public/_redirects`) serves this file for all non-static paths.

**Evidence:** `index.html` lines 18–29; `dist/index.html` identical; `testIndexHtmlStillHasStaticTagsForBootstrap()` in `scripts/seo-head-reconciliation-runtime.ts`.

---

### ROOT CAUSE B — Client-only canonical reconciliation (late head update)

**Affected:** Same as Root Cause A for any inspection pass that does not run React SEO to completion.

**Reason:**

- `CareTipRouteSeo` calls `resolveRouteSeo()` + `applyDocumentSeo()` inside **`useEffect`**, not `useLayoutEffect` or server render (`src/app/components/seo/CareTipRouteSeo.tsx`).
- `applyDocumentSeo()` **adopts** the existing unmanaged `<link rel="canonical">` and updates `href` (`documentSeo.ts` `findOrCreateManagedLink` / `upsertLink`).
- Until that runs, the static homepage canonical remains the only canonical tag.

**Post-hydration behavior:** Unit tests seed static head then `applyDocumentSeo()` → exactly **one** canonical with correct URL and `data-caretip-seo="1"`.

---

### ROOT CAUSE C — Global static homepage meta (title, description, og:url) on all URLs

**Affected:** Same routes as A.

**Reason:** `index.html` ships homepage `<title>`, `meta description`, `og:title`, `og:description`, `og:url` (`https://caretip.de/`). `applyDocumentSeo()` overwrites these when JS runs — same timing issue as canonical.

---

### ROOT CAUSE D — Identical static body copy on every URL (`#caretip-static-summary`)

**Affected:** All SPA responses until `removeStaticCrawlerSummary()` runs (`src/main.tsx` after `ensureI18nReady()`).

**Reason:** `index.html` embeds one `<main id="caretip-static-summary">` with homepage H1 and paragraphs (not route-specific). Intentional for homepage crawler readability (`scripts/seo-homepage-crawler-runtime.ts`).

**SEO impact:** Non-home URLs expose **near-duplicate primary text** in raw HTML alongside homepage canonical — a **conflicting signal** for indexing (not necessarily “duplicate implementation bug” in React).

---

### ROOT CAUSE E — `/how-it-works` routing gap

**Affected:** `/how-it-works` only (plus internal links pointing there).

**Reason:** `INDEXABLE_EXACT` and sitemap include `/how-it-works`, but `src/app/routes.tsx` has **no** `path: '/how-it-works'`. Reserved slug `how-it-works` prevents business-slug classification in `publicRoutes.ts`, yet React Router still matches `path: '/:businessSlug'` → `BusinessStaffDirectoryPage`.

**SEO layer:** `matchSeoRoute('/how-it-works')` returns `pageKey: howItWorks`, `indexable: true`.

---

### ROOT CAUSE F — Google canonical choice for `/pricing` (observation, not algorithm speculation)

**Affected:** `/pricing` (GSC only).

**Reason (evidence-based):** User-declared canonical is `/` (Root Cause A/B). Sitemap lists both `/pricing` and `/faq` as separate URLs. `/faq` has unique `FAQPage` JSON-LD (`structuredData.ts`). FAQ content references pricing (`en.json` FAQ answer mentions “pricing page”). Internal links and static summary prominently link to `/faq`. **Google-selected canonical differs from user-declared canonical** — consistent with mixed signals; **cannot attribute to a single code line without more GSC/live render data.**

---

### ROOT CAUSE G — NO IMPLEMENTATION ISSUE VERIFIED (post-hydration canonical logic)

**Affected:** Indexable routes when `applyDocumentSeo()` runs.

**Reason:** `resolveRouteSeo()` builds `canonicalUrl` from `resolveCanonicalPathname()` + `https://caretip.de` origin. Tests cover `/pricing`, `/faq`, `/features`, industries, etc.

---

## 6. Sitemap Audit

**File:** `public/sitemap.xml`  
**Sync:** `SITEMAP_PATHS` in `seoRoutes.ts` ↔ `CARETIP_SITEMAP_PATHS` in `scripts/seo-sitemap-paths.mjs` (enforced by `test:seo-remediation`).

| URL | In sitemap | Sitemap URL | Expected canonical | Match |
|-----|------------|-------------|-------------------|--------|
| `https://caretip.de/` | Yes | `https://caretip.de/` | `https://caretip.de/` | Yes |
| `https://caretip.de/features` | Yes | Same | `https://caretip.de/features` | Yes |
| `https://caretip.de/pricing` | Yes | Same | `https://caretip.de/pricing` | Yes |
| `https://caretip.de/how-it-works` | Yes | Same | `https://caretip.de/how-it-works` | Yes (sitemap); **route/content mismatch** |
| `https://caretip.de/about` | Yes | Same | `https://caretip.de/about` | Yes |
| `https://caretip.de/contact` | Yes | Same | `https://caretip.de/contact` | Yes |
| `https://caretip.de/faq` | Yes | Same | `https://caretip.de/faq` | Yes |
| Six `/industries/*` | Yes | Absolute, no trailing slash | Matching path | Yes |
| Legal URLs | Yes | Absolute | Matching path | Yes |
| `/blog`, `/careers`, `/mobile-app` | No | — | noindex placeholders | Consistent omission |

**Conflicts with canonical implementation:** Sitemap asserts **per-URL indexability**, while **initial HTML canonical** always points to `/`. That is a **sitemap vs user-declared canonical conflict** for every non-home URL in static HTML.

**Duplicates / query params / trailing slash:** None observed in sitemap. `vercel.json` sets `trailingSlash: false`.

---

## 7. Internal Link Audit

**Method:** Repository grep for `to="/…"` and static `href` in `index.html`. Counts are approximate (includes SEO route tables and strings).

| Target | Representative sources | URL form | Notes |
|--------|------------------------|----------|--------|
| `/pricing` | `Navigation.tsx`, `Footer.tsx`, `AboutPage`, `IndustryPageTemplate`, `ContactDemoForm`, static summary in `index.html` | Correct path | Reinforces `/pricing` as distinct URL |
| `/faq` | `Navigation.tsx`, `Footer.tsx`, static summary, dashboard search links | Correct path | Strong sitewide prominence |
| `/features` | Nav, Footer, static summary, `HeroNestedCardSection` | Correct | |
| `/how-it-works` | `CTASection.tsx`, `HeroNestedCardSection.tsx` | Correct path | **Destination route missing** in `routes.tsx` |
| `/about` | `Footer.tsx` | Correct | Fewer references than pricing/faq |
| `/contact` | Footer, static summary | Correct | |
| `/industries/*` | Footer, nav industry menu, static summary (gastronomy, hotels) | Correct | |

**Stale routes:** `FeaturesPageFinalCta` intentionally does **not** link to `/how-it-works` (`seo-category-p1-runtime.ts`). Static summary does **not** link `/how-it-works` (`seo-homepage-crawler-runtime.ts`).

**Canonical reinforcement:** Internal links use path-only URLs consistent with expected canonicals. They **do not** compensate for homepage canonical in static HTML.

---

## 8. Redirect / Rewrite Audit

| Mechanism | Behavior | SEO effect |
|-----------|----------|------------|
| `vercel.json` `rewrites` | Non-file paths → `/index.html` | All marketing URLs return **same** HTML shell (homepage meta) |
| `public/_redirects` | `/*` → `/index.html` 200; robots/sitemap passthrough | Same on Netlify-like hosts |
| `/dpa` | 302-style client `Navigate` → `/avv` | Canonical for `/dpa` not in sitemap (good) |
| `/industries/events` | → `/industries/fairs` | Alias not in sitemap |
| `/help` | → `/contact?intent=support` | Not indexable in SEO table |
| `/dashboard/.../subscription-plans` | → `/pricing` | App-only; disallowed in robots |
| Legacy `/business/:slug` | → `/{slug}` | Guest noindex surfaces |

**Status codes:** SPA fallback returns **200** with homepage shell — expected for CSR apps, but combines with Root Cause A.

**Trailing slash:** Disabled in Vercel config; paths normalized in `seoRoutes.ts`.

---

## 9. Content Similarity Findings

| Comparison | Finding |
|------------|---------|
| **Static HTML (`#caretip-static-summary`) vs any deep URL** | **Near-duplicate** homepage marketing copy on all responses until JS removes it. |
| `/` vs `/pricing` (React) | **Distinct** when hydrated: pricing uses `PricingHero`, plans, CTAs (`PricingPage.tsx`). |
| `/` vs `/faq` (React) | **Distinct**: accordion FAQ, `FaqPageHero`, `FAQPage` JSON-LD on `/faq` only. |
| `/pricing` vs `/faq` | **Not exact duplicates**; **topic overlap** (FAQ answers reference pricing / fees). |
| `/features` vs `/how-it-works` | Landing embeds `#how-it-works` section on `/` only; separate `/how-it-works` URL **does not serve dedicated marketing page in router**. |
| Industry pages | Distinct i18n content per `industryPages.ts` id. |
| `/plv` vs `/pricing` | Both pricing-related; separate legal/listing vs product pricing page — **distinct intent**, not verified as duplicate in GSC. |

**Do not treat shared nav/footer as duplication** — only primary content considered above.

---

## 10. Google Search Console Evidence

### 10.1 Supplied inspection: `/pricing`

| Signal | Value |
|--------|--------|
| User-declared canonical | `https://caretip.de/` |
| Google-selected canonical | `https://caretip.de/faq` |
| Sitemap URL | `https://caretip.de/pricing` (listed) |
| Expected canonical (product) | `https://caretip.de/pricing` |

**Interpretation (evidence language):**

- User-declared canonical **matches static `index.html`**, not `resolveRouteSeo('/pricing')` output — supports Root Causes A/B.
- Google-selected canonical **differs from both** user-declared (`/`) and expected (`/pricing`) — indicates **conflicting SEO signals**, not a single mis-typed pricing canonical tag in React.
- Observable contributors: static homepage canonical; identical static summary; sitemap listing both URLs; FAQ richness (JSON-LD); internal links to `/faq`; semantic overlap in FAQ copy about pricing.

### 10.2 Other URLs

**NOT AVAILABLE — GSC inspection required** for user-declared vs Google-selected on `/`, `/features`, `/faq`, `/about`, industries, etc.

---

## 11. Per-Page Technical Audit (summary)

For each indexable route, the pattern is **the same** unless noted:

### A. Initial / static HTML (`index.html`, `dist/index.html`)

| Field | Value on non-home URLs |
|-------|-------------------------|
| title | Homepage DE title |
| meta description | Homepage DE description |
| canonical | `https://caretip.de/` |
| robots | `index,follow` |
| og:url | `https://caretip.de/` |
| H1 in body | Homepage H1 inside `#caretip-static-summary` |
| JSON-LD | None in static HTML |

### B. React-rendered HTML (after `CareTipRouteSeo` `useEffect`)

| Field | Source |
|-------|--------|
| title, description, canonical, robots, OG, Twitter | `resolveRouteSeo()` + `applyDocumentSeo()` |
| JSON-LD | `buildJsonLdForRoute()` — Organization + SoftwareApplication on `/` only; FAQPage on `/faq`; breadcrumbs on industries |

### C. Duplicate canonical tags

| Phase | Count | Value |
|-------|-------|--------|
| Initial HTML | **1** | Homepage (incorrect for child routes) |
| After `applyDocumentSeo` | **1** | Route URL (tests enforce dedupe) |
| 2+ conflicting | **Not in code path** after reconciliation | — |

Classification: **0 = missing** (never after static load), **1 = incorrect** (static child routes), **1 = correct** (post-hydration), not **2+** after JS.

### D. `/how-it-works` exception

- SEO: indexable, canonical `https://caretip.de/how-it-works`.
- Router: likely `BusinessStaffDirectoryPage` for slug `how-it-works`.
- **Rendered H1/content: NOT VERIFIED** in this audit (requires live fetch).

---

## 12. Exact File-Level Findings

### 12.1 Static homepage canonical shell

| Item | Detail |
|------|--------|
| **File** | `index.html`, `dist/index.html` |
| **Component** | `<head>` static tags |
| **Current behavior** | Canonical, title, description, OG always homepage |
| **Affected routes** | All SPA-served URLs |
| **Why** | Single CSR entry; bootstrap SEO for `/` |
| **Expected behavior** | Per-route canonical in **first response** (SSR, prerender, or edge HTML per path) |
| **Recommended correction** | Prerender/SSR head per path, or remove/replace static canonical with neutral placeholder + server injection; **do not implement in this audit** |
| **Regression risks** | Homepage crawler tests (`seo-homepage-crawler`, `seo-head-reconciliation` bootstrap assertion) |
| **Tests** | Extend with per-route **initial HTML** canonical checks (§16) |

### 12.2 Client SEO manager

| Item | Detail |
|------|--------|
| **Files** | `src/app/components/seo/CareTipRouteSeo.tsx`, `src/app/lib/seo/documentSeo.ts`, `src/app/lib/seo/resolveRouteSeo.ts`, `src/app/lib/seo/seoRoutes.ts` |
| **Mount** | `RootLayout` in `src/app/routes.tsx` |
| **Current behavior** | Correct canonical in `useEffect` after hydration |
| **Why** | SPA pattern; avoids blocking paint |
| **Expected** | Same URLs, but earlier application (`useLayoutEffect`) or SSR |
| **Tests** | `scripts/seo-head-reconciliation-runtime.ts` |

### 12.3 Static crawler summary

| Item | Detail |
|------|--------|
| **Files** | `index.html` (`#caretip-static-summary`), `src/main.tsx` (`removeStaticCrawlerSummary`) |
| **Behavior** | Homepage-only body on all URLs until i18n ready |
| **Affected** | Crawlers without JS; early crawl pass |
| **Expected** | Route-specific static snippet or rely on prerender |

### 12.4 Missing `/how-it-works` route

| Item | Detail |
|------|--------|
| **Files** | `src/app/routes.tsx` (absent), `seoRoutes.ts`, `public/sitemap.xml`, `e2e/request-demo-calendly.spec.ts` (navigates to URL) |
| **Behavior** | SEO + sitemap treat as marketing page; router may serve business slug page |
| **Expected** | Dedicated lazy route (e.g. `HowItWorksPage`) or remove from sitemap/INDEXABLE_EXACT and redirect to `/#how-it-works` |

### 12.5 Hosting rewrites

| Item | Detail |
|------|--------|
| **Files** | `vercel.json`, `public/_redirects` |
| **Behavior** | 200 + `index.html` for all app paths |
| **SEO effect** | Amplifies Root Cause A — not incorrect for SPA by itself |

### 12.6 No React Helmet

**Finding:** No `react-helmet` / `Helmet` usage — single head manager (`documentSeo.ts`). Duplicate canonicals are not from dual libraries.

---

## 13. Recommended Fixes (documentation only — not implemented)

**Priority order in §15.**

1. **Per-URL initial HTML head** — SSR, SSG, or prerender so `/pricing` returns canonical `https://caretip.de/pricing` in the first byte response.
2. **Move SEO application earlier** — at minimum `useLayoutEffect` in `CareTipRouteSeo`; preferably build-time head.
3. **Route-specific static summary or remove global summary on non-home** — avoid homepage H1 on `/pricing`.
4. **Implement or delist `/how-it-works`** — align `routes.tsx`, sitemap, and internal links.
5. **GSC re-inspection** after deploy — `/pricing`, `/features`, `/faq`, one industry URL, one legal URL.
6. **Optional:** `Offer` / `Product` structured data on `/pricing` if product policy allows — only after canonical fix (not verified as required).

---

## 14. Regression Test Plan (add after fixes — not implemented)

Existing scripts to extend (names from `package.json`):

- `test:seo-head-reconciliation`
- `test:seo-remediation`
- `test:seo-homepage-crawler`
- `test:seo-category-p1`

**Checklist (new coverage suggested):**

- [ ] Every public SEO page has exactly one canonical in **built initial HTML** (or prerender artifact per route)
- [ ] Canonical matches expected route (absolute `https://caretip.de{path}`)
- [ ] No child page inherits homepage canonical in initial HTML
- [ ] No duplicate canonical tags before or after hydration
- [ ] Sitemap URLs match expected canonicals (already partially covered)
- [ ] Private pages remain `noindex,nofollow`
- [ ] Industry pages generate their own canonical
- [ ] Dynamic routes do not inherit static `index.html` canonical
- [ ] Static HTML and hydrated HTML agree on canonical for indexable routes
- [ ] `/how-it-works` returns dedicated marketing content and matching canonical (or is removed from sitemap)

Consider Playwright fetch of `document.querySelector('link[rel=canonical]')` after `networkidle` vs raw `page.content()` before JS — **no existing e2e canonical suite** in repo.

---

## 15. Deployment Verification Procedure

1. **Raw curl** (no JS): `curl -sL https://caretip.de/pricing | findstr /i canonical` — expect current state: `https://caretip.de/` until fixed.
2. **Playwright / GSC URL Inspection** — compare “View crawled page” HTML vs rendered; record user-declared and Google-selected canonical.
3. **Repeat** for `/features`, `/faq`, `/about`, `/industries/hotels`, `/how-it-works`.
4. **Sitemap** — `curl -sL https://caretip.de/sitemap.xml` matches repo list.
5. **robots.txt** — allows marketing paths; disallows app surfaces.
6. **After fix deploy** — request indexing for corrected URLs; monitor GSC canonical report for 2–4 weeks.

---

## 16. Priority Order

| P | Item | Severity |
|---|------|----------|
| P0 | Per-route canonical (and title/description) in **first HTML response** | CRITICAL |
| P0 | Resolve `/how-it-works` route vs sitemap vs SEO classification | CRITICAL |
| P1 | Route-specific or absent static summary on non-home URLs | HIGH |
| P1 | Apply document SEO before paint (`useLayoutEffect` / SSR) as interim | HIGH |
| P2 | GSC validation matrix for top marketing URLs | Operational |
| P3 | Structured data strategy for `/pricing` vs `/faq` overlap | MEDIUM (after P0) |

---

## 17. Final Answer

**Is `/pricing` isolated?**  
**No.** Repository evidence shows a **shared canonical/SEO head architecture**: static `index.html` declares the **homepage canonical and homepage meta for every public URL**, and route-specific values are applied only via **client-side `useEffect`**. The GSC **user-declared canonical `https://caretip.de/` for `/pricing`** aligns with that shared static shell, not with a pricing-only bug. **`resolveRouteSeo()` and `applyDocumentSeo()` are correct after hydration** (unit-tested), which is a different layer from what GSC reported as user-declared.

**What still requires GSC / live verification?**

- Google-selected canonical on URLs other than `/pricing`
- Whether Google’s rendered crawl sees post-hydration canonical for each route
- Live content served at `/how-it-works`
- Whether Google treats other marketing URLs as duplicates of `/`, `/faq`, or `/`

---

*End of audit. No source code, sitemap, robots.txt, routes, or metadata were modified during this investigation.*
