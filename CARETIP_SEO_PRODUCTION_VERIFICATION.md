# CareTip SEO Sprint 1 — Production Verification Audit

**Production URL:** https://caretip.de  
**Deploy host observed:** Netlify (`Server: Netlify` response headers)

### Verification passes

| Pass | Date/time (UTC) | Commit | Method |
|------|-----------------|--------|--------|
| **A — Static / HTTP** | 2026-09-25, ~10:44–10:50 | `75c24c94` | Read-only `curl.exe` (no JS) |
| **B — Client-rendered SEO (post head-reconciliation fix)** | 2026-09-25, ~13:00+ | `69d28df0` | Manual Chrome DevTools after React load |

**Code changes in this document:** None.

---

## Verification summary

| Area | Result | Notes |
|------|--------|-------|
| 1. robots.txt | **PASS** | Pass A — real `text/plain` robots file |
| 2. sitemap.xml | **PASS** | Pass A — valid XML, 19 indexable URLs |
| 3. Homepage raw HTML | **PASS** | Pass A — static product summary + head metadata present |
| 4. Public route metadata (per URL) | **PASS** | Pass B — DevTools confirms single canonical/description/robots per route after JS |
| 5. Private route noindex | **PASS** | Pass B — `/login` → single `noindex,nofollow` (duplicate static robots issue fixed) |
| 6. Unknown route / soft 404 | **PARTIAL** | Pass A — HTTP 200 SPA fallback (hosting limitation; deferred) |
| 7. Language EN/DE SEO | **PASS** (DE) / **PARTIAL** (EN) | Pass B — `/features` DE UI → DE description/title; EN locale not re-checked in this pass |
| 8. Structured data (JSON-LD) | **PASS** | Pass B — `/faq` and `/industries/gastronomy` each show exactly one JSON-LD script after JS |
| 9. Internal links (footer) | **PARTIAL** | Pass A — static summary nav; React footer not browser-confirmed |
| 10. Performance/regression | **PASS** (sanity) | No Sprint 1 perf changes; site responds normally |
| 11. Duplicate `<head>` SEO tags | **PASS** | Pass B — head-reconciliation fix (`69d28df0`) production-verified |

**Sprint 1 production-verified?** **YES (with known deferred items)** — Static crawler infrastructure, homepage raw HTML, and **client-rendered per-route SEO** are confirmed on production. Remaining gaps are hosting-level HTTP 404, optional EN-locale spot-check, footer React link, and Search Console index coverage (deferred).

---

## Pass B — Manual Chrome DevTools verification (post head-reconciliation fix)

**Context:** Pass A found that raw HTTP returns the same SPA shell for all routes. A follow-up forensic audit identified duplicate `<head>` tags (static `index.html` bootstrap + managed `data-caretip-seo` tags). Fix deployed in `69d28df0`. Pass B confirms rendered `<head>` after React load.

**Method:** Chrome DevTools → Console / Elements on live production URLs after page load.

### `/features` (DE UI)

| Check | Result |
|-------|--------|
| `document.querySelectorAll('link[rel="canonical"]').length` | **1** |
| `document.querySelector('link[rel="canonical"]')?.href` | **`https://caretip.de/features`** |
| `document.querySelectorAll('meta[name="description"]').length` | **1** |
| `document.querySelector('meta[name="description"]')?.content` | **Matches active DE locale** (`seo.pages.features` — not static homepage DE text) |
| `document.querySelector('meta[name="robots"]')?.content` | **`index,follow`** |
| `document.title` | **Route-specific title confirmed** (Features / Funktionen per active locale) |

**Result: PASS**

### `/login`

| Check | Result |
|-------|--------|
| `document.querySelectorAll('meta[name="robots"]').length` | **1** |
| `document.querySelector('meta[name="robots"]')?.content` | **`noindex,nofollow`** |

Static `index.html` `index,follow` no longer competes as a first robots tag after React.

**Result: PASS**

### `/faq`

| Check | Result |
|-------|--------|
| Canonical count | **1** |
| Canonical href | **`https://caretip.de/faq`** |
| Description count | **1** |
| `meta[name="robots"]` | **`index,follow`** |
| JSON-LD script count (`script[type="application/ld+json"]` or managed `data-caretip-seo="jsonld"`) | **1** |

**Result: PASS**

### `/industries/gastronomy`

| Check | Result |
|-------|--------|
| Canonical count | **1** |
| Canonical href | **`https://caretip.de/industries/gastronomy`** |
| Description count | **1** |
| `document.title` | **Route-specific industry title confirmed** |
| Robots count | **1** |
| `meta[name="robots"]` | **`index,follow`** |
| JSON-LD script count | **1** |

**Result: PASS**

### Duplicate `<head>` tag regression (fix confirmation)

| Before `69d28df0` | After `69d28df0` (Pass B) |
|-------------------|---------------------------|
| Two canonical links on `/features` (static `/` + managed `/features`) | **Single canonical per route** |
| Two description metas (static homepage DE + managed route copy) | **Single description per route** |
| Two robots metas on `/login` (static `index,follow` + managed `noindex`) | **Single robots on private routes** |

**Result: PASS — production-verified fixed**

---

## Pass A — Static / HTTP verification (`75c24c94`)

*Sections below document the initial curl-based pass. Pass B supersedes Pass A conclusions for client-rendered SEO where noted.*

---

## 1. robots.txt

| Check | Result |
|-------|--------|
| URL | `GET https://caretip.de/robots.txt` |
| HTTP status | **200 OK** |
| Content-Type | **`text/plain; charset=UTF-8`** |
| Body is real robots.txt | **Yes** — not HTML |
| SPA index.html served | **No** |

**Evidence (first lines):**
```
User-agent: *
Allow: /

Disallow: /dashboard/
Disallow: /employee/
Disallow: /platform-admin/
...
Sitemap: https://caretip.de/sitemap.xml
```

**Directive alignment:** Matches Sprint 1 intent — allows public crawl, disallows private/auth/payment/QR/demo prefixes, declares sitemap. **Does not replace `noindex` meta** (correct).

**Result: PASS**

---

## 2. sitemap.xml

| Check | Result |
|-------|--------|
| URL | `GET https://caretip.de/sitemap.xml` |
| HTTP status | **200 OK** |
| Content-Type | **`application/xml`** |
| Valid XML | **Yes** (`<?xml version="1.0"?>`, `<urlset>`) |
| SPA index.html served | **No** |
| Absolute HTTPS URLs | **Yes** — all `https://caretip.de/...` |
| URL count | **19** |

**Included (intentionally indexable):**
`/`, `/features`, `/pricing`, `/how-it-works`, `/about`, `/contact`, `/faq`, six `/industries/*`, `/privacy`, `/terms`, `/cookies`, `/imprint`, `/avv`, `/plv`

**Excluded (confirmed absent from sitemap):**
`/login`, `/signup`, `/auth`, `/dashboard/*`, `/employee/*`, `/platform-admin/*`, `/payment`, `/qr/*`, `/qr-landing/*`, `/blog`, `/careers`, `/mobile-app`

**Result: PASS**

---

## 3. Homepage raw HTML (`GET /`)

| Check | Result |
|-------|--------|
| HTTP status | **200** |
| Content-Type | `text/html; charset=UTF-8` |
| Content-Length | **9763 bytes** |
| Loading-only shell | **No** — meaningful static content present |

**Confirmed in raw HTML:**

| Element | Present | Value / note |
|---------|---------|--------------|
| Product summary | **Yes** | `#caretip-static-summary` with DE + EN paragraphs |
| H1 | **Yes** | `CareTip — Digitale Trinkgeld-Plattform` |
| Digital tipping platform intent | **Yes** | DE: “digitale Trinkgeld-Plattform”; EN: “digital tipping platform” |
| `<title>` | **Yes** | `CareTip — Digitale Trinkgeld-Plattform für Gastgewerbe` |
| Meta description | **Yes** | DE platform description |
| Canonical | **Yes** | `https://caretip.de/` |
| `robots` | **Yes** | `index,follow` |
| `og:title` | **Yes** | `CareTip — Digitale Trinkgeld-Plattform` |
| `og:description` | **Yes** | DE platform description |
| `og:url` | **Yes** | `https://caretip.de/` |
| `og:type` | **Yes** | `website` |
| `og:site_name` | **Yes** | `CareTip` |
| `og:image` | **Yes** | **Absolute** `https://caretip.de/brand/caretip-logo-tagline.png` |
| Twitter card | **Yes** | `summary_large_image` + title/description/image |
| Boot overlay still present | **Yes** | `#caretip-html-boot` “Einen Moment bitte…” (expected; removed after JS) |
| Empty `#root` | **Yes** | Expected SPA shell |

**Also in static summary nav:** links to `/features`, `/pricing`, `/how-it-works`, `/faq`, `/contact`.

**After JS (Pass B):** Homepage canonical remains `https://caretip.de/` with a single reconciled tag (no duplicate).

**Result: PASS**

---

## 4. Public route metadata

### Pass A (curl, no JS)

| Route | HTTP | Raw `<title>` | Route-specific meta in raw HTML? |
|-------|------|---------------|----------------------------------|
| `/` | 200 | Homepage DE title | **Yes** (static defaults) |
| `/features` | 200 | Same as `/` | **No** — identical SPA shell |
| `/pricing` | 200 | Same as `/` | **No** |
| `/how-it-works` | 200 | Same as `/` | **No** |
| `/faq` | 200 | Same as `/` | **No** |
| `/industries/gastronomy` | 200 | Same as `/` | **No** |

**Evidence:** `/`, `/features`, and `/dashboard` all return **9763 bytes** — same `index.html` payload.

**Pass A result: PARTIAL** (expected SPA limitation for raw HTTP).

### Pass B (Chrome DevTools, after JS — `69d28df0`)

| Route | Canonical | Description | Robots | Title | JSON-LD |
|-------|-----------|-------------|--------|-------|---------|
| `/features` | **1** → `/features` | **1** (DE when UI DE) | `index,follow` | Route-specific ✓ | — |
| `/faq` | **1** → `/faq` | **1** | `index,follow` | — | **1** |
| `/industries/gastronomy` | **1** → `/industries/gastronomy` | **1** | **1** → `index,follow` | Route-specific ✓ | **1** |

**Pass B result: PASS** — Per-route canonical, description, robots, and titles are correct in rendered DOM. Duplicate static/managed head tags are resolved.

**Note:** Raw HTTP still returns homepage defaults on deep links (unchanged SPA hosting behavior). Googlebot and other JS-capable crawlers see Pass B values.

---

## 5. Private / auth routes

### Pass A (curl, no JS)

| Route | HTTP | Raw `robots` in HTML | Raw title |
|-------|------|----------------------|-----------|
| `/login` | 200 | `index,follow` | Homepage DE title |
| `/signup` | 200 | (same shell) | (same) |
| `/dashboard` | 200 | `index,follow` | Homepage DE title |
| `/employee` | 200 | (same shell) | (same) |
| `/platform-admin` | 200 | (same shell) | (same) |

**Pass A result: PARTIAL** — `noindex` not visible in raw HTML.

### Pass B (Chrome DevTools)

| Route | Robots count | `meta[name="robots"]` |
|-------|--------------|------------------------|
| `/login` | **1** | **`noindex,nofollow`** |

**Pass B result: PASS** for `/login`. `/dashboard` and `/employee` not re-checked in Pass B but share the same `CareTipRouteSeo` path; `/login` confirms private-route robots reconciliation works in production.

**robots.txt Disallow** remains a crawl hint; **meta noindex** is now confirmed in rendered DOM for `/login`.

---

## 6. Unknown route

| Check | Result |
|-------|--------|
| URL | `GET https://caretip.de/nonexistent-page-xyz-99999` |
| HTTP status | **200** |
| SPA fallback | **Yes** — same 9763-byte `index.html` |
| Raw `robots` | `index,follow` (homepage default) |
| Application `noindex` after JS | **Expected** for slug-like unknown paths — **not verified in Pass B** |

**Soft-404 limitation:** **Still present** — no true HTTP 404 from Netlify SPA hosting.

**Result: PARTIAL** (deferred)

---

## 7. Language behavior (EN / DE)

| Check | Result |
|-------|--------|
| SEO metadata follows active UI language | **PASS (DE)** — Pass B on `/features` with DE UI: single description matches DE `seo.pages.features` |
| EN UI on `/features` | **Not re-checked in Pass B** (pre-fix EN title was correct; description was wrong due to duplicate tags — now fixed in code) |
| Canonical strips `?lang=` | **Implemented in code**; `/faq` canonical verified as `/faq` in Pass B |
| Missing i18n keys | **Not observed** |

**Result: PASS (DE verified) / PARTIAL (EN spot-check deferred)**

---

## 8. Structured data (JSON-LD)

| Route | Raw HTML (Pass A) | After JS (Pass B) |
|-------|-------------------|-------------------|
| `/` | Absent | Not counted in Pass B |
| `/faq` | Absent | **1 JSON-LD script** ✓ |
| `/industries/gastronomy` | Absent | **1 JSON-LD script** ✓ |

No malformed JSON-LD observed in Pass B sample routes.

**Result: PASS** (Pass B sample routes)

---

## 9. Internal links — `/how-it-works`

| Location | Verified | Evidence |
|----------|----------|----------|
| Static crawler summary (`#caretip-static-summary`) | **Yes** | `<a href="/how-it-works">So funktioniert es</a>` in raw `/` HTML |
| React site footer | **Not verified** | Requires JS render; implemented in `Footer.tsx` |

**Result: PARTIAL**

---

## 10. Performance / regression sanity

| Check | Result |
|-------|--------|
| Site responds | **Yes** — 200 on `/`, assets reachable |
| Sprint 1 perf changes | **None** in commit |
| Calendly in initial HTML | **Absent** (lazy on click — unchanged) |
| Boot overlay | **Still present** pre-JS (by design) |
| Auth/dashboard code touched | **No** functional auth changes |

**Result: PASS** (limited HTTP sanity only; not a Core Web Vitals retest)

---

## Remaining issues / deferred

1. **Per-route SEO metadata only after JavaScript** — Pass B confirms correct rendered `<head>` for sampled routes; plain HTTP/AI fetchers still see homepage defaults on deep links (SPA limitation).
2. **HTTP soft 404** — all unknown paths return 200 (deferred; hosting constraint).
3. **Google Search Console index coverage** — not verified in this audit (deferred).
4. **EN locale SEO spot-check on production** — DE verified on `/features`; EN not re-run in Pass B.
5. **React footer `/how-it-works` link** — not browser-confirmed.
6. **Private routes beyond `/login`** — `/dashboard`, `/employee` robots not DevTools-checked in Pass B (low risk given shared SEO layer + `/login` pass).

**Resolved since Pass A:**
- ~~Duplicate `<head>` canonical/description/robots/OG tags~~ — **fixed and production-verified (`69d28df0`)**
- ~~Client-rendered per-route metadata unconfirmed~~ — **confirmed on `/features`, `/faq`, `/industries/gastronomy`**
- ~~Private `noindex` unconfirmed in browser~~ — **confirmed on `/login`**

---

## Can Sprint 1 be considered production-verified?

| Layer | Verified on production? |
|-------|-------------------------|
| robots.txt | **Yes** (Pass A) |
| sitemap.xml | **Yes** (Pass A) |
| Homepage crawler/static HTML | **Yes** (Pass A) |
| Netlify static file routing fix | **Yes** (Pass A) |
| Per-route metadata (after JS) | **Yes** (Pass B — sample routes) |
| Private route `noindex` (after JS) | **Yes** (Pass B — `/login`) |
| JSON-LD (after JS) | **Yes** (Pass B — `/faq`, `/industries/gastronomy`) |
| Duplicate head tag fix | **Yes** (Pass B) |
| Footer React link | **Deployed, not live-browser-confirmed** |
| HTTP 404 / GSC indexing | **Deferred** |

**Overall: PRODUCTION-VERIFIED** for Sprint 1 SEO deliverables and head-reconciliation fix, with deferred hosting/GSC/footer items noted above.

---

## Executive summary

### 1. What is confirmed working

- Production `https://caretip.de/robots.txt` is valid plain text with correct Allow/Disallow rules and sitemap URL.
- Production `https://caretip.de/sitemap.xml` is valid XML with 19 absolute `https://caretip.de` indexable URLs and no private/auth/payment/QR URLs.
- Homepage raw HTML includes meaningful CareTip product copy (DE + EN), H1, digital tipping platform messaging, canonical, title, description, and complete OG/Twitter tags with **absolute** image URL.
- Static HTML includes crawlable nav links including `/how-it-works`.
- **After head-reconciliation fix (`69d28df0`), Chrome DevTools confirms:**
  - **`/features`:** single canonical `https://caretip.de/features`, single DE description (DE UI), `index,follow`, route-specific title.
  - **`/login`:** single `noindex,nofollow` robots meta.
  - **`/faq`:** single canonical `/faq`, single description, `index,follow`, one JSON-LD script.
  - **`/industries/gastronomy`:** single canonical, single description, route-specific title, `index,follow`, one JSON-LD script.
- **Duplicate `<head>` SEO tag issue is production-verified fixed.**

### 2. What failed

- **No hard failures** on verified checks (Pass A static deliverables + Pass B client-rendered SEO sample).

### 3. What remains deferred

- True HTTP 404 for unknown URLs
- Google Search Console index coverage / ranking outcomes
- hreflang / language-specific URLs
- Blog/careers/mobile-app indexing policy
- Full browser CWV retest
- EN-locale production spot-check on `/features` (DE verified)
- React footer `/how-it-works` link (static summary link confirmed)

### 4. Issues requiring another implementation sprint (if desired)

| Priority | Item | Why |
|----------|------|-----|
| Optional P2 | Prerender or SSR for public routes | Per-route meta/JSON-LD in first HTML response for non-JS clients |
| Optional P2 | Edge 404 or `noindex` in static HTML for private paths | Raw HTTP privacy for non-JS clients |
| Optional P3 | Automated production SEO smoke test (Playwright in CI) | Repeatable verification of rendered `<head>` |

**No new sprint required** for robots, sitemap, homepage static summary, client-rendered route SEO, or head-reconciliation — **production-verified PASS**.

---

*Read-only audit documentation update. No application code was modified.*
