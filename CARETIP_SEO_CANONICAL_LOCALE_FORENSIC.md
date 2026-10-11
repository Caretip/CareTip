# CareTip SEO — Canonical & Locale Forensic Report

**Date:** 2026-09-25  
**Scope:** Read-only investigation of live production behavior on `https://caretip.de/features` (Chrome DevTools, post-React)  
**Sprint context:** SEO Remediation Sprint 1 (`75c24c94`)  
**Constraints:** No code changes; no SSR/SSG; no hreflang; no broad refactor

---

## Executive summary

Production DevTools findings on `/features` are **not** caused by broken pathname canonical logic or a locale mismatch in `CareTipRouteSeo`. The pathname resolver and i18n wiring are correct. The observed symptoms come from **duplicate `<head>` tags**: Sprint 1 added static homepage SEO tags in `index.html` while `applyDocumentSeo()` only updates tags marked `data-caretip-seo`, appending second (correct) tags without removing or overwriting the static ones. `document.querySelector()` returns the **first** (static, homepage, German) tag; `document.title` works because it is set directly on the document object.

---

## Production observations (user verification)

| Signal | Observed on `/features` (EN UI) | Expected | Verdict |
|--------|----------------------------------|----------|---------|
| `document.title` | `Features — CareTip digital tipping platform` | EN features title | **Correct** — `CareTipRouteSeo` + `t()` active |
| `meta[name="description"]` | German homepage text (`…Gastgewerbe…`) | EN features description | **Wrong tag read** — static `index.html` tag wins |
| `link[rel="canonical"]` | `https://caretip.de/` | `https://caretip.de/features` | **Wrong tag read** — static homepage canonical wins |
| `meta[name="robots"]` | `index,follow` | `index,follow` for `/features` | **Appears correct** — static and managed agree on public pages |

---

## A. Canonical generation

### A.1 Trace: `CareTipRouteSeo` → canonical URL

```
CareTipRouteSeo (useLocation + useTranslation)
  → resolveRouteSeo(pathname, search, t)
      → matchSeoRoute(pathname)           // e.g. pageKey "features", pathname "/features"
      → resolveCanonicalPathname(path, search)  // strips lang, contact intent/plan, faq q
      → canonicalUrl()                      // https://caretip.de + canonical path
  → applyDocumentSeo(seo)
      → upsertLink("canonical", seo.canonicalUrl)
```

**Source of pathname:** React Router `useLocation().pathname` and `.search` — not `window.location` directly, but equivalent for normal in-app navigation and direct loads.

**`resolveCanonicalPathname()` behavior** (`src/app/lib/seo/seoRoutes.ts`):

| Input | Output | Notes |
|-------|--------|-------|
| `/features`, `""` | `/features` | No query stripping needed |
| `/pricing`, `""` | `/pricing` | |
| `/how-it-works`, `""` | `/how-it-works` | |
| `/faq`, `?q=tips&lang=en` | `/faq` | Strips `q`, `lang` |
| `/contact`, `?intent=demo&lang=de` | `/contact` | Strips `intent`, `plan`, `lang` |
| `/industries/gastronomy`, `""` | `/industries/gastronomy` | |
| `/`, `?lang=en` | `/` | Only `lang` stripped |

**Conclusion:** Pathname resolution does **not** reduce every path to `/`. Query stripping is limited to the keys above and is working as designed. Unit coverage exists in `scripts/seo-remediation-runtime.ts` for `/faq` and `/contact`.

For `/features`, `resolveRouteSeo` produces `canonicalUrl: "https://caretip.de/features"` (origin from `getAppPublicBaseUrl()` / default `https://caretip.de`).

### A.2 Actual failure: duplicate canonical `<link>` elements

**Static shell** (`index.html`, lines 22–23) — no `data-caretip-seo`:

```html
<meta name="robots" content="index,follow" />
<link rel="canonical" href="https://caretip.de/" />
```

**Managed upsert** (`src/app/lib/seo/documentSeo.ts`):

```ts
let el = document.head.querySelector<HTMLLinkElement>(`link[data-caretip-seo][rel="canonical"]`);
if (!el) {
  el = document.createElement("link");
  el.setAttribute("data-caretip-seo", "1");
  el.setAttribute("rel", "canonical");
  document.head.appendChild(el);  // appended AFTER static tag
}
el.setAttribute("href", seo.canonicalUrl);
```

On first `applyDocumentSeo` run:

1. No `link[data-caretip-seo][rel="canonical"]` exists.
2. A **new** link is **appended** with `href="https://caretip.de/features"` (correct).
3. The static `<link rel="canonical" href="https://caretip.de/">` **remains unchanged** earlier in `<head>`.

**Why DevTools shows homepage canonical:**

```js
document.querySelector('link[rel="canonical"]')  // first match = static homepage
```

**Confirm in production (recommended):**

```js
document.querySelectorAll('link[rel="canonical"]').length
// Expected today: 2

document.querySelector('link[data-caretip-seo][rel="canonical"]')?.href
// Expected on /features: "https://caretip.de/features"
```

The Sprint 1 report’s pathname-specific canonical **logic** is implemented correctly; the **DOM application layer** does not reconcile with pre-existing static tags, so the user-visible (first) canonical is wrong on all non-home routes.

### A.3 Affected routes

Any route served by the same `index.html` SPA shell where the managed canonical differs from `https://caretip.de/`:

| Route group | Static canonical (first) | Managed canonical (second, if JS runs) | User/DevTools impact |
|-------------|--------------------------|----------------------------------------|----------------------|
| `/` | `https://caretip.de/` | `https://caretip.de/` | **No conflict** (duplicate but consistent) |
| `/features` | `/` | `/features` | **Wrong first tag** |
| `/pricing` | `/` | `/pricing` | **Wrong first tag** |
| `/how-it-works` | `/` | `/how-it-works` | **Wrong first tag** |
| `/faq` | `/` | `/faq` (query stripped) | **Wrong first tag** |
| `/about` | `/` | `/about` | **Wrong first tag** |
| `/contact` | `/` | `/contact` (intent/plan stripped) | **Wrong first tag** |
| `/industries/*` | `/` | `/industries/{id}` | **Wrong first tag** |
| Legal (`/privacy`, `/terms`, `/cookies`, `/imprint`, `/avv`, `/plv`) | `/` | matching path | **Wrong first tag** |
| Placeholder (`/blog`, `/careers`, `/mobile-app`) | `/` | matching path + `noindex` on managed robots | Canonical wrong; robots may conflict (see C.3) |
| Private (`/login`, `/dashboard`, …) | `/` | current path + `noindex` on managed robots | Canonical wrong; robots conflict risk |

**Not affected by pathname logic bugs** — only by duplicate-tag DOM behavior.

### A.4 Why `/features` resolves to the homepage canonical

1. Every client route receives the same built `index.html`.
2. That file hard-codes `<link rel="canonical" href="https://caretip.de/" />` for crawler/no-JS bootstrap (homepage DE SEO).
3. After React loads, `CareTipRouteSeo` adds a **second** canonical pointing to `/features`.
4. Standard `querySelector('link[rel="canonical"]')` returns the **first** element — the static homepage link.

This is **not** client-side navigation failing to update canonical; it is **never updating the static tag** and **not removing duplicates**.

### A.5 Google-facing SEO impact

**Material — yes, for non-home marketing URLs.**

- Google generally honors `<link rel="canonical">` for deduplication. Multiple canonicals to different URLs are an explicit conflict; Google may ignore both, pick unpredictably, or consolidate signals to the homepage.
- Sitemap lists `https://caretip.de/features` while the first canonical in DOM says `https://caretip.de/` — **sitemap vs canonical disagreement** weakens URL consolidation for subpages.
- Googlebot often executes JavaScript on CareTip-class SPAs, so it may see **both** tags; first-document-order and heuristics apply — outcome is not reliably `/features`.
- Homepage `/` is unaffected for canonical (both tags agree).
- `og:url` has the same duplicate pattern (`index.html` `og:url` = `/`, managed = route URL), affecting social crawlers similarly.

**Severity:** High for indexable marketing subpages (`/features`, `/pricing`, industries, etc.); low for homepage.

---

## B. Language / SEO metadata

### B.1 How locale is determined

| Layer | Mechanism | Default |
|-------|-----------|---------|
| Boot | `ensureI18nReady()` → `readDocumentOrStoredLanguage()` | **`de`** (matches `boot-locale.js` / storage) |
| Runtime | `changeAppLanguage()` / user language switcher | `en` or `de` |
| `CareTipRouteSeo` | `resolveAppLanguageFromCode(i18n.language)` | Follows active i18n |
| `document.documentElement.lang` | Set in `CareTipRouteSeo` effect to `language` | Matches active UI language |

SEO copy keys: `seo.pages.{pageKey}.title` / `.description` (and `seo.industries.*` for industry pages), all via the same `t()` from `useTranslation()` as title.

**EN features copy** (`src/i18n/locales/en.json`):

- Title: `Features — CareTip digital tipping platform`
- Description: `Explore CareTip's digital tipping platform: QR tipping pages, employee dashboards, business analytics, and secure Stripe payouts.`

**DE features copy** (`src/i18n/locales/de.json`):

- Title: `Funktionen — CareTip Trinkgeld-Plattform`
- Description: `Funktionen der CareTip Plattform: QR-Trinkgeld, Mitarbeiter-Dashboards, Analysen und sichere Stripe-Auszahlungen.`

### B.2 Why EN UI shows DE meta description in DevTools

The observed German string:

> CareTip ist die digitale Trinkgeld-Plattform für Gastgewerbe: QR-Trinkgeld, Mitarbeiter-Verwaltung und sichere Auszahlungen.

matches **`index.html` line 19–20** exactly — the static bootstrap meta. It is **not** `seo.pages.features.description` from either locale bundle, and it is **not** `seo.pages.home.description` from `de.json` (which uses “Restaurants, Hotels und Service-Teams” wording).

**Why title is EN but description looks DE:**

| Field | Update mechanism | Result with EN UI |
|-------|------------------|-------------------|
| Title | `document.title = seo.title` (overwrites property) | **EN** — correct |
| Description | `upsertMeta` appends `meta[data-caretip-seo][name="description"]` | **EN on second tag**; `querySelector` reads **first static DE** tag |

Same duplicate pattern affects:

- `meta[property="og:title"]`, `og:description`, `og:url`
- `meta[name="twitter:title"]`, `twitter:description`

**JSON-LD:** `buildJsonLdForRoute(match, t)` uses the same `t()` — injected scripts use `data-caretip-seo="jsonld"` and replace prior managed blocks; static JSON-LD is not in `index.html`, so JSON-LD likely reflects **active locale** when inspected via `script[data-caretip-seo="jsonld"]`.

### B.3 Expected behavior (CareTip i18n architecture)

Per Sprint 1 design and i18n architecture:

- **SEO metadata should follow the active UI language** — single `t()` source in `resolveRouteSeo`, same as visible copy.
- **Default locale is `de`** for first-time visitors without stored preference; that applies to initial shell HTML and boot, not to a deliberate “always DE meta on EN UI” policy.
- **Same URL for EN/DE** (no hreflang in scope).

### B.4 Bug or intentional?

| Symptom | Classification |
|---------|----------------|
| EN title + DE description on EN UI | **Bug** — duplicate meta tags, not intentional bilingual meta |
| Static `index.html` DE for no-JS/crawler bootstrap | **Intentional** for raw HTTP / pre-JS |
| Failure to replace static tags after React SEO runs | **Bug** — bootstrap tags should be superseded on managed routes |

---

## C. Scope / regression

### C.1 Pre–Sprint 1 vs Sprint 1

| Aspect | Before Sprint 1 (`92d9ac9e`) | After Sprint 1 (`75c24c94`) |
|--------|------------------------------|-----------------------------|
| `CareTipRouteSeo` | **Absent** | Present in `RootLayout` |
| Static `<link rel="canonical">` | **Absent** | `https://caretip.de/` |
| Static `meta robots` | **Absent** | `index,follow` |
| Static description | EN generic one-liner | DE homepage sentence |
| Per-route canonical in DOM | N/A (no canonical) | Logic correct; **duplicate tags** |
| `/features` canonical in DevTools | `null` / no tag | **Homepage URL (wrong)** |

**Verdict:** The duplicate-tag canonical regression was **introduced by Sprint 1**, pairing new static homepage SEO in `index.html` with `applyDocumentSeo()` selectors that only touch `[data-caretip-seo]` elements. The underlying mistake is architectural (bootstrap + managed head coexistence), not a regression in `resolveCanonicalPathname()`.

### C.2 Homepage canonical

- Static: `https://caretip.de/` ✓  
- Managed after React: `https://caretip.de/` ✓  
- `querySelector('link[rel="canonical"]')` ✓ (first tag is correct)  
- Duplicate links may still exist; no user-visible error on `/`.

### C.3 Private-route `noindex` — latent duplicate-tag risk

Static shell always includes:

```html
<meta name="robots" content="index,follow" />
```

Managed layer sets `meta[data-caretip-seo][name="robots"]` to `noindex,nofollow` on private routes.

On `/login`, `/dashboard`, etc.:

```js
document.querySelector('meta[name="robots"]')?.content
// Likely "index,follow" (static first) — same class of bug
```

Sprint 1 classifier logic (`matchSeoRoute` → `indexable: false`) and `resolveRouteSeo` robots override are **correct in code**. **DevTools and any crawler that reads only the first robots meta may see the wrong directive.** This was not part of the user’s `/features` check but shares the same root cause and should be verified on `/login` after any fix.

`removeStaticCrawlerSummary()` removes only `#caretip-static-summary`; it does **not** remove static SEO meta/canonical/OG tags.

---

## 1. Exact root cause — canonical

**Duplicate `<link rel="canonical">` in `<head>`:** static homepage canonical from `index.html` is never updated or removed; `applyDocumentSeo()` appends a second, correct, `data-caretip-seo` canonical. `document.querySelector('link[rel="canonical"]')` returns the static homepage URL.

**Not root cause:** `resolveCanonicalPathname()`, React Router pathname, or query stripping reducing paths to `/`.

---

## 2. Exact affected routes

All SPA routes except homepage canonical alignment:

- **Marketing:** `/features`, `/pricing`, `/how-it-works`, `/faq`, `/about`, `/contact`
- **Industries:** `/industries/gastronomy`, `/hotels`, `/logistics`, `/midwives`, `/fairs`, `/field-service`
- **Legal:** `/privacy`, `/terms`, `/cookies`, `/imprint`, `/avv`, `/plv`
- **Placeholder:** `/blog`, `/careers`, `/mobile-app` (also `noindex` conflict risk)
- **Private/auth/transactional:** wrong canonical; possible `robots` conflict

**Unaffected for canonical correctness:** `/` (homepage).

---

## 3. Why `/features` shows homepage canonical

Static `index.html` hard-codes `href="https://caretip.de/"` as the first canonical. Managed SEO writes the correct `/features` URL to a second link that standard selectors do not return first.

---

## 4. Material Google SEO impact

**Yes** — conflicting canonicals and description/OG signals on indexable subpages; sitemap URLs disagree with first canonical. Homepage OK. Private routes may incorrectly signal `index,follow` via first robots meta.

---

## 5. Exact root cause — EN/DE metadata mismatch

**Duplicate `meta[name="description"]` (and OG/Twitter twins):** static German homepage description in `index.html` remains first in document order; managed EN description from `t('seo.pages.features.description')` is on a second tag. Title uses `document.title` and therefore reflects EN correctly.

**Not root cause:** CareTip default locale alone, or `CareTipRouteSeo` reading a different locale than the UI.

---

## 6. Language mismatch — bug or intentional?

**Bug** (duplicate tags). Intended design: SEO strings follow active i18n via `t()`. Static DE in `index.html` is intentional only for no-JS/raw HTML bootstrap, not for post-React EN sessions.

---

## 7. Recommended minimal fix

Preserve Sprint 1 architecture (`CareTipRouteSeo`, `resolveRouteSeo`, `seoRoutes`, static summary). **Only fix DOM reconciliation.**

**Option A (preferred):** In `applyDocumentSeo()`, before or during upsert, **remove or update unmanaged duplicates** for tags CareTip owns:

- `link[rel="canonical"]:not([data-caretip-seo])`
- `meta[name="description"]:not([data-caretip-seo])`
- `meta[name="robots"]:not([data-caretip-seo])`
- `meta[property^="og:"]:not([data-caretip-seo])`
- `meta[name^="twitter:"]:not([data-caretip-seo])`

Then upsert managed tags as today.

**Option B:** Remove managed-overlapping SEO tags from `index.html` (keep `#caretip-static-summary`, title/description for no-JS if desired); let `CareTipRouteSeo` own head tags after boot. Accept weaker no-JS meta on deep links unless prerender snippet is extended.

**Option C:** Add `data-caretip-seo="1"` to static tags in `index.html` and change upsert selectors to match by `rel`/`name`/`property` **without** requiring the attribute on lookup (update in place if an unmanaged tag exists).

**Do not:** SSR/SSG, hreflang, redesign route SEO resolution, or change `resolveCanonicalPathname()` (logic is already correct).

---

## 8. Recommended regression tests

Current `npm run test:seo-remediation` validates route classification and canonical **pathname strings** only — **not DOM behavior**.

Add tests that would have caught this:

1. **`applyDocumentSeo` DOM integration (jsdom/happy-dom):**
   - Seed `<head>` with static canonical/description/robots/OG matching `index.html`.
   - Call `applyDocumentSeo(resolveRouteSeo('/features', '', tEn))`.
   - Assert `document.querySelectorAll('link[rel="canonical"]').length === 1`.
   - Assert `document.querySelector('link[rel="canonical"]')?.href === 'https://caretip.de/features'`.
   - Assert `document.querySelector('meta[name="description"]')?.content` equals EN features description.

2. **Locale parity:** Same test with `tDe` on `/features` — description matches DE features key.

3. **Private route robots:** After `applyDocumentSeo` for `/login`, assert single `meta[name="robots"]` with `noindex,nofollow` via `querySelector` (not only managed selector).

4. **Homepage:** `/` leaves exactly one canonical `https://caretip.de/`.

5. **Query stripping + DOM:** `/faq?q=x&lang=en` → canonical href ends with `/faq` only.

6. **Optional production smoke:** Document DevTools checks using `querySelector` (first tag) **and** `querySelectorAll` length after deploy.

---

## Key file references

| File | Role in finding |
|------|-----------------|
| `index.html` | Static DE description, canonical `/`, robots `index,follow`, OG/Twitter homepage |
| `src/app/lib/seo/documentSeo.ts` | Upsert only `[data-caretip-seo]`; appends duplicates |
| `src/app/lib/seo/resolveRouteSeo.ts` | Correct `canonicalUrl` from pathname + `t()` |
| `src/app/lib/seo/seoRoutes.ts` | `resolveCanonicalPathname()` — correct |
| `src/app/components/seo/CareTipRouteSeo.tsx` | React Router + i18n → `applyDocumentSeo` |
| `scripts/seo-remediation-runtime.ts` | No DOM/canonical href assertions |

---

## Verification checklist (post-fix, no implementation in this sprint)

```js
// On https://caretip.de/features with EN UI
document.querySelectorAll('link[rel="canonical"]').length === 1
document.querySelector('link[rel="canonical"]')?.href === 'https://caretip.de/features'
document.querySelector('meta[name="description"]')?.content
  // EN features sentence, not Gastgewerbe homepage static text

// On https://caretip.de/login
document.querySelector('meta[name="robots"]')?.content === 'noindex,nofollow'

// On https://caretip.de/
document.querySelector('link[rel="canonical"]')?.href === 'https://caretip.de/'
```

---

**Status:** Investigation complete. **No code changes made.**
