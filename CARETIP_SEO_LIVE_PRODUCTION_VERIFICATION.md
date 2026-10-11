# CareTip SEO — live production verification

**Date:** 2026-09-27 (evening UTC+1)  
**Method:** HTTP GET to production URLs with a static user-agent (no JavaScript execution).  
**Host evidence:** `Server: Netlify`, `Cache-Control: public,max-age=0,must-revalidate` on HTML responses.

**No code or configuration was changed for this audit.**

---

## Executive summary

| Question | Finding |
|----------|---------|
| Is live HTML the new prerender? | **Yes** — route-specific title, description, canonical, `og:url`, and `#caretip-static-summary` H1 on `/pricing`, `/features`, `/faq`. |
| Is `/pricing` still the homepage shell? | **No** — canonical is `https://caretip.de/pricing`, not `/`. |
| Why does GSC still show old `/pricing` canonical? | **GSC last crawl: 2025-09-25** — **before** prerender deploy (2025-09-27). Report reflects **historical** fetch, not current HTML. |
| Why is `/features` “unknown to Google”? | **Discovery/indexing lag** — live HTML is correct and in `sitemap.xml`; “unknown” ≠ wrong production HTML. |

**Production diagnosis:** **A. Production is serving the new prerendered HTML correctly.**

Not B (old shell), not C (missing dist on host — prerender is live), not D (rewrites are not overriding static `pricing/index.html` on Netlify), not E as primary cause (HTML is `max-age=0,must-revalidate`; GSC staleness is crawl date).

---

## Hosting configuration (repository)

| File | Role |
|------|------|
| `netlify.toml` | `command = npm run build`, `publish = dist` — matches live **Netlify** headers. |
| `public/_redirects` | `robots.txt` / `sitemap.xml` explicit 200; `/*` → `/index.html` 200 **SPA fallback**. |
| `vercel.json` | Present for Vercel-style deploys; **not** what serves `caretip.de` today (live `Server: Netlify`). |

**Netlify behavior:** Static files such as `dist/pricing/index.html` are served **before** the `/*` → `/index.html` rewrite. Live `/pricing` content proves prerendered files are deployed and selected.

---

## URL-by-URL results

### HTML pages

| URL | Status | Final URL | Title | Canonical | og:url | robots | Static H1 | Distinct from `/`? |
|-----|--------|-----------|-------|-----------|--------|--------|-----------|-------------------|
| `https://caretip.de/` | 200 | `https://caretip.de/` | CareTip - Digitale Trinkgeld-Plattform für Gastgewerbe | `https://caretip.de/` | `https://caretip.de/` | index,follow | CareTip - Digitale Trinkgeld-Plattform | — |
| `https://caretip.de/pricing` | 200 | `https://caretip.de/pricing/` | Preise - CareTip | **`https://caretip.de/pricing`** | **`https://caretip.de/pricing`** | index,follow | Preise - CareTip | **Yes** |
| `https://caretip.de/features` | 200 | `https://caretip.de/features/` | Funktionen - CareTip Trinkgeld-Plattform | **`https://caretip.de/features`** | **`https://caretip.de/features`** | index,follow | Funktionen - CareTip Trinkgeld-Plattform | **Yes** |
| `https://caretip.de/faq` | 200 | `https://caretip.de/faq/` | FAQ - Digitales Trinkgeld mit CareTip | **`https://caretip.de/faq`** | **`https://caretip.de/faq`** | index,follow | FAQ - Digitales Trinkgeld mit CareTip | **Yes** |
| `https://caretip.de/industries/hotels` | 200 | `https://caretip.de/industries/hotels/` | Digitales Trinkgeld für Hotels - CareTip | `https://caretip.de/industries/hotels` | same | index,follow | Digitales Trinkgeld für Hotels - CareTip | **Yes** |

**Canonical count:** 1 per HTML page checked.

**Trailing slash:** Netlify redirects bare paths to trailing-slash URLs; **canonical and og:url use no trailing slash** (matches prerender design).

---

### `https://caretip.de/sitemap.xml`

- **Status:** 200  
- **URL count:** 18 `<loc>` entries  
- **lastmod:** 2026-09-27 on entries sampled  
- **Includes:** `/`, `/features`, `/pricing`, `/faq`, industries, legal — **no** `/how-it-works`

---

### `https://caretip.de/robots.txt`

- **Status:** 200  
- **Allow:** `/`  
- **Disallow:** dashboard, auth, tip flows, `/qr/`, etc.  
- **Sitemap:** `https://caretip.de/sitemap.xml`

---

## Raw-response evidence (critical pages)

### `/pricing` — head (live, pre-JS)

```html
<meta name="description" content="Transparente Preise für die digitale Trinkgeld-Plattform CareTip." />
<meta name="robots" content="index,follow" />
<link rel="canonical" href="https://caretip.de/pricing" />
<meta property="og:title" content="Preise - CareTip" />
<meta property="og:description" content="Transparente Preise für die digitale Trinkgeld-Plattform CareTip." />
<meta property="og:url" content="https://caretip.de/pricing" />
<title>Preise - CareTip</title>
```

**Static summary (live body, pre-JS):**

```html
<main id="caretip-static-summary" lang="de">
  <h1>Preise - CareTip</h1>
  <p>Transparente Preise für die digitale Trinkgeld-Plattform CareTip.</p>
</main>
```

**Contrast with `/` (same fetch method):** homepage `canonical` = `https://caretip.de/`, title = `CareTip - Digitale Trinkgeld-Plattform für Gastgewerbe`, homepage marketing description — **not** interchangeable with `/pricing`.

---

### `/features` — head (live, pre-JS)

```html
<meta name="description" content="Funktionen der CareTip Plattform: QR-Trinkgeld, Mitarbeiter-Dashboards, Analysen und sichere Stripe-Auszahlungen." />
<meta name="robots" content="index,follow" />
<link rel="canonical" href="https://caretip.de/features" />
<meta property="og:title" content="Funktionen - CareTip Trinkgeld-Plattform" />
<meta property="og:url" content="https://caretip.de/features" />
<title>Funktionen - CareTip Trinkgeld-Plattform</title>
```

**Static summary:**

```html
<main id="caretip-static-summary" lang="de">
  <h1>Funktionen - CareTip Trinkgeld-Plattform</h1>
  <p>Funktionen der CareTip Plattform: QR-Trinkgeld, Mitarbeiter-Dashboards, Analysen und sichere Stripe-Auszahlungen.</p>
</main>
```

---

### `/faq` — head (live, pre-JS)

```html
<meta name="description" content="Antworten zu CareTip, digitalem Trinkgeld, QR-Codes und Auszahlungen." />
<meta name="robots" content="index,follow" />
<link rel="canonical" href="https://caretip.de/faq" />
<meta property="og:title" content="FAQ - Digitales Trinkgeld mit CareTip" />
<meta property="og:url" content="https://caretip.de/faq" />
<title>FAQ - Digitales Trinkgeld mit CareTip</title>
```

**Static summary:**

```html
<main id="caretip-static-summary" lang="de">
  <h1>FAQ - Digitales Trinkgeld mit CareTip</h1>
  <p>Antworten zu CareTip, digitalem Trinkgeld, QR-Codes und Auszahlungen.</p>
</main>
```

**JSON-LD:** Live `/faq` includes `FAQPage` schema in raw HTML (in addition to static summary).

---

## GSC vs live production

| GSC observation | Live production (2026-09-27) | Interpretation |
|-----------------|------------------------------|----------------|
| `/pricing` user-declared `https://caretip.de/` | User-declared in HTML: `https://caretip.de/pricing` | **Stale GSC crawl** (last: 2025-09-25) |
| Google-selected `https://caretip.de/faq` | `/pricing` canonical does not point to `/faq` | Historical grouping / old homepage shell era; **re-crawl needed** |
| `/features` unknown to Google | Correct HTML + in sitemap | **Indexing/discovery**, not deploy failure |

**Recommended ops (no code):** In Search Console, use **URL Inspection → Test live URL** on `/pricing` and `/features`, then **Request indexing**. Allow days–weeks for canonical and coverage reports to refresh.

---

## Diagnosis matrix

| Code | Verdict | Evidence |
|------|---------|----------|
| **A** | **TRUE** | Self-referencing canonicals; route-specific prerender content on Netlify |
| B | FALSE | `/pricing` ≠ homepage title/canonical/H1 |
| C | FALSE | Prerender visible at edge |
| D | FALSE | Static path served (not only root `index.html`) |
| E | Secondary only | CDN uses short revalidate; GSC date predates fix |
| F | — | GSC lag / index discovery for `/features` |

---

## FINAL STATUS

# LIVE PRODUCTION SEO VERIFIED
