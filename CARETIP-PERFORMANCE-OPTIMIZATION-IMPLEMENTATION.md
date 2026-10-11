# CareTip Performance Optimization — Implementation

Date: 8 October 2026. Branch `main` at `0e5b3d83626866b2afde106ed6d8ad755b4d5c70`. This work is not deployed. Live `https://caretip.de` still serves the bundle measured in `CARETIP-PRODUCTION-PERFORMANCE-AUDIT.md`.

The “after” numbers below are from a local production build (`npx vite preview` on `http://127.0.0.1:4173`), headless Chrome  via Playwright 1.61.1, desktop 1440×900 and emulated 390×844. They are not a second pass against the live CDN. Local TTFB and LCP are faster because there is no DNS, TLS, or remote origin. What transfers to production is the chunk graph, the loader sequence, and the layout-shift cause.

Authenticated employee, business, and platform-admin dashboards were **not measured**. No demo password was available in this session. `.env`, transcripts, cookies, and tokens were not read. No demo account was changed.

Chrome mobile emulation is not a physical phone. Firefox and Safari were not available. Field INP / CrUX was not measured.

## 1. Baseline

Git before this work: `main` @ `0e5b3d83` (“Facebook refresh cookie on the frontend origin”). Uncommitted auth-loading recovery from the separate mobile investigation was already in the tree (`AuthPage.tsx`, `api.ts`, Apple/Facebook OAuth deadline wiring, locale strings, `CARETIP-MOBILE-AUTH-LOADING-FIX.md`). Those files were kept. OAuth redirect, cookie, session, CSP, and provider code were not redesigned.

Production audit (cold, `https://caretip.de`, 8 October 2026), the before state:

| Page | FCP | LCP | CLS | Notes |
| --- | --- | --- | --- | --- |
| `/` desktop | 2,700 ms | 5,700 ms | 0.308 | 0.244 of that on `DIV#root` |
| `/` mobile emulation | 1,176 ms | 2,424 ms | 0.687 | 0.624 on `DIV#root` |
| `/faq` → `/faq/` | 1,772 ms | 1,892 ms | 1.00 | `.app-setup-loading` still up at 10.6 s; accordion click did nothing |
| `/login` | 1,260 ms | 1,392 ms | 0.248 | ~157 requests, landing images + `vendor-three` + `vendor-recharts` |

`vendor-three` was about 259 KB on the wire and `vendor-recharts` about 105 KB, on homepage, FAQ, legal pages, login, and logged-out dashboard redirects. Akona hotel, Logistik, and the homepage hero also downloaded on pages that do not show them.

Logged-out redirects from the audit, still the only authenticated-shell observation:

- `/dashboard` → `/login`
- `/employee` → `/employee/login`
- `/admin` and `/platform-admin` → `/platform-admin/login`

No dashboard FCP, API count, or chart timing exists. That gap remains.

## 2. Changes Implemented

1. **Trailing slash.** `normalizePublicPathname` strips one trailing slash (root stays `/`). `/faq/` and the other marketing slugs match the public allowlist, so the global `.app-setup-loading` boot is not registered. `/dashboard/`, `/employee/`, and `/platform-admin/` stay authenticated shells. The HTML boot uses the same normalize, so `/faq/` is still a lazy marketing shell and the boot stays until the page is ready.

2. **Static summary.** `#caretip-static-summary` is `position: absolute` (top/left/right 0, z-index 0). The text is still in the document. It is not `display: none` and it is not removed for crawlers. React still deletes it at startup, but it no longer pushes `#root`.

3. **Homepage-only images.** Module-level `warmLandingHeroLcpImage()` no longer runs when the landing module is evaluated. Below-fold warming runs from a `LandingPage` mount effect. Header idle prefetch no longer downloads the hero or every industry photo. Login no longer idle-prefetches the landing hero. An industry page no longer idle-warms the other industries’ heroes. The shared `index.html` no longer contains a parser preload for `wyc` / `formemobile01` on every route; a path check injects that preload only when the path is `/`. Hover and focus on a real link still warm that one route.

4. **Three.js and Recharts.** Vite’s preload helper (`\0vite/preload-helper.js`) is its own 1.25 KB chunk. It used to be placed inside `vendor-three`, which made the public entry statically import Three and, through that chunk, Recharts. Three is no longer a manual chunk, so it stays on the lazy 3D route (`three.module`, gzip 188 KB) and the blog/careers shader. Recharts stays `vendor-recharts` (gzip 115 KB) and is imported by dashboard chart chunks and the 3D hero page, not by the public entry.

5. **Anonymous login handoff.** A cold visit with no stored session and no session hint paints the login/signup form under the single HTML boot. The global “preparing your account” overlay is reserved for a browser that already has a session to restore. Returning users with a stored session still wait on that one overlay so the form does not flash before redirect.

## 3. Files Changed

Performance work:

- `index.html`
- `vite.config.ts`
- `src/app/lib/publicRoutes.ts`
- `src/app/lib/htmlMarketingBootBridge.ts`
- `src/app/lib/prefetchPublicRoutes.ts`
- `src/app/pages/LandingPage.tsx`
- `src/lib/landingHeroStoryAssets.ts`
- `src/app/components/Navigation.tsx`
- `src/app/components/AuthPage.tsx` (login paint flag and removal of the landing-image prefetch only; the earlier auth-timeout work in this file was left as-is)
- `src/app/components/AuthBootstrapLoadingRegistrar.tsx`
- `src/components/industries/IndustryPageTemplate.tsx`
- `scripts/employee-signout-runtime.ts`
- `CARETIP-PERFORMANCE-OPTIMIZATION-IMPLEMENTATION.md`

Not part of this performance change, and not reverted: the uncommitted auth-loading deadline files from the separate mobile investigation.

## 4. Public Performance Before/After

Before is live production. After is the local production build. Do not read the local LCP column as a production LCP win; the machine is serving itself.

| Page | Before CLS | After CLS | After loader | After homepage-only assets | After Three / Recharts |
| --- | --- | --- | --- | --- | --- |
| `/` desktop | 0.308 (`#root` 0.244) | 0.068 (H1 0.065, no `#root`) | One HTML boot, gone by ~1.0 s | Hero, Logistik, Akona still load (correct) | Not requested |
| `/` mobile emulation | 0.687 (`#root` 0.624) | 0.062 (SPAN) | One HTML boot | Mobile hero + below-fold still load | Not requested |
| `/faq/` | 1.00, click blocked > 10.6 s | 0 | One HTML boot, gone before the click | None | Not requested |
| `/features/` | 0.44 in the audit’s warm note | 0 | One HTML boot | None | Not requested |
| `/industries/hotels/` | (slash family, same loader bug likely) | 0 | One HTML boot, industry copy | Hotels hero only (~66 KB). No Logistik, no Akona, no `wyc` | Not requested |
| `/pricing/` | same slash family | 0 | One HTML boot | None | Not requested |
| `/privacy/` | summary shift on legal pages | 0.483 on `FOOTER` at 3.0 s, not on `#root` | One HTML boot | None | Not requested |
| `/login` | 0.248, landing images + both vendor chunks | 0.028 | One HTML boot. Password field present. No second overlay | No hero, no Akona, no Logistik | Not requested |
| `/signup` | same class of page as login | 0.042 | One HTML boot | Same as login | Not requested |

FAQ accordion: a closed item went from `aria-expanded="false"` to `"true"`, the open class was set, and `.app-setup-loading` was absent. Click handling was about 260 ms in this lab, mostly the test’s own wait.

Local desktop homepage LCP in this preview was about 1.1 s (FCP 164 ms). Production cold LCP remains 5.7 s until this build is deployed. The audit already showed that gap is JavaScript paint, not the image file (preload finished ~0.8 s, LCP at 5.7 s). Removing Three and Recharts from the entry is the change aimed at that wait. It is not remeasured on the live origin.

Local FAQ transferred about 645 KB of JavaScript and 1.4 KB of images. Production FAQ was about 2.6 MB with Three as the slowest script (1,149 ms).

Chunk graph of `dist/assets/index-CHO8SP_P.js` (717 KB raw / gzip 200 KB):

- imports `vendor-preload` (1.25 KB, gzip 0.70 KB)
- `vendor-three` count 0, `vendor-recharts` count 0, `three.module` count 0, `vendor-jspdf` count 0
- `three.module-*.js` is 725 KB raw / gzip 188 KB, imported by the 3D hero page and the idle shader, not by FAQ or the entry
- `vendor-recharts-*.js` is 432 KB raw / gzip 115 KB, imported by `BusinessDashboardAnalyticsCharts`, `EmployeeDashboardEarningsChart`, admin/platform chart chunks, and the 3D hero page

`/dashboard/` still redirects to `/login`. `/employee/` still redirects to `/employee/login`. `/platform-admin/` still redirects to `/platform-admin/login`. The slash normalize did not make those shells public.

## 5. Employee Performance Before/After

**Not measured authenticated.** `demo@caretip.de` was not used. No password was entered, stored, or logged.

Logged-out `/employee/` on the local build: final URL `/employee/login`, one HTML boot (“Einen Moment bitte…”), no second overlay, no Three, no Recharts, no homepage hero. That only describes the bounce to login.

Login completion time, dashboard FCP/LCP, API duplicates, charts, and tables: **not measured**.

## 6. Business Performance Before/After

**Not measured authenticated.** `employee@caretip.de` was not used.

Logged-out `/dashboard/` on the local build: final URL `/login`, password field present, no dashboard shell. See the loader note in section 9. No business API calls were made.

## 7. Platform Admin Performance Before/After

**Not measured authenticated.** `admin@caretip.de` was not used.

Logged-out `/platform-admin/` on the local build: final URL `/platform-admin/login`, one HTML boot whose sentence updates in place from “Einen Moment bitte…” to “Ihr Konto wird vorbereitet…”, then the form. No second overlay node. No Three, no Recharts, no homepage hero.

## 8. Mobile Performance

Emulated Pixel-class viewport only. No physical Android device, no iOS device, no CareTip WebView.

| Flow | Loader | CLS | Homepage hero |
| --- | --- | --- | --- |
| Mobile `/` | One HTML boot | 0.062 | Mobile hero plus below-fold (Logistik, Akona) |
| Mobile `/login` | One HTML boot, then the form | 0.001 | Not requested |
| Mobile `/signup` | One HTML boot, then the form | 0.006 | Not requested |
| Mobile employee / business / admin dashboards | Not measured | — | — |

The FAQ overlay bug was a pathname bug, not a mobile-only timer. The same normalize applies on a phone. That was not confirmed on a physical device.

## 9. Loading/Handoff Audit

Visible full-screen owners:

| Component | Owns | Starts | Ends | Survives navigation? |
| --- | --- | --- | --- | --- |
| `#caretip-html-boot` | First paint, one sentence | HTML, before React | Route-ready (marketing) or boot handoff | Removed. Does not stay on the next page |
| `AppBrandedLoadingScreen` (`.app-setup-loading`) | Global registrations in `AppLoadingManager` | A registrar such as auth bootstrap or a route guard | That registration releases, with a short minimum | Can replace the HTML boot if the boot is dismissed first |
| `PublicRouteChunkHold` | Lazy public chunk, under the HTML boot on a cold load (z-index 9990 vs boot 9997) | Suspense before the chunk | Chunk commit. Soft navigations use a quiet hold | Not a second visible screen while the boot is up |
| `AuthBootstrapShell` | Invite gate, or a login paint that must wait for a stored session | Auth page gate | Gate clears | Covered by the sign-in handoff when that flag is set |
| `SignInHandoffCover` | After a successful password/OAuth submit, until the destination mounts | Auth success | Destination or the existing 20 s cap | One handoff. Dashboard skeletons under it are a different operation |
| `DashboardOutletShellHold` / page skeletons | Destination data after the shell exists | Dashboard route | Data ready | Acceptable second state: it is the page, not another “Just a moment” |
| `CareTipPageLoader` | Guest tip / QR flows | Those pages’ own fetch | Fetch result | Separate from marketing boot |

Repeated loaders found:

| Flow | Loader 1 | Loader 2 | Same operation? | Action |
| --- | --- | --- | --- | --- |
| `/faq/` cold | HTML boot, then `.app-setup-loading` stayed over a ready FAQ for > 10.6 s | The overlay was the auth boot applied to a public URL | Yes. The page was already there | Fixed. `/faq/` is public. Local remeasure: one boot, accordion works, overlay absent |
| `/login` and `/signup` cold | HTML boot “Einen Moment bitte…” | Then `.app-setup-loading` “Ihr Konto wird vorbereitet…” for a few hundred ms with no stored session | Yes. Anonymous cold paint | Fixed. Local remeasure shows only the HTML boot, then the form |
| Logged-out `/dashboard/` → `/login` | HTML boot “Einen Moment bitte…” | Then `.app-setup-loading` “Einen Moment bitte…” again before the form | Yes. One bounce to login | **Not changed.** The route guard still registers a branded overlay. Editing it without an authenticated session would risk the real sign-in handoff. Recorded as remaining |
| Logged-out `/platform-admin/` | HTML boot, sentence replaced in the same node | No second node | One operation | Left as-is. This is the preferred pattern |
| Logged-out `/employee/` | HTML boot only | None | — | Already one handoff on this build |
| Password submit → dashboard | Sign-in cover | Dashboard skeleton | No. Cover is the auth handoff. Skeleton is destination data | Not merged |
| Marketing soft navigation | Chunk hold under the boot on cold load | — | Same cold load, not a second visible screen | Not removed. It prevents an empty `#root` |

No loader in the measured public flows stayed up indefinitely. The existing stuck-loader cap (about 12–15 s) was not removed.

## 10. API Performance Findings

No authenticated API traffic was captured. Public pages still fire the deferred `/health` wake from `wakeRemoteApi()`. The production audit timed that at roughly 500–800 ms and off the document critical path. It was left in place. Duplicate dashboard API calls, sequential waterfalls, and payload sizes are **not measured**.

## 11. JavaScript/Bundle Findings

Proven on the production build graph, not only on a network log:

- Public entry no longer statically imports Three, Recharts, or jsPDF.
- The shared helper that was dragging those libraries into the entry is `vendor-preload` (gzip 0.70 KB).
- Three loads with the 3D hero (`SaasDashboard3DHeroPage`, gzip 96 KB plus `three.module` gzip 188 KB) and, after idle, with the blog/careers/mobile shader.
- Recharts loads with dashboard chart chunks and with the 3D hero (that scene’s UI layer uses charts). A business analytics chart chunk imports Recharts and does not import Three.

`index` itself is still about 717 KB raw / gzip 200 KB. That remains on every route and is still the main public script.

## 12. Image/Asset Findings

Homepage still warms the hero and the below-fold set (Akona, Logistik, industry teasers). That is intentional.

Non-home routes in the local build did not request `wyc`, `wyo`, Akona, or Logistik:

- `/faq/`, `/features/`, `/pricing/`, `/privacy/` image transfer was about 1.4 KB
- `/industries/hotels/` image transfer was about 66 KB (that page’s hero)
- `/login` and `/signup` did not request the homepage hero. A 375-byte `onboardingProgress-*.js` module still loads; it is not the onboarding screenshot set

The earlier failure mode was real: header idle prefetch and a document-level hero preload ran on every URL because every route is the same `index.html`. Both are now gated.

## 13. CLS Findings

The `#root` shift is gone on the local build. Desktop home 0.068 (H1 at 1.6 s, value 0.065). Mobile home 0.062 (a SPAN). FAQ 0. Features, pricing, and hotels 0.

`/privacy/` still shifts 0.482 on `FOOTER` at about 3.0 s. That is not the static summary. It was not “fixed” by the summary change and is not a good enough layout for animation on legal pages.

The summary element is still in `dist/index.html` with its German and English text, absolutely positioned, not hidden.

## 14. LCP Findings

Production cold desktop LCP is still 5.7 s until deploy. The LCP element was the `wyc` hero, already preloaded in ~0.8 s. This change does not rewrite the hero pipeline.

On the local build the homepage still preloads and paints that hero (desktop LCP about 1.1 s on localhost). FAQ LCP in the same lab was about 1.3 s with no hero download. Those figures will not match production.

The preload link is created only when the path is `/`, from the entry script rather than the HTML preload scanner. Homepage image discovery is therefore a little later than a parser preload. That is the cost of not downloading the hero on `/faq` and `/login`. The production LCP gap the audit measured was several seconds after the file had already arrived, so the scanner hint was not the limiter.

## 15. Remaining Bottlenecks

P0 addressed in this build, still live in production until deploy:

- FAQ overlay over a ready page
- `#root` jump from the in-flow summary

P1 still open:

- Cold homepage LCP on the live site (5.7 s). Entry JS is still ~200 KB gzip, plus the hero
- Authenticated dashboard startup, duplicate APIs, and chart cost: unknown
- `/privacy/` footer CLS 0.483
- Logged-out `/dashboard/` still shows a second “Einen Moment bitte…” for a few hundred milliseconds before login

P2:

- Homepage H1/SPAN shift of about 0.06
- `wyo` is still an eager second hero frame (~276 KB) on the homepage
- Industry and hero images are still large on the homepage itself
- Blog, careers, and mobile-app idle-load Three for their shader. That is the feature, not the initial entry

P3 was not chased. The duplicate app-icon request from the audit was left alone.

## 16. Deliberately Unchanged Systems

Left unchanged:

- Facebook OAuth architecture, redirect, state, and provider configuration
- Google OAuth
- Apple OAuth
- Refresh-token architecture
- Cookies
- CSP
- Auth middleware
- Database schema
- Service-worker architecture (the PWA plugin config was not retuned; cold loads in the audit had no controller)
- Security controls, including auth route guards. Logged-out `/dashboard/`, `/employee/`, and `/platform-admin/` still end on the matching login screen

The separate auth-loading deadline (20 s abort on credential exchange, sign-in navigation recovery) was already in the working tree and was not rewritten. `test:auth-loading-recovery` passed.

Also left alone, from the audit’s own leave-list: `/health` wake, Google and Facebook scripts on the login form, and the hero image pipeline.

## 17. Animation Readiness

**No. The application is not ready for a new animation pass.**

What is ready, on this build only:

- Public marketing cold load is one boot, then the page
- FAQ is usable when the accordion is in the DOM
- The large `#root` shift from the crawler summary is gone locally (home CLS about 0.06–0.07, FAQ 0)
- Three and Recharts are off the public entry graph
- Non-home routes do not download the homepage hero or the Akona/Logistik set

What still blocks animation:

1. This build is not what `https://caretip.de` serves. Production FAQ is still the 10.6 s overlay and production CLS is still poor until deploy.
2. Authenticated dashboards have no measurements. Animating those shells before seeing their startup would hide an unknown wait.
3. `/privacy/` still has a 0.48 footer shift.
4. Live homepage LCP is 5.7 s and is JavaScript-bound. Motion on that hero would play during the wait, not remove it.
5. Logged-out business entry still flashes a second identical “Einen Moment” screen.

After this build is deployed, remeasure `/`, `/faq/`, `/login`, and one authenticated dashboard per role. If those CLS figures stay under 0.1, the FAQ overlay stays down, and dashboard first paint is a single handoff plus real content skeletons, a later phase can add small motion on the marketing pages.

## Tests

Passed after the route, summary, and landing-mount changes:

- `test:employee-signout` (includes `/faq/` public and `/dashboard/` still authenticated)
- `test:app-performance-architecture` (landing route stays eager)
- `test:seo-remediation` (summary still present and not hidden)
- `test:auth-loading-recovery`

The later prefetch, preload, and anonymous-login changes were checked in the browser against the production preview, not by another unit-test pass.
