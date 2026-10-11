# CareTip SEO — live redirect forensic audit

**Date:** 2026-09-27 (evening UTC)  
**Method:** Raw HTTP via `curl` (no browser, no JavaScript). User-Agent: `Googlebot/2.1` and Google smartphone bot string where noted.  
**Scope:** Read-only — no code, config, or deployment changes.

---

## Executive summary

| Finding | Evidence |
|---------|----------|
| Redirect loop on `/features`, `/pricing`, `/faq`? | **No** — reproduced chains end in **HTTP 200** after **at most one** HTTPS hop. |
| Who adds trailing slash? | **Netlify platform** — **301** from bare path → `/{path}/` when `dist/{path}/index.html` exists. **Not** declared in `public/_redirects`. |
| Is prerender HTML served? | **Yes** — after following the slash redirect, body has route-specific title, canonical, and `#caretip-static-summary` H1. |
| Sitemap vs final URL vs canonical | **Mismatch (slash):** sitemap + canonical **without** trailing slash; **final URL after redirect has** trailing slash. |
| GSC “Redirect error” on `/features` (2026-09-27 19:38:46)? | **Not reproduced** at audit time (~18:55–19:00 UTC). Current chain is a **valid single 301**, not a loop. Likely **transient deploy window** or **stale/failed fetch**; **recrawl** after stable deploy. |

**Deployment vs SEO code:** Prerender **code and files are correct** when served. Behavior is **hosting (Netlify directory slash normalization)**, not a broken prerender build.

---

## 1. Live redirect chains (raw HTTP)

### Core URLs (Googlebot/2.1)

| Request URL | 1st response | `Location` | 2nd response | Final URL | Redirect count | Loop? |
|-------------|--------------|------------|--------------|-----------|----------------|-------|
| `https://caretip.de/` | **200** | — | — | `https://caretip.de/` | 0 | No |
| `https://caretip.de/features` | **301** | `/features/` (relative) | **200** | `https://caretip.de/features/` | 1 | No |
| `https://caretip.de/features/` | **200** | — | — | `https://caretip.de/features/` | 0 | No |
| `https://caretip.de/pricing` | **301** | `/pricing/` | **200** | `https://caretip.de/pricing/` | 1 | No |
| `https://caretip.de/pricing/` | **200** | — | — | `https://caretip.de/pricing/` | 0 | No |
| `https://caretip.de/faq` | **301** | `/faq/` | **200** | `https://caretip.de/faq/` | 1 | No |
| `https://caretip.de/faq/` | **200** | — | — | `https://caretip.de/faq/` | 0 | No |

**Redirect type:** **301 Moved Permanently** (Netlify).  
**Slash vs non-slash:** Non-slash variants **always** take one 301 to trailing-slash; slash variants **do not** redirect again.

### HTTP / host variants (`/features`)

| Request URL | Chain (summary) | Final | Redirects |
|-------------|-----------------|-------|-----------|
| `http://caretip.de/features` | 301 → `https://caretip.de/features` → 301 → `/features/` | `https://caretip.de/features/` | 2 |
| `http://www.caretip.de/features` | HTTP→HTTPS + host canonicalization + slash | `https://caretip.de/features/` | **3** |
| `https://www.caretip.de/features` | www → apex + slash | `https://caretip.de/features/` | 2 |

All complete with **200** and **no loop**.

### Google smartphone bot (Android Googlebot UA)

`https://caretip.de/features` → **1 redirect** → `https://caretip.de/features/` → **200**.

### HEAD vs GET

`HEAD` and `GET` on `https://caretip.de/features` both return **301** with `Location: /features/` (same as GET).

---

## 2. Source of the trailing-slash redirect

| Source | In repo? | Verdict |
|--------|----------|---------|
| `public/_redirects` | Only `/* → /index.html` **200** (SPA fallback), robots/sitemap passthrough | **Does not** define slash 301 |
| `netlify.toml` (repo) | `publish = dist`, `npm run build` only | **No** slash rules |
| `vercel.json` | `"trailingSlash": false` | **Not used** for `caretip.de` (live `Server: Netlify`) |
| React Router | Client-side only | **Not** involved in first HTTP response |
| **Netlify static hosting** | Serves `dist/features/index.html` as a **directory** | **301** bare `/features` → `/features/` |

**Conclusion:** **PLATFORM-GENERATED — NOT VERIFIED IN REPOSITORY** as an explicit rule file. Standard Netlify behavior when prerender emits `features/index.html`, `pricing/index.html`, etc.

---

## 3. Redirect loops

Tested explicitly:

- `/features` → `/features/` → **stops (200)**
- `/features/` → **no further redirect**
- Same pattern for `/pricing`, `/faq`, and all other prerendered marketing paths sampled.

**No redirect loop** observed on production at audit time.

---

## 4. Local `dist` vs production

| Item | Local workspace | Production |
|------|-----------------|------------|
| `dist/features/index.html` | **Not present** (local `dist` removed after build; not required for live audit) | **Present** (inferred from route-specific HTML + stable ETag on `/features/`) |
| Intended file layout | `dist/{path}/index.html` per `scripts/prerender-public-seo-html.ts` | Matches Netlify directory serving |
| Canonical in HTML | Designed: `https://caretip.de/features` (no slash) | **Confirmed live** on `https://caretip.de/features/` body |

**Does `/features` serve prerender without redirect?** **No** — Netlify responds **301** first.  
**Does `/features/` serve the prerender file?** **Yes** — not the homepage shell (title/canonical/H1 are Features-specific).

**Contrast homepage vs pricing (live on slash URL):**

- `/pricing/` canonical: `https://caretip.de/pricing` — not `https://caretip.de/`
- `/pricing/` H1: `Preise — CareTip` — not homepage H1

**SPA fallback:** `public/_redirects` `/* /index.html 200` applies only when **no** static file matches. Prerendered directories **win** over the catch-all.

---

## 5. Sitemap vs redirects

| Source | URL format for `/features` |
|--------|----------------------------|
| `CARETIP_SITEMAP_PATHS` / `seo-sitemap-paths.mjs` | `/features` (no trailing slash) |
| `public/sitemap.xml` (live) | `https://caretip.de/features` |
| `dist/sitemap.xml` (when built) | Same generator — no slash |
| `seoRoutes.ts` `normalizePathname` | Strips trailing slash for canonical paths |

**Sitemap URLs do not include trailing slashes** (except root `https://caretip.de/`).

**After crawl:** Google requests sitemap URL → **one 301** → trailing-slash URL → **200** + HTML canonical **without** slash.

This is a **URL shape mismatch** (sitemap/canonical vs browser address bar), not a missing prerender file.

---

## 6. Sitemap / canonical / final URL consistency

| Route | Sitemap `<loc>` | Canonical (live HTML on slash URL) | Final HTTP URL (after redirects) | Consistent? |
|-------|-----------------|-------------------------------------|----------------------------------|-------------|
| `/features` | `https://caretip.de/features` | `https://caretip.de/features` | `https://caretip.de/features/` | **Partial** — one 301; canonical matches sitemap, **not** final bar URL |
| `/pricing` | `https://caretip.de/pricing` | `https://caretip.de/pricing` | `https://caretip.de/pricing/` | **Partial** (same) |
| `/faq` | `https://caretip.de/faq` | `https://caretip.de/faq` | `https://caretip.de/faq/` | **Partial** (same) |
| `/industries/hotels` | `https://caretip.de/industries/hotels` | `https://caretip.de/industries/hotels` | `https://caretip.de/industries/hotels/` | **Partial** (same) |
| `/` | `https://caretip.de/` | `https://caretip.de/` | `https://caretip.de/` | **Yes** |

---

## 7. Google “Redirect error” analysis (ranked by evidence)

| Hypothesis | Evidence | Likelihood for GSC 19:38 crawl |
|------------|----------|--------------------------------|
| **Redirect loop** | Not reproduced; slash URL returns 200 | **Low** (now) |
| **Excessive redirects (>10)** | Max 3 (http+www entry); HTTPS sitemap URL → 1 | **Low** |
| **Trailing-slash 301 alone** | Valid single 301; Googlebot smartphone succeeds | **Low** as sole cause |
| **Deploy / build instability** | Netlify build failed earlier 2026-09-27; fix `46400a35` pushed; GSC crawl **same evening** | **Medium–high** (transient) |
| **Relative `Location: /features/`** | RFC-valid; curl + Googlebot UA follow correctly | **Low** |
| **Prerender missing → wrong routing** | Would be 200 SPA shell or 404, not typical “redirect error” | **Medium** only during bad deploy |
| **www / HTTP mixed signals** | Normal 301 chains to apex HTTPS | **Low** |
| **CDN stale redirect** | Current `Cache-Control: max-age=0,must-revalidate` on HTML | **Low** now |

**Important:** A **single 301** from sitemap URL to trailing-slash URL is **normal** and **not** equivalent to a “redirect error” in typical Google crawling. The GSC message more often indicates **loop**, **unreachable target**, or **failed fetch after redirect** — **none of which reproduce** on the live site at audit time.

**Canonical on slash URL still declares non-slash** — Google usually respects `link rel="canonical"`; this does **not** by itself explain “redirect error.”

---

## 8. All 18 SEO routes (HTTPS, no trailing slash on request)

Pattern for **every** path below except `/`:

**Request** `https://caretip.de{path}` → **301** → `https://caretip.de{path}/` → **200** + route-specific prerender HTML.

| Path | Redirect? | Final URL | Status | Route-specific HTML | Canonical (in HTML) |
|------|-----------|-----------|--------|---------------------|---------------------|
| `/` | No | `https://caretip.de/` | 200 | Homepage | `https://caretip.de/` |
| `/features` | Yes (1) | `.../features/` | 200 | Yes | `https://caretip.de/features` |
| `/pricing` | Yes (1) | `.../pricing/` | 200 | Yes | `https://caretip.de/pricing` |
| `/about` | Yes (1) | `.../about/` | 200 | Yes | `https://caretip.de/about` |
| `/contact` | Yes (1) | `.../contact/` | 200 | Yes | `https://caretip.de/contact` |
| `/faq` | Yes (1) | `.../faq/` | 200 | Yes | `https://caretip.de/faq` |
| `/industries/gastronomy` | Yes (1) | `.../gastronomy/` | 200 | Yes | `https://caretip.de/industries/gastronomy` |
| `/industries/hotels` | Yes (1) | `.../hotels/` | 200 | Yes | `https://caretip.de/industries/hotels` |
| `/industries/logistics` | Yes (1) | `.../logistics/` | 200 | Yes | (same pattern) |
| `/industries/midwives` | Yes (1) | `.../midwives/` | 200 | Yes | (same pattern) |
| `/industries/fairs` | Yes (1) | `.../fairs/` | 200 | Yes | (same pattern) |
| `/industries/field-service` | Yes (1) | `.../field-service/` | 200 | Yes | (same pattern) |
| `/privacy` | Yes (1) | `.../privacy/` | 200 | Yes | (same pattern) |
| `/terms` | Yes (1) | `.../terms/` | 200 | Yes | (same pattern) |
| `/cookies` | Yes (1) | `.../cookies/` | 200 | Yes | (same pattern) |
| `/imprint` | Yes (1) | `.../imprint/` | 200 | Yes | (same pattern) |
| `/avv` | Yes (1) | `.../avv/` | 200 | Yes | (same pattern) |
| `/plv` | Yes (1) | `.../plv/` | 200 | Yes | (same pattern) |

**Scope of issue:** **ALL prerendered directory routes** share the same Netlify slash 301. **Not** isolated to `/features`. **Not** a broken single route.

**Note:** `https://caretip.de/features/index.html` returns **200** without redirect (direct file URL).

---

## 9. Google Search Console evidence (recorded)

### `/features`

- Last crawl: **2026-09-27 19:38:46** (user report)
- Googlebot smartphone
- Crawl allowed: Yes
- Page fetch: **Failed — Redirect error**
- Indexing allowed: N/A
- Canonical: N/A

### `/pricing` (historical — pre-prerender crawl)

- Last successful crawl shown: **2026-09-25 15:59:02**
- Page fetch: Successful
- User canonical: `https://caretip.de/` (old shell)
- Google canonical: `https://caretip.de/faq`

**Do not** use 2025-09-25 `/pricing` signals as proof of current HTML or redirects.

---

## 10. Raw-response evidence snippets

### `/pricing` — first hop (no follow)

```http
HTTP/1.1 301 Moved Permanently
Location: /pricing/
Server: Netlify
```

### `/pricing/` — 200 body (excerpt)

```html
<link rel="canonical" href="https://caretip.de/pricing" />
<meta property="og:url" content="https://caretip.de/pricing" />
<title>Preise - CareTip</title>
<h1>Preise - CareTip</h1>
```

### `/features/` — 200 body (excerpt)

```html
<link rel="canonical" href="https://caretip.de/features" />
<meta property="og:url" content="https://caretip.de/features" />
<title>Funktionen - CareTip Trinkgeld-Plattform</title>
<h1>Funktionen - CareTip Trinkgeld-Plattform</h1>
```

### `/faq/` — 200 body (excerpt)

```html
<link rel="canonical" href="https://caretip.de/faq" />
<meta property="og:url" content="https://caretip.de/faq" />
<title>FAQ - Digitales Trinkgeld mit CareTip</title>
<h1>FAQ - Digitales Trinkgeld mit CareTip</h1>
```

---

## A–J (required sections)

### A. Exact redirect chains

Documented in §1 and §8. **No loops.** Bare HTTPS paths: **one 301** to trailing slash, then **200**.

### B. Source of each redirect

- **HTTPS → trailing slash:** Netlify (platform), driven by `dist/{route}/index.html` layout.
- **HTTP → HTTPS:** Netlify.
- **www → apex:** Netlify (observed on `www.caretip.de`).

### C. Local dist vs production

Prerender layout matches production serving; local `dist` not on disk at audit time. Production serves correct per-route HTML at slash URLs.

### D. Sitemap / canonical / final URL

Sitemap and canonical **agree** (no slash). Final address bar URL **has** slash after 301. See §6.

### E. Googlebot redirect-error analysis

**Not reproducible** on live site after stable deploy. **Benign single 301** does not explain persistent redirect errors. **Deploy timing** same day is the strongest explanatory factor for a **one-off** GSC failure.

### F. Prerendered HTML actually served?

**Yes**, on final slash URL (and on direct `.../index.html`).

### G. Deployment problem or SEO code problem?

**Primarily hosting URL normalization (Netlify)**, not prerender logic. **Optional** SEO hygiene: align slash policy across sitemap, redirects, and canonical (future change). **Not** evidence that prerender failed to deploy.

### H. Exact minimal correction required (when you choose to fix — not done in this audit)

1. **Preferred (platform):** Netlify site settings / `netlify.toml` — serve directory indexes **without** forcing trailing-slash 301 (if available for your plan), **or** accept slash and align sitemap + canonical to trailing-slash URLs.
2. **Alternative:** Explicit `_redirects` / Netlify redirects with **absolute** `Location` URLs (still one hop).
3. **Do not** remove prerender; it is working.

**Trailing slash alone:** **No evidence** it causes redirect errors **now**; it **does** create sitemap vs final-URL divergence.

### I. Should current build remain deployed?

**Yes.** Live HTML is correct; redirects are stable and non-looping.

### J. Should GSC reinspection be delayed?

**Short delay (24–48 h)** after last successful Netlify deploy, then **URL Inspection → Test live URL** on `https://caretip.de/features` and **Request indexing**. If live test shows **200** and correct canonical, reinspect **should not** be delayed further. GSC reporting may lag **days** after a failed crawl.

---

## Diagnosis code (requested)

| Code | Applies? |
|------|----------|
| **A** Production serving new prerender | **Yes** (on final slash URL) |
| **B** Old SPA-only shell | **No** |
| **C** Dist not deployed | **No** (evidence: route-specific files) |
| **D** Rewrite bypassing prerender | **No** — static directory wins over `/* → index.html` |
| **E** CDN stale HTML | **Unlikely** (`max-age=0`) |
| **F** Other | GSC failure **likely transient** (deploy evening); slash 301 is **expected Netlify**, not a loop |

---

## FINAL STATUS

# LIVE SEO ROUTING VERIFIED — GOOGLE RECRAWL REQUIRED
