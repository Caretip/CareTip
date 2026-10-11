# CareTip Production Performance Audit

## 1. Executive Summary

Production was measured in headless Chrome against `https://caretip.de` on 8 October 2026. The server is not the bottleneck. The HTML document is about 12 KB, HTTP/2, and time to first byte is about 230–250 ms once the connection exists. What users wait on is client startup, and on several marketing URLs a full-screen loader that stays up after the page is already in the DOM.

The worst measured user-facing problems:

- **FAQ is not clickable for more than 10.6 seconds.** After `https://caretip.de/faq` redirects to `https://caretip.de/faq/`, a fixed overlay (`.app-setup-loading`) was still intercepting clicks at 10.6 s. The first FAQ button never expanded. The homepage did not do this: its overlay was gone in about 1.0 s and the mobile menu opened.
- **Layout shift is poor on every public page measured, including warm loads.** Desktop homepage CLS **0.31**. Mobile homepage CLS **0.69**. FAQ CLS **1.00**. The first shift is attributed to `DIV#root`. Cached reloads stay in the same range, so this is not a network problem.
- **Desktop homepage LCP is 5.7 s** on a cold load. The LCP element is the hero photo (`wyc` AVIF). That file had already been preloaded in about 0.8 s. LCP lands at the end of the JavaScript startup tasks, not at the end of the image download.
- **The same heavy files download on pages that do not show them.** `vendor-three` (~259 KB transferred) and `vendor-recharts` (~105 KB) download on the homepage, FAQ, legal pages, blog, login, and logged-out dashboard redirects. Homepage and industry images (including a 276 KB AVIF and a 156 KB hotel WebP) also download on `/login` and `/faq`.

Warm loads are fast: homepage second view was FCP **348 ms**, LCP **932 ms**, DOMContentLoaded **386 ms**. Hashed assets are cached for a year. Marketing pages load **no third-party analytics**. Google and Facebook scripts appear on `/login` and `/signup` only.

Authenticated employee, business, and platform-admin dashboards were **not measured**. No approved test credentials were used, and production secrets were not read. Logged-out visits to `/dashboard`, `/employee`, and `/admin` only show the redirect to the matching login screen.

## 2. Test Environment

| Item | Value |
| --- | --- |
| Production URL | `https://caretip.de` |
| Browser | Google Chrome **155.0.8059.39**, headless, driven by Playwright 1.61.1 |
| Operating system | Windows 10.0.22000 |
| Desktop viewport | 1440×900, device scale 1, locale `de-DE` |
| Mobile viewport | 390×844, device scale 2, touch emulation, locale `de-DE`. This is Chrome emulation, not a physical phone |
| Network | Unthrottled local connection. No bandwidth cap was applied to the primary runs |
| Extra profile | One homepage run used Chrome DevTools Slow 4G (1.6 Mbps down, 750 Kbps up, 150 ms latency) plus 4× CPU. That run did not finish hydrating. See section 4.6 |
| Cache | Cold = new browser context (empty HTTP cache, no service worker). Warm = second navigation in the same context |
| Service worker | `navigator.serviceWorker.controller` was false on cold loads |
| Authenticated | No |
| Clock | Cold homepage started **2026-10-08T15:56:44Z**. Interaction and extra routes followed in the same session, through about 16:06Z |
| Firefox | **NOT MEASURED.** Firefox is not installed on this machine |
| Safari | **NOT MEASURED.** This machine is Windows |

Field CrUX / RUM (real-user INP, field LCP) was **NOT MEASURED**. Figures below are lab measurements from this Chrome session.

## 3. Methodology

1. A fresh headless Chrome context opened `https://caretip.de/` and recorded navigation timing, paint timing, LCP, CLS, long tasks, long-animation frames, and CDP transfer sizes.
2. The homepage was scrolled to the bottom. A second load in the same context recorded the warm path.
3. `http://caretip.de/` and `https://www.caretip.de/` were loaded to count redirects.
4. Public links were taken from the rendered homepage, then checked against `https://caretip.de/sitemap.xml` (HTTP 200, 18 URLs). Each important route was loaded cold, then warm.
5. Clicks were attempted on FAQ, language, theme, cookie reject, and the mobile menu. Loader presence was polled.
6. Logged-out `/dashboard`, `/employee`, `/admin`, and `/platform-admin` were opened only to see where they redirect. No form was submitted.
7. After the numbers existed, source was read to explain the loader, the shared landing prefetch, and the empty `#root`. Source was not used to invent a slowness claim.

Transfer totals are CDP `encodedDataLength` rounded to KB (1024 bytes). They include compressed bytes on the wire. Cookie and authorization headers were not recorded.

## 4. Phase 1 — Public Marketing Experience

### 4.1 URL Entry

Cold `https://caretip.de/` — desktop, empty cache.

| Metric | Value |
| --- | --- |
| Redirects | 0. Final URL `https://caretip.de/` |
| DNS | 147 ms |
| TCP | 377 ms |
| TLS | 146 ms |
| TTFB | 242 ms |
| Document download after TTFB | 2 ms |
| Document transferred / decoded | 3,527 / 12,363 bytes |
| Protocol | h2 |
| First paint / FCP | 2,700 ms |
| LCP | **5,700 ms** |
| LCP element | `IMG` “Telefon mit CareTip QR Code und Trinkgeldbildschirm”, URL `/assets/wyc-BZgFR-fM.avif`, rendered area about 1,126,080 px² (1440×782) |
| CLS before scroll | **0.308** |
| DOMContentLoaded | 3,181 ms |
| load event | 3,189 ms |
| Requests | 124 |
| Transferred | about 2.8 MB |
| JavaScript | about 1.1 MB |
| CSS | about 161 KB |
| Images | about 1.4 MB |
| Fonts | about 199 KB |
| Third-party bytes | 0 |
| Long tasks | 7, longest 285 ms, sum 1,061 ms |
| Chrome `ScriptDuration` | 601 ms |
| DOM nodes at settle | 722 |
| Service worker | no |

The largest long-animation frame on this load was **1,422 ms** (blocking duration 222 ms), attributed to React `MessagePort.onmessage` in `vendor-react`. A later frame of 313 ms on the www load attributed **264 ms** to evaluating `index-DtR_onsJ.js`.

`https://www.caretip.de/` does one redirect to `https://caretip.de/`. Navigation timing hid that hop (cross-origin); Playwright recorded the chain. Cold result after the redirect: TTFB 340 ms, FCP 2,044 ms, LCP 4,260 ms, CLS 0.312, 97 requests, about 2.8 MB.

`http://caretip.de/` does one redirect to `https://caretip.de/`. Cold result: TTFB 241 ms, FCP 1,844 ms, LCP 4,044 ms, CLS 0.312, 125 requests, about 2.9 MB.

Warm `https://caretip.de/` in the same context: TTFB 124 ms, DNS/TCP/TLS 0, FCP **348 ms**, LCP **932 ms**, CLS **0.306**, DOMContentLoaded 386 ms. The document is fast when assets are cached. The layout shift remains.

HTML for `/` is 12,332 bytes, `#root` is empty, and `#caretip-static-summary` is in the body. There is no preload of `vendor-three` in the HTML. The hero preload is the `wyc` AVIF for viewports from 768 px up, and `formemobile01` AVIF below that.

### 4.2 Homepage

What the visitor actually gets, top to bottom:

- A fixed boot overlay (`#caretip-html-boot`) covers the viewport until React starts.
- The hero is two eager 3840×2560 AVIF frames (`wyc` and `wyo`) shown at 1440×782 on desktop. `wyc` is `fetchpriority=high`. `wyo` is also `loading=eager`. There is no `<video>`.
- Industry stills (hotel, logistics, bar, midwife, trades, events) are eager and about 1200 px wide, shown near 395×380.
- Customer-journey and onboarding screenshots are eager, including 1080×1920 step images shown at 432×768, and a 1086×1448 hotel WebP shown at 246×328.
- Small stock photos lower on the page are `loading=lazy` and shown around 30–34 px wide, from sources 384–512 px wide.
- Scrolling the full page (height 8,259 px) added **12** resources and **3** long tasks. CLS moved from 0.308 to **0.337**. Nodes grew from 722 to 937. Most image bytes were already requested before the scroll.

LCP is JavaScript-bound. The `wyc` preload completed in about **801 ms** (resource timing). LCP was recorded at **5,700 ms**, in the same window as the last long task (start 5,692 ms, duration 72 ms). Shrinking the file would save bytes. It would not, by itself, move LCP from 5.7 s to the preload time, because the `<img>` is not in the initial HTML.

CLS sources on this load:

| Shift | Start | Sources |
| --- | --- | --- |
| 0.244 | 3,812 ms | `DIV#root` |
| 0.063 | 5,746 ms | `H1`, `P`, `DIV` |

`#root` is styled `min-height: 100vh`, but `#caretip-static-summary` sits in normal flow *above* `#root`. The boot overlay is `position: fixed`, so it hides the summary visually and does not remove it from layout. `main.tsx` removes `#caretip-static-summary` immediately before `createRoot().render()`. That matches a shift of `#root` at the moment React starts. Classification: **PROVEN** that `#root` shifts at startup on every measured template. **LIKELY** that removing the in-flow summary is the 0.244 portion. The later 0.063 shift on the heading is a separate, smaller paint.

### 4.3 Marketing Sections

Observed on the homepage and on the linked section pages:

- Header: “Menü öffnen”, “Sprache”, “Branchen”, “Design”.
- Cookie bar: “Nicht notwendige ablehnen” and “Alle akzeptieren”. Reject dismissed in about 0.5 s of wall time on FAQ (the button is outside the blocking overlay).
- No chat widget, no analytics script, no font request to Google or Adobe on the marketing pages.
- Both `de-*.js` (~112 KB) and `en-*.js` (~106 KB) downloaded on the German homepage. The active locale has to load. The second locale is prefetched from the landing module (see 4.9).
- `GET https://caretip.onrender.com/health` appears on the homepage and on the other public routes. Resource duration was about **500–800 ms** (examples: 783 ms, 706 ms, 585 ms, 514 ms). `transferSize` in resource timing was 0, which is normal for a cross-origin request without timing-allow headers. HTTP status was **NOT MEASURED**. It is started from `wakeRemoteApi()` after a deferred timer (900 ms desktop, 3.5 s mobile in source), and it did not sit on the document critical path. It is a real extra request, not the reason FCP is 2.7 s.

### 4.4 Public Routes

Cold desktop, new context each time, about 2–2.5 s settle after `load`. “Slash” means the browser was redirected to a trailing slash (one hop).

| Route | Final | FCP | LCP | CLS | DCL | Requests | Transferred | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | `/` | 2,700 ms | 5,700 ms | 0.308 | 3,181 ms | 124 | 2.8 MB | Worst LCP |
| `/features` | `/features/` | 1,836 ms | 1,968 ms | 0.443 | 2,845 ms | 119 | 2.6 MB | `three` + hero images |
| `/industries/hotels` | slash | 1,788 ms | 4,588 ms | 0.403 | 2,953 ms | 122 | 2.6 MB | |
| `/industries/logistics` | slash | 1,704 ms | 4,172 ms | 0.398 | 2,585 ms | 122 | 2.6 MB | |
| `/industries/gastronomy` | slash | 1,708 ms | 3,624 ms | 0.378 | 2,387 ms | 122 | 2.6 MB | |
| `/industries/midwives` | slash | 1,840 ms | 4,856 ms | 0.422 | 2,897 ms | 122 | 2.6 MB | |
| `/industries/field-service` | slash | 1,956 ms | 4,820 ms | 0.380 | 3,068 ms | 122 | 2.6 MB | |
| `/industries/fairs` | slash | 1,712 ms | 4,248 ms | 0.422 | 2,733 ms | 122 | 2.6 MB | |
| `/pricing` | `/pricing/` | 1,776 ms | 1,876 ms | 0.331 | 2,320 ms | 117 | 2.6 MB | |
| `/faq` | `/faq/` | 1,772 ms | 1,892 ms | **1.000** | 3,146 ms | 117 | 2.6 MB | Redirect cost **739 ms**. Loader still up at 10.6 s |
| `/contact` | `/contact/` | 1,840 ms | 4,556 ms | 0.247 | 2,858 ms | 117 | 2.6 MB | |
| `/about` | `/about/` | 2,032 ms | 3,684 ms | 0.589 | 2,708 ms | 117 | 2.6 MB | |
| `/privacy` | `/privacy/` | 2,108 ms | 4,724 ms | 0.589 | 3,232 ms | 122 | 2.6 MB | Second shift 0.482 on `FOOTER` |
| `/terms` | `/terms/` | 2,192 ms | 4,640 ms | 0.589 | 3,219 ms | 121 | 2.6 MB | Second shift 0.482 on `FOOTER` |
| `/avv` | `/avv/` | 2,000 ms | 4,232 ms | 0.112 | 3,054 ms | 121 | 2.6 MB | |
| `/plv` | `/plv/` | 1,788 ms | 3,288 ms | 0.112 | 2,323 ms | 121 | 2.6 MB | |
| `/cookies` | `/cookies/` | 1,880 ms | NOT MEASURED this pass | NOT MEASURED this pass | 2,501 ms | 114 | NOT MEASURED this pass | `three` and `recharts` still loaded. TTFB 229 ms |
| `/imprint` | `/imprint/` | 1,768 ms | NOT MEASURED this pass | NOT MEASURED this pass | 2,315 ms | 116 | NOT MEASURED this pass | Same |
| `/blog` | `/blog` | 1,408 ms | NOT MEASURED this pass | NOT MEASURED this pass | 1,952 ms | 115 | NOT MEASURED this pass | No trailing-slash redirect |
| `/careers` | `/careers` | 1,372 ms | NOT MEASURED this pass | NOT MEASURED this pass | 1,976 ms | 116 | NOT MEASURED this pass | |
| `/mobile-app` | `/mobile-app` | 1,368 ms | NOT MEASURED this pass | NOT MEASURED this pass | 2,148 ms | 89 | NOT MEASURED this pass | Fewest requests of the public set |
| `/join` | `/join` | 1,140 ms | 1,240 ms | 0.250 | 1,786 ms | 75 | 2.4 MB | Still loads `three` and the landing images |
| `/login` | `/login` | 1,260 ms | 1,392 ms | 0.248 | 1,854 ms | **157** | 2.8 MB | LCP is the static summary paragraph, not a photo. Third parties ~185 KB |
| `/signup` | `/signup` | 1,392 ms | 1,476 ms | 0.308 | 1,900 ms | **157** | 2.8 MB | Same Google and Facebook hosts |

Warm reloads of the routes that were measured twice: FCP about **300–380 ms**, LCP about **520–920 ms**, DOMContentLoaded about **350–420 ms**, TTFB about **120–145 ms**. CLS did not improve (FAQ stayed at 1.00, features at 0.44, about at 0.59).

Sitemap fetch from the browser: **HTTP 200**. An earlier non-browser fetch of the sitemap returned 500; that result was not reproduced in Chrome and is not treated as a production fault.

Every cold public route above downloaded `vendor-three`, `vendor-recharts`, `vendor-motion`, `index-DtR_onsJ.js`, both locale bundles, and the same large landing images (`akona-hotel`, `Logistik`, `wyc` / `wyo` on the first load). They are not route-specific.

### 4.5 Interactions

| Action | Where | Result |
| --- | --- | --- |
| Expand first FAQ | `/faq/` | **Failed.** Overlay `.app-setup-loading` was still present after **10,604 ms** (poll timed out). `aria-expanded` stayed `false`. A `pointerover` event of **112 ms** was recorded. The earlier click attempt also failed because the same overlay intercepts pointer events |
| Language | `/faq/` while the overlay was up | Menu item English was not visible. `lang` stayed `de`. Wall time 1,240 ms. This click is not a fair language-switch measurement |
| Theme (“Design”) | `/faq/` while the overlay was up | `documentElement` class stayed `caretip-font-inter`. Not a fair theme measurement |
| Cookie reject | `/faq/` | Button disappeared. Wall time about 500 ms, which includes a 400 ms settle. The bar is usable even while the page overlay is up |
| Mobile menu | `/` at 390×844 | Overlay gone in **982 ms**. Dialog opened. Wall time 1,399 ms including settle. Links rendered (Funktionen, industries, Preise, FAQ, Anmelden, Konto erstellen, and footer links) |

Field INP is **NOT MEASURED**.

The FAQ overlay matches the auth bootstrap loader. `shouldBlockGlobalAuthLoader` returns false for `isPublicShellPath`. That allowlist contains `/faq` and does **not** contain `/faq/`. Production redirects `/faq` to `/faq/`. `faq` is also a reserved first segment, so the slashed path is not treated as a public business slug either. The stuck-loader escape is `GLOBAL_LOADER_STUCK_WARN_MS` = **12,000 ms**. The overlay was still up at 10.6 s, which is before that escape. Classification: the blocked FAQ is **PROVEN**. The trailing-slash allowlist miss is **LIKELY** the cause (code path plus the measured URL). The same redirect-to-slash pattern was measured for features, industries, pricing, contact, about, privacy, terms, cookies, imprint, avv, and plv. The 10-second overlay was **measured only on FAQ**, so the other slashed routes are **LIKELY** the same bug, not each re-timed.

Homepage `/` has no slash mismatch. Its loader cleared in under a second. That contrast is why this is not “the whole site is blocked for 12 seconds.”

### 4.6 Mobile

Cold homepage at 390×844, same unthrottled network, empty cache.

| Metric | Value |
| --- | --- |
| TTFB | 237 ms |
| FCP | **1,176 ms** |
| LCP | **2,424 ms** |
| LCP element | Same QR-phone image, file `/assets/formemobile01-CxW-qADk.avif` |
| CLS | **0.687** (0.624 on `DIV#root` at 1,996 ms, then 0.062) |
| DOMContentLoaded / load | 1,790 / 1,797 ms |
| Requests | 113 |
| Transferred | about 2.5 MB |
| JavaScript | about 1.1 MB |
| Images | about 1.1 MB |
| Fonts | about 199 KB |
| Long tasks | 3, longest 208 ms, sum 441 ms |
| Scroll height | 11,530 px |
| New requests while scrolling | 12 |
| Menu | Opened after the loader cleared (~1.0 s) |

Mobile LCP is better than the desktop 5.7 s because the desktop run paid a fresh DNS/TCP handshake and a larger hero, and because desktop main-thread time was higher (script 601 ms vs 457 ms). It is still above a 2.5 s LCP budget. CLS is worse than desktop: the in-flow summary is a larger fraction of a short viewport.

Hero file is 960×1280 shown at 390×693 (`loading=eager`). Step screenshots are 1080×1920 shown at 264×469 and are also eager. Lazy stock thumbs are about 12–17× their display size; their byte cost was not separated from the hero, so they are not ranked as a primary problem.

Slow 4G + 4× CPU homepage: document load **6,767 ms**, FCP 2,344 ms, but the DOM had **66 nodes** and CLS 0. The app had not hydrated before the 4 s post-load settle. Contentful LCP under that profile is **NOT MEASURED**. The useful fact from that run is that `vendor-three` (260 KB), `index` (185 KB), `vendor-motion`, and `vendor-recharts` were already in the download set while the page was still a shell, and a **1,767 ms** task was recorded during parse.

### 4.7 Third-Party Resources

Marketing pages, including the homepage scroll: **no third-party host** in the CDP request list. Fonts are self-hosted under `/fonts/inter/`. The only cross-origin call on those pages was the first-party API host `caretip.onrender.com` for `/health`.

`/login` and `/signup` (cold):

| Resource | Why it loads | When | Size / cost | Blocks render? |
| --- | --- | --- | --- | --- |
| `accounts.google.com` GSI client | Google button on the auth form | During the login document load, before a consent click | about 103 KB, cache `private, max-age=1800`. Script resource timing about 712 ms | The login LCP (1.4 s) is the HTML summary text, which paints before this finishes. It does add a request on the auth waterfall |
| `accounts.google.com` GSI iframe | Same button | Same load | Resource timing about **738 ms**. Transfer size not reliably exposed | Not the document parser. It is extra work on the login main frame |
| `connect.facebook.net` SDK | Facebook button | Same load | about 80 KB, `max-age=1200` | Same as above |
| Facebook PNG | Button artwork | Same load | Present in the login asset list. Exact size not isolated | No |

Together the login cold load recorded **about 185 KB** of third-party transfer and **157** requests, versus 0 third-party bytes and ~117 requests on FAQ. These scripts do not load on the homepage. They load even if the visitor has not accepted non-essential cookies; the cookie bar was not required for them to start. That was measured on the cold login navigation, which did not click “accept.”

No chat, tag manager, or Meta pixel was seen on the marketing routes.

### 4.8 Core Web Vitals

Lab only. Thresholds used as a reading guide, not as field data: LCP good ≤ 2.5 s, CLS good ≤ 0.1.

| Page | LCP | CLS | INP |
| --- | --- | --- | --- |
| Homepage desktop cold | 5.7 s poor | 0.31 poor | NOT MEASURED |
| Homepage desktop warm | 0.93 s good | 0.31 poor | NOT MEASURED |
| Homepage mobile cold | 2.4 s needs work / borderline | 0.69 poor | Menu opened; no INP histogram |
| FAQ cold | 1.9 s good as a paint time | **1.00** poor | Click blocked > 10.6 s |
| Features cold | 2.0 s good | 0.44 poor | NOT MEASURED |
| About / privacy / terms | 3.7–4.7 s poor | 0.59 poor | NOT MEASURED |
| Login cold | 1.4 s good | 0.25 poor | NOT MEASURED |

The durable CWV failure is **CLS**. LCP is poor on the cold homepage and on several article-style pages, and good once the HTTP cache is warm.

### 4.9 Network Waterfall

Cold homepage, largest transferred responses:

| Bytes | Cache-Control | URL |
| --- | --- | --- |
| ~276 KB | `public, max-age=31536000, immutable` | `/assets/wyo-h-yzzmjd.avif` |
| ~259 KB | immutable | `/assets/vendor-three-BEPiy2Ih.js` |
| ~186 KB | immutable | `/assets/index-DtR_onsJ.js` (uncompressed body fetched separately: **718,725 bytes**) |
| ~156 KB | immutable | `/assets/akona-hotel-tfjLvtT6.webp` |
| ~124 KB | immutable | `/assets/index-DHjCVyQK.css` |
| ~121 KB | immutable | `/assets/Logistik-CNpN4SMS.avif` |
| ~112 KB | immutable | `/assets/de-BbiGROMi.js` |
| ~111 KB | immutable | `/assets/wyc-BZgFR-fM.avif` |
| ~108 KB | immutable | `/assets/vendor-motion-Bs2KQdqF.js` |
| ~105 KB | immutable | `/assets/vendor-recharts-BlnkmrU-.js` |
| ~106 KB | immutable | `/assets/en-BVKpi9bT.js` |
| ~80 KB | immutable | `/assets/vendor-react-BysRBL_E.js` |

`index-DtR_onsJ.js` contains the strings `vendor-three` and `vendor-recharts` and about 130 dynamic `import()` targets, including `BusinessLayout`, `EmployeeLayout`, and dashboard page chunks. Those dashboard chunks were **not** requested on any marketing or logged-out load. `three` and `recharts` **were** requested.

Slowest homepage resources by duration, not size: `wyo` AVIF 853 ms, `PublicPageShell` CSS 833 ms, `index` JS 830 ms, `wyc` preload 801 ms, `/health` 783 ms.

On FAQ, the slowest script was `vendor-three` at **1,149 ms**, then `vendor-recharts` 833 ms and `vendor-motion` 820 ms. The FAQ page does not render a 3D scene or a chart.

Why the landing images and the second locale load everywhere:

- `marketingChildRoutes.tsx` **statically imports** `LandingPage`.
- `routes.tsx` imports that module for the whole app, including `/login`.
- `LandingPage.tsx` runs this at **module evaluation**, not inside a mount effect:

```ts
void warmLandingHeroLcpImage().then(() => {
  scheduleMobileDeferredWork(() => prefetchLandingBelowFoldSections(), { desktopTimeoutMs: 120, ... });
  scheduleMobileDeferredWork(() => {
    void prefetchAlternateLocaleBundle();
    void preloadLiveMinutesOnboardingScreens(["en", "de"]);
  }, { desktopTimeoutMs: 2_500, ... });
});
```

- `prefetchLandingBelowFoldSections` dynamically imports the industry teaser, customer-journey section, and then warms hotel/logistics/gastronomy heroes plus the Akona hotel image.

That is why `/login` and `/faq` transfer the homepage photographs. Classification: downloads are **PROVEN**. The module-level prefetch is **LIKELY** the cause (it is the code path that requests those exact assets, and the images are not referenced as strings inside `index.js` itself).

`vendor-three` is **PROVEN** to download. In this source tree the only runtime `three` / `@react-three` imports are the SaaS 3D hero, and that page is declared with `routeLazy`. The deployed entry still references the chunk. So the hero is not successfully isolated in the build that is live. `DashboardUiLayer.tsx` in that hero imports `recharts`, which is a **LIKELY** reason `vendor-recharts` arrives with it. Dashboard chart files were not the ones that loaded.

Duplicate within a single page: `/brand/caretip-app-icon.svg` was requested twice on features, login, signup, and privacy. Low cost.

### Phase 1 ranking

| Severity | Finding |
| --- | --- |
| CRITICAL | `/faq/` full-screen loader still blocking clicks at 10.6 s |
| CRITICAL | CLS 0.25–1.00 on public pages, including warm loads, first shift on `#root` |
| HIGH | Cold homepage LCP 5.7 s, after the hero file was already preloaded |
| HIGH | `vendor-three` + `vendor-recharts` (~365 KB) on every public route |
| HIGH | Landing images and both DE and EN onboarding screenshots prefetched on non-home routes |
| MEDIUM | Trailing-slash redirect adds hundreds of ms (739 ms measured on FAQ) and is the URL shape that misses the public-shell allowlist |
| MEDIUM | Login/signup pull Google and Facebook (~185 KB) on first paint of the auth form |
| LOW | `/health` wake-up on marketing pages; duplicate SVG icon |
| OPTIMIZED / NO ACTION | Document TTFB, tiny HTML, HTTP/2, immutable hashed assets, self-hosted fonts, no marketing analytics, dashboard route chunks not loaded logged-out, hero preload present, lazy attribute on the small stock photos |

## 5. Phase 2 — Authenticated Dashboards

Authenticated employee, business/manager, and platform-admin sessions were **NOT MEASURED**.

No approved test account was available in this session. Production environment files were not opened. No login form was submitted. No payment, payout, QR order, subscription, KYC, or admin mutation was performed.

What was measured is only the **logged-out** entry to those URLs, desktop, cold context:

| Requested | Final URL | Status | FCP | DCL | TTFB | Requests | `three` loaded |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/dashboard` | `/login` | 200 | 1,468 ms | 3,072 ms | 237 ms | 153 | yes |
| `/employee` | `/employee/login` | 200 | 1,656 ms | 2,959 ms | 238 ms | 130 | yes |
| `/admin` | `/platform-admin/login` | 200 | 1,520 ms | 2,262 ms | 245 ms | 114 | yes |
| `/platform-admin` | `/platform-admin/login` | 200 | 1,376 ms | 1,997 ms | 233 ms | 96 | yes |

These numbers are login-shell costs, not dashboard costs. They already include the marketing JavaScript and image prefetch described in Phase 1, plus the Google/Facebook cost when the destination is `/login`.

The deployed entry lists dashboard chunks as dynamic imports (`BusinessLayout`, `EmployeeLayout`, `BusinessDashboard`, tip, team, QR studio, billing, and settings chunks were visible as import strings). None of those filenames appeared in the marketing or logged-out waterfalls. So the split exists. Whether those chunks are slow **after** login is **NOT MEASURED**. This audit does not recommend further dashboard splitting, memoization, or API caching on the basis of source inspection alone.

### 5.1 Employee

- Startup, login-to-dashboard, API list, charts, tables, navigation, mobile dashboard, and repeat-visit caching: **NOT MEASURED**.
- Logged-out `/employee` reaches `/employee/login` in about 3.0 s to DOMContentLoaded, FCP 1.7 s, and still downloads `vendor-three` and `vendor-recharts`.
- Rendering and interaction inside the employee app: **NOT MEASURED**.

### 5.2 Business / Manager

- Overview, employees, tips, payouts, QR, settings, branding, feedback, notifications, subscriptions, KYC: **NOT MEASURED**. Pages were not opened while authenticated, so this list is not a performance result.
- Logged-out `/dashboard` redirects to `/login` (FCP 1.5 s, 153 requests). That is the cost before any business API runs.

### 5.3 Platform Admin

- Admin overview, tables, audit logs, business management, search, pagination: **NOT MEASURED**.
- Logged-out `/admin` and `/platform-admin` both end at `/platform-admin/login` (FCP about 1.4–1.5 s). Node count at settle was 106, which is the login shell, not an admin table.

For all three roles, API duration, payload size, duplicate calls, long tasks inside charts, and mobile dashboard layout are **NOT MEASURED**.

## 6. Cross-Application Findings

1. Worst public page for a real visitor: **`/faq/`**, because CLS is 1.00 and the page does not accept the FAQ click for at least 10.6 s. Worst paint: **homepage LCP 5.7 s**.
2. Worst dashboard: **NOT MEASURED**.
3. Slowest measured API-like request: `GET https://caretip.onrender.com/health`, about 0.5–0.8 s. No authenticated API was called. `/api/auth/refresh` did not appear in the captured resource names.
4. Largest JS payload: `vendor-three` ~259 KB on the wire. Largest script to parse: `index` ~719 KB uncompressed / ~186 KB on the wire.
5. Largest image: `wyo` AVIF ~276 KB, 3840×2560, shown at 1440×782, and it is not the LCP image. The LCP image `wyc` is ~111 KB.
6. Most expensive third party: Google sign-in on `/login` (script ~712 ms, iframe ~738 ms, ~103 KB) plus the Facebook SDK (~80 KB). Absent on the marketing site.
7. Highest request count: `/login` and `/signup`, **157**.
8. Most significant repeated download: the landing image set and `vendor-three` / `vendor-recharts` / `vendor-motion` on every route, not a double-fetch of one XHR. The only same-document duplicate called out by the counter was the app-icon SVG (2×).
9. Largest main-thread slice: homepage long-animation frame **1,422 ms** (222 ms blocking) plus long tasks summing **1,061 ms**.
10. Worst mobile result: homepage CLS **0.687** with LCP **2.4 s** and the same ~1.1 MB of JavaScript.
11. Biggest Core Web Vital problem: **CLS**, then cold desktop LCP.
12. Highest-impact change: make slashed marketing URLs count as public so the loader does not cover them, and stop evaluating the landing prefetch (and the 3D/chart chunks) on routes that do not render them.

## 7. Performance Bottleneck Ranking

1. FAQ (and likely every trailing-slash marketing URL) blocked by the global loader — critical, measured on FAQ.
2. CLS from the in-flow pre-hydration summary and the late React paint — critical, measured on every template.
3. Cold homepage LCP waiting on JS before the hero element exists — high.
4. Entry graph downloads Three, Recharts, Motion, and landing media everywhere — high.
5. Auth-page third parties — medium, limited to login/signup.
6. `/health` and the duplicate icon — low.

## 8. Optimization Recommendations

Each item is tied to a measurement.

### A. Treat `/faq/` as a public page

- **What is slow?** FAQ clicks do nothing for at least 10.6 s.
- **Where?** `https://caretip.de/faq/` after the slash redirect. Desktop Chrome.
- **How measured?** Poll of `.app-setup-loading` plus a click on `.caretip-faq-item-wise__trigger`.
- **Evidence?** Overlay still present at 10,604 ms. `aria-expanded` stayed `false`. Homepage overlay cleared in 982 ms.
- **Likely cause?** `isPublicShellPath` allows `/faq` and not `/faq/`, while the host redirects to the slashed URL. The loader is held until the 12 s stuck timeout.
- **Expected improvement?** FAQ becomes usable when the content is already in the DOM (FCP was 1.8 s), instead of after ~12 s.
- **Risk?** Low if the check normalizes a trailing slash, or if the redirect is removed and one canonical path is used. Do not weaken auth on `/dashboard` or `/admin`. Re-measure `/faq/` and one slashed industry URL.

### B. Take the crawler summary out of document flow

- **What is slow?** The page jumps as React starts. CLS 0.31 desktop home, 0.69 mobile home, 1.00 FAQ, and the same after a warm reload.
- **Where?** First shift on `DIV#root`, around the React start time (3.8 s desktop home, 2.0 s mobile home).
- **How measured?** Layout-shift observer with `hadRecentInput` ignored.
- **Evidence?** Shift sources above. HTML has an empty `#root` and an in-flow `#caretip-static-summary`. The boot overlay is `position: fixed`.
- **Likely cause?** The summary occupies height above `#root`, then `removeStaticCrawlerSummary()` deletes it as React renders.
- **Expected improvement?** The 0.244 (desktop) and 0.624 (mobile) root shifts should drop if the summary is `position: absolute` (or equivalent) and stays in the HTML for crawlers. Remaining heading shifts (~0.06) may stay.
- **Risk?** Medium for SEO if the text is removed from the DOM or set to `display: none`. Keeping the nodes in the HTML and only changing layout is the smaller change. Do not remove the summary entirely in this pass.

### C. Run landing prefetch only on `/`

- **What is slow?** Non-home pages transfer ~2.6 MB and spend main-thread time on landing media.
- **Where?** `/faq`, `/login`, `/imprint`, `/blog`, and the other routes in section 4.4.
- **How measured?** CDP largest-resource lists. Those routes’ top files are `vendor-three`, `index`, `akona-hotel`, `Logistik`, both locale files.
- **Evidence?** Login (no hero on screen) still transferred the hotel WebP and logistics AVIF. FAQ’s slowest script was `vendor-three` at 1,149 ms.
- **Likely cause?** Top-level code in `LandingPage.tsx` calls `prefetchLandingBelowFoldSections` and `preloadLiveMinutesOnboardingScreens(["en", "de"])` when the module is imported. The import is static from `marketingChildRoutes.tsx`.
- **Expected improvement?** Non-home first loads should lose the below-fold image set (on the order of 1 MB on the homepage image total) and the unused locale’s step screenshots. Homepage warm-return behavior can stay if this still runs after the homepage paints.
- **Risk?** Medium. A cold return to `/` would fetch those images later. That is the current below-fold design, and scroll on `/` only needed 12 extra requests because the prefetch had already run. Do not delete the hero preload in `index.html`.

### D. Keep Three and Recharts off routes that do not render them

- **What is slow?** ~259 KB + ~105 KB of JavaScript on every public page, and up to 1.1 s of download for Three on FAQ.
- **Where?** Every route in this audit, including logged-out `/admin`.
- **How measured?** CDP plus resource timing. The homepage LCP element was a photo, not a canvas.
- **Evidence?** Chunks are in the cold waterfall before `load`. `index-DtR_onsJ.js` references both names. Dashboard page chunks were not requested.
- **Likely cause?** The live entry graph still evaluates the 3D hero module. In source that module is the only `three` importer, and its Recharts import is `DashboardUiLayer.tsx`. The `routeLazy` wrapper is not sufficient in the deployed graph.
- **Expected improvement?** About 365 KB less JavaScript and less parse time on marketing and login. Homepage LCP may improve only somewhat, because `index` itself is still ~719 KB uncompressed and was on the LCP critical path.
- **Risk?** Low for the marketing site if the 3D demo route still dynamic-imports its chunk. Do not remove Recharts from real dashboard charts; those charts were not measured and their chunks did not load here.

### E. Do not expect image compression alone to fix homepage LCP

- **What is slow?** Desktop LCP 5.7 s.
- **Where?** Homepage hero.
- **How measured?** LCP observer vs resource timing.
- **Evidence?** `wyc` preload duration ~801 ms. LCP timestamp 5,700 ms. Natural size 3840×2560, displayed 1440×782. A second eager frame `wyo` is 276 KB.
- **Likely cause?** The element is created by React after the entry bundle runs.
- **Expected improvement?** A smaller srcset is still worth doing for bytes (the 2.7× density is real), but the timing gap to close is the ~5 s between preload completion and LCP.
- **Risk?** Low if a smaller candidate is added without removing AVIF. Do not block the hero on a new image pipeline before the loader and CLS fixes.

### F. Leave these alone

- Immutable one-year cache on hashed `/assets/` and `/fonts/`. Warm FCP ~350 ms shows it works.
- Self-hosted Inter. No third-party font delay was measured.
- Deferred `/health` ping. It is real, but it is not the FCP/LCP limiter. Removing it risks a cold Render instance on the next real sign-in.
- Cookie reject on the marketing site. It did not load a third-party CMP.
- Dashboard code-splitting. The chunks are already dynamic and were not fetched logged-out.

## 9. Priority Matrix

| Priority | Finding | Evidence | Expected Impact | Effort | Risk | Recommended Action |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | FAQ loader blocks input > 10.6 s | Overlay poll + failed expand on `/faq/` | Page usable around the existing 1.8 s FCP instead of ~12 s | Low | Low | Normalize trailing slash in `isPublicShellPath`, or serve one canonical path and test both |
| 2 | CLS 0.31–1.00 on public pages | Layout-shift entries on `#root`, warm loads included | Can move CLS from “poor” toward “good” on the root shift | Medium | Medium (SEO) | Keep the summary in the HTML, take it out of flow |
| 3 | Landing media prefetched on every route | Same images in login/FAQ waterfalls; module-level prefetch | Large drop in bytes and requests off the homepage | Medium | Medium | Call that prefetch only after the homepage mounts |
| 4 | Three + Recharts on every route | 259 KB + 105 KB in every cold waterfall; FAQ slowest script is Three | ~365 KB and less parse on all public pages | Medium | Low | Make the deployed entry stop importing the 3D hero |
| 5 | Desktop LCP 5.7 s | LCP at 5.7 s vs preload at 0.8 s | Secondary until JS paint is earlier; bytes still drop if `wyo` is not eager | Medium | Low | After A–D, remeasure before a hero rewrite |
| 6 | Google/Facebook on login | 157 requests, ~185 KB third-party, iframe 738 ms | Faster login shell only | Medium | Medium (auth UX) | Defer SDK injection until the button is needed. Do not change OAuth redirects or cookies in that work |
| 7 | `/health` on marketing | 0.5–0.8 s resource time, off the parser path | Small | Low | Medium | Keep the deferred wake. Do not move it earlier |

## 10. Quick Wins

1. Compare public paths with a trailing slash stripped, so `/faq/` uses the same loader rule as `/faq`.
2. Move `prefetchLandingBelowFoldSections`, `prefetchAlternateLocaleBundle`, and `preloadLiveMinutesOnboardingScreens` from `LandingPage.tsx` module scope into an effect that runs only when the pathname is `/`.
3. Stop eager-loading the second hero frame (`wyo`, 276 KB, `fetchpriority=low` but `loading=eager`) until the first frame has painted.

## 11. Medium-Term Improvements

1. Reposition `#caretip-static-summary` so it cannot push `#root`.
2. Confirm in a production build that `vendor-three` and `vendor-recharts` are absent from the homepage network log.
3. Serve one hero width close to the layout width (desktop display was 1440 px; the file is 3840 px).
4. Load onboarding screenshots for the active language only.
5. Defer the Google and Facebook SDKs on `/login` and `/signup` until the visitor uses those buttons.

## 12. High-Impact Structural Improvements

1. Split the always-on router graph from the homepage. Today `routes.tsx` statically imports `LandingPage`, so opening login evaluates landing side effects.
2. Only after a real employee, business, and admin session is measured: look at those API waterfalls. Do not redesign dashboard data loading from this report.

## 13. Things That Are Already Optimized

- HTML TTFB about 230–250 ms and a 12 KB document over HTTP/2.
- Warm navigations: FCP about 350 ms and LCP under 1 s on the homepage.
- Hashed assets use `public, max-age=31536000, immutable`.
- Hero uses AVIF, with a mobile file (`formemobile01`) that is the mobile LCP element rather than the 3840 px desktop frame.
- Marketing pages do not load analytics, chat, or third-party fonts.
- Small stock photos use `loading=lazy`.
- Below-fold landing sections are dynamic imports with reserved min-heights. The measured CLS is not those sections; it is `#root` at startup.
- Dashboard screens are separate dynamic chunks and were not downloaded logged-out.
- The PWA precache ignore list already excludes `vendor-three`. The cold-load problem is the first visit, before a service worker controls the page. No service worker was in control during these cold tests.
- Cookie reject does not depend on a third-party banner script.

## 14. Things That Should NOT Be Changed

- Do not change cookies, `SameSite`, OAuth redirect URIs, or auth middleware as a performance tweak.
- Do not remove `/health` until sign-in on a sleeping API instance is measured. It is not the marketing LCP limiter.
- Do not drop the active locale bundle. Only the *other* locale is optional at startup.
- Do not remove the hero preload. It already finishes in ~0.8 s. LCP is late because the element is late.
- Do not lazy-load every dashboard component. Those chunks were not in this waterfall, and no authenticated timing exists.
- Do not add a tag manager to collect field vitals as part of implementing this list. Marketing is currently free of that cost.
- Do not change production cache headers. The warm path shows they are doing their job.

## 15. Evidence / Measurements

Primary desktop cold homepage (`https://caretip.de/`, Chrome 155 headless, 1440×900, empty cache, 2026-10-08T15:56:44Z):

- DNS 147 ms, TCP 377 ms, TLS 146 ms, TTFB 242 ms
- FCP 2,700 ms, LCP 5,700 ms, CLS 0.308 (0.337 after full scroll)
- DOMContentLoaded 3,181 ms, load 3,189 ms
- 124 requests, ~2.8 MB transferred, JS ~1.1 MB, CSS ~161 KB, images ~1.4 MB, fonts ~199 KB, third-party 0
- Long tasks 7 / max 285 ms / sum 1,061 ms; one long-animation frame 1,422 ms
- LCP file preload duration ~801 ms

Mobile homepage, 390×844, empty cache, unthrottled:

- FCP 1,176 ms, LCP 2,424 ms, CLS 0.687, load 1,797 ms, 113 requests, ~2.5 MB

FAQ:

- Redirect to `/faq/` took 739 ms in navigation timing
- FCP 1,772 ms, LCP 1,892 ms, CLS 1.000
- `.app-setup-loading` still present at 10,604 ms; FAQ control did not expand

Warm homepage:

- FCP 348 ms, LCP 932 ms, CLS 0.306, DOMContentLoaded 386 ms

Slow 4G + 4× CPU contentful LCP: **NOT MEASURED** (66 DOM nodes when the run stopped).

Authenticated dashboard APIs, INP field data, Firefox, and Safari: **NOT MEASURED**.

Raw JSON used for this report is local lab output from that Chrome session (navigation, resource, and CDP sizes). It is not committed. It contains no cookies, tokens, or account data.

## 16. Recommended Next Implementation Phase

Do this, in order, on a branch, then re-measure production the same way (cold Chrome, homepage, `/faq/`, `/login`, one industry page, mobile homepage):

1. Fix public-path matching for trailing slashes and confirm the FAQ overlay is gone before 2 s and that a FAQ row expands.
2. Move the landing module side effects so they do not run on `/login` and `/faq`. Confirm `akona-hotel` and `Logistik` are absent from those waterfalls.
3. Fix the entry so `vendor-three` and `vendor-recharts` are absent from the homepage and FAQ network logs.
4. Reposition the static summary and remeasure CLS on `/`, `/faq/`, and mobile `/`.
5. Only then schedule an authenticated pass for employee, business, and platform admin, with approved test accounts, read-only navigation, and the same metric list.

No production code, configuration, or data was changed for this audit. Nothing was deployed, committed, or pushed.
