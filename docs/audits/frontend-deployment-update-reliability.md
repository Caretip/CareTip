# Frontend Deployment & Runtime Update Reliability

Status: Phase A audit complete (read-only). Implementation sections are appended below the audit.

Scope: the Vite/React SPA served from Netlify at `https://caretip.de`. Backend (`https://api.caretip.de`,
legacy `https://caretip.onrender.com`) is out of scope and unchanged.

## 1. Initial repository state

| Item | Value |
| --- | --- |
| Remote | `company` → `https://github.com/Caretip/CareTip.git` (only remote) |
| Remote `main` at audit start | `bf33628a` (fix: remove language selector from mobile auth page) |
| Auth reliability commit `0e301b93` | ancestor of remote `main` |
| First-party API migration `215f7602` | ancestor of remote `main` (merged) |
| Work location | new worktree `CareTip-deploy-update`, branch `feat/frontend-deploy-update-reliability` from `company/main`, no upstream |

Pre-existing worktrees left untouched:

- `CareTip-main` (`main` @ `0e301b93`, 3 behind remote): unrelated uncommitted changes (6 deleted root Markdown
  files, tip-email files, `public/sitemap.xml`, mobile auth files, untracked `images/caring001.webp`,
  `new-employee.jpeg`).
- `CareTip-api-first-party-domain` (`feat/first-party-api-domain` @ `215f7602`): uncommitted changes in
  migration test/docs files, `public/robots.txt`, `public/sitemap.xml`, untracked `images/caring001.webp`.
- `CareTip-main-merge` (detached @ `bf33628a`): clean.

## 2. Build architecture

- Vite 6-style config in `vite.config.ts`; `build.outDir = dist`, `base = '/'`, `modulePreload: false`,
  manual vendor chunks. Rollup default naming → `dist/assets/[name]-[hash].js|css` (content hashed).
- Entry: `index.html` → `src/i18n/preloadLocale.ts` + `src/main.tsx` → `GlobalErrorBoundary` → `App`.
- Routing: React Router data router (`src/app/routes.tsx`). Almost every page is a `lazy` route via
  `routeLazy()` (`src/app/routing/routeLazy.ts`), which calls `loadRouteModuleWithRetry` (one immediate retry
  on a chunk failure, no reload).
- `npm run build` = `vite build` + `scripts/prerender-public-seo-html.ts` (writes per-route HTML into `dist`).
  `prebuild` generates icons, fonts, LCP images, the FCM SW handler and SEO files.
- **No build version, release id or build timestamp existed** anywhere in the bundle or in `dist`.

## 3. Netlify configuration and actual production caching

`netlify.toml` only sets `command = "npm run build"` and `publish = "dist"` (no headers, no contexts).
`public/_headers` and `public/_redirects` are copied into `dist/` by Vite and are the authoritative header and
redirect configuration. `vercel.json` mirrors headers for optional Vercel previews only.

`_redirects`:

```
/robots.txt   /robots.txt   200
/sitemap.xml  /sitemap.xml  200
/api/*  https://caretip.onrender.com/api/:splat  200
/*    /index.html   200
```

Read-only `HEAD` requests against production on 2026-11-02 (before any change):

| Path | Status / type | Cache-Control served |
| --- | --- | --- |
| `/` | 200 `text/html` | `public,max-age=0,must-revalidate` (Netlify default) |
| `/index.html` | 200 `text/html` | `public,max-age=0,must-revalidate` |
| `/dashboard` (SPA deep link) | 200 `text/html` | `public,max-age=0,must-revalidate` |
| `/version.json` | **200 `text/html` (SPA fallback — file did not exist)** | `public,max-age=0,must-revalidate` |
| `/sw.js` | 200 JS | `public,max-age=0,must-revalidate` |
| `/manifest.webmanifest` | 200 `application/octet-stream` | `public,max-age=0,must-revalidate` |
| `/assets/does-not-exist-0000.js` | **200 `text/html` (index.html)** | **`public,max-age=31536000,immutable`** |
| `/fonts/inter/inter-latin-400-normal.woff` | 200 font | `public,max-age=31536000,immutable` |

Findings:

- HTML already revalidates on every request (ETag), so the CDN/browser HTTP cache is **not** what pins users to an
  old `index.html`.
- **Defect:** a missing hashed asset (an old chunk after a deploy) is answered by the SPA catch-all with
  `index.html`, status 200, and the `/assets/*` immutable header. Browsers may store HTML under a JS URL for a
  year, the module load fails with a MIME error, and the Workbox image route (`statuses: [200]`) can cache HTML
  under an image URL.
- `/fonts/*` files are not content-hashed but are served `immutable` for a year (pre-existing; acceptable only
  because font files are never edited in place).

## 4. Service worker / PWA

An **active service worker exists**: `vite-plugin-pwa` (`generateSW`, Workbox 7) with
`registerType: 'autoUpdate'`, `cacheId: 'caretip-pwa-v13'`, `cleanupOutdatedCaches: true`,
`navigateFallback: 'index.html'`, precache of `**/*.{js,css,html,ico,svg,woff2,json,webmanifest}`, plus FCM
`importScripts`. Registered in `src/main.tsx` (production, deferred) with
`registerSW({ immediate: true, onNeedRefresh() { updateSW(true) } })`. `src/app/lib/deferredStartup.ts`
contains a second, currently unused, identical registration.

Behaviour of `autoUpdate` (verified in `node_modules/vite-plugin-pwa/dist/client/build/register.js`):

- generated SW uses `skipWaiting` + `clientsClaim`; a new SW activates as soon as it is installed;
- on `activated` with `isUpdate`, the client calls `onNeedReload()` if provided, otherwise
  **`window.location.reload()` immediately** — CareTip passes no `onNeedReload`, so every open tab reloads the
  moment a new SW activates, regardless of payment, upload, form or auth state;
- `onNeedRefresh` is never called in auto mode (the existing handler is dead code);
- navigations are answered from the precached `index.html`; the browser only re-checks `sw.js` on navigations,
  functional events and roughly every 24 h. A long-lived SPA tab that never performs a full navigation does not
  look for a new SW;
- activation deletes precache entries that are not in the new manifest, so an old page's not-yet-loaded lazy
  chunks are no longer cached and fall through to the network, where Netlify no longer has them.

## 5. Existing stale-chunk handling

- `src/app/lib/chunkLoadRecovery.ts`: `isChunkLoadFailure` (Chrome/Firefox/Safari messages, `ChunkLoadError`),
  `loadRouteModuleWithRetry`, `recoverStaleChunkOnce` (reload once per 30 s per tab via `sessionStorage`).
- `src/main.tsx`: `vite:preloadError` → `preventDefault()` + `recoverStaleChunkOnce()`. Because the event is
  prevented, Vite resolves the import with `undefined`; the reload races the resulting `TypeError`.
- `GlobalErrorBoundary` and the route `ErrorBoundary` classify chunk failures; the route boundary shows
  "CareTip needs a refresh" with a Refresh button.
- Gaps: reload is unconditional (no check that a newer deployment exists, no protection for active operations),
  the 30 s cooldown allows repeated reloads over time, Vite's `Unable to preload CSS` error is not classified.

## 6. Authentication and session handling (must not change)

- Access token memory-only (`accessTokenStore`), refresh cookie `caretip_refresh` (HttpOnly, host-only),
  single-flight refresh `refreshSingleton` in `src/app/lib/api.ts` with cross-tab coordination
  (`coordinateCrossTabRefresh`), legacy-host migration inside the refresh path, logout awaiting both hosts,
  `authPostLoginTransition` / `authLogoutTransition` stores, OAuth callback routes
  (`/auth/facebook/complete`, `/mobile-auth`), idle session controller.
- A full reload is already a supported path: bootstrap restores the session from the refresh cookie.
- Interruption risks: reloading while `refreshSingleton` is pending (rotation response lost → grace window /
  reuse detection), during post-login or logout transitions, or on a callback route that consumes a one-time
  token or code.

## 7. Payments and critical workflows

| Workflow | Existing protection | Reload risk |
| --- | --- | --- |
| Guest tip (`/qr/*`, `/staff/*`, `/table/*`, `/select-employee`, `/tip-amount`, `/payment`) | sync lock `guestTipCheckoutInFlight`, in-memory `TipFlowContext` | reload loses flow state or aborts session creation |
| Stripe redirects (`performExternalStripeRedirect`, 19 call sites) | `externalStripeNavigationHold` until `pagehide` | reload during hand-off |
| Stripe returns (`/success`, `/rating`, `/tip-complete`, `/subscription/success`, `?session_id`, `?checkout`, `?connect`, `?billing`, `?payoutConnect`, `?physicalOrder`) | page-level verification effects | reload re-runs verification mid-flight |
| KYC uploads, settings, employee management, refunds, payouts | per-component `busy` state only | reload aborts the request; outcome unknown to the user |
| Typed but unsaved form input | none | reload discards input |

There is no global, reliable "busy" signal; inventing one from loading flags would be unreliable.

## 8. Failure scenarios identified

1. Deploy while a tab is open → the tab keeps running old JS indefinitely (no version check; SW update only on
   navigation).
2. New SW activates (e.g. user opens a second tab) → **all tabs reload immediately**, including mid-payment,
   mid-upload or mid-refresh.
3. Old tab navigates to a lazy route → chunk is gone → HTML 200 + immutable → module error → unconditional
   reload, or a refresh screen.
4. Reload loop potential when the HTML served after reload is still old (SW precache) — bounded only by a 30 s
   cooldown.
5. `/version.json` and other unknown files silently return `index.html`.

## 9. Recommended implementation (adopted)

- Build-time version (`COMMIT_REF` + `BUILD_ID` on Netlify; git SHA or `local` + timestamp locally) embedded via
  `define` and emitted as `dist/version.json`, excluded from the SW precache.
- Explicit cache headers for `/`, `/index.html`, `/version.json`, `/manifest.webmanifest` (SW registration is
  bundled from `virtual:pwa-register` into hashed assets, so there is no separate `registerSW.js` to cache);
  missing `/assets/*` → real 404 instead of the SPA fallback.
- A testable deployment update coordinator (polling, visibility, online, cross-tab sharing) that never reloads
  on its own when unsafe: explicit blocker API, system blockers (auth refresh/migration, login/logout
  transitions, Stripe hand-off, in-flight mutating requests), sensitive routes, recent form input.
- Keep the service worker (removing it would strand installed PWAs), but route its activation reload through the
  coordinator via `onNeedReload`, and ask the SW to update before a coordinated reload.
- Chunk recovery that first confirms a newer deployment and reloads at most once per version transition.

## 10. Files changed

Branch `feat/frontend-deploy-update-reliability` (worktree `CareTip-deploy-update`, base `bf33628a`), uncommitted.

| File | Change |
| --- | --- |
| `scripts/deploy-build-version.mjs` (new) | Resolves the build id, emits `version.json` (build only) |
| `vite.config.ts` | `define` of `__CARETIP_BUILD_VERSION__` / `__CARETIP_BUILD_TIME__`; version plugin; `version.json` + `404.html` excluded from precache |
| `src/vite-env.d.ts` | Declares the two build constants |
| `src/app/lib/deployUpdate/*` (new) | `buildInfo`, `versionCheck`, `updateBlockers`, `useUpdateBlocker`, `mutationRequestTracker`, `routePolicy`, `updateCoordinator`, `crossTabChannel`, `runtime`, `serviceWorkerRegistration`, `ageLimitedSignal` |
| `src/app/components/DeployUpdateRouteObserver.tsx` (new) | Reports route changes (safe reload moments) |
| `src/main.tsx`, `src/app/lib/deferredStartup.ts` | Single SW registration path via `registerCaretipServiceWorker()`; runtime start; `vite:preloadError` handled by the coordinator |
| `src/app/routes.tsx`, `src/app/components/GlobalErrorBoundary.tsx` | Chunk failures go through `handleChunkLoadFailure` |
| `src/app/lib/chunkLoadRecovery.ts` | Also recognises `Unable to preload CSS` |
| `src/app/lib/api.ts` | Read-only `isSessionRefreshInFlight()` (no auth behaviour change) |
| `src/app/lib/startGuestTipCheckout.ts` | Holds `payment:guest-tip-checkout` blocker while creating checkout |
| `src/i18n/locales/en.json`, `de.json` | `shell.deployUpdate.*` notice copy |
| `public/_headers`, `vercel.json` | Cache headers for `/`, `/index.html`, `/version.json`, manifest |
| `public/_redirects`, `public/404.html` (new) | Missing `/assets/*` → real 404 |
| `package.json` | `test:deploy-update-reliability`, `test:deploy-build-artifacts` |
| `scripts/deploy-update-reliability-runtime.ts`, `scripts/deploy-build-artifacts-check.mjs` (new) | Tests |

No backend, auth-token, cookie, OAuth, Stripe, webhook, ledger, DNS or environment-variable changes.
`VITE_LEGACY_API_URL` and the `/api/*` → `caretip.onrender.com` proxy are untouched.

## 11. Mechanisms

### Version identity
`version = <COMMIT_REF first 12>-<BUILD_ID|DEPLOY_ID>` on Netlify (both are set automatically there), so a
"Clear cache and deploy" of the same commit still yields a new id. Locally: git SHA (or `local`) plus a base-36
timestamp. `vite dev` uses `dev`, which disables polling and reload logic entirely. The value is embedded in the
main bundle and written to `dist/version.json` as `{ "version", "buildTime" }` only — no secrets, no env data.

### Detection
- `GET /version.json?t=<now>` with `cache: "no-store"`, `credentials: "omit"`, 8 s timeout.
- Startup check, then every 60 s while visible, at most every 5 min while hidden; on `visibilitychange` → visible,
  `online`, and `pageshow` from bfcache. Checks never overlap.
- Results are shared across tabs: `localStorage["caretip-deploy-version-check"]` (reused if < 45 s old) and a
  `BroadcastChannel("caretip-deploy-update")` with a `storage`-event fallback. Startup and SW-triggered checks
  bypass the shared cache.
- Failed checks (network, timeout, HTTP, invalid body) are logged and ignored; they never trigger a reload.

### Safe reload policy
A newer deployed version is reloaded automatically only when **all** hold:
1. No blocker (first match is logged as the reason):
   `blocker:<name>` (explicit API) → `auth:refresh` (refresh / legacy-session migration in flight) →
   `auth:post-login` → `auth:logout` → `payment:stripe-redirect` (Stripe hand-off hold until `pagehide`; capped at
   5 min so a cancelled hand-off cannot pin the tab) → `request:mutation` (any non-GET `fetch` in flight, ignored
   after 2 min) → `request:mutation-settling` (5 s after such a request settles, covering the body read and the
   follow-up action such as the Stripe redirect).
2. Not on a deferred route: guest tip flow (`/qr`, `/table`, `/staff`, `/tip-amount`, `/payment`, `/success`, …),
   auth/billing callbacks, or any URL carrying payment-return query keys (`session_id`, `payment_intent`,
   `redirect_status`, `checkout`, …).
3. No form input since the last navigation (expires after 30 min).
4. A safe moment: a route change, the tab becoming hidden, or 5 min without user activity and no focused field.
5. Reload budget: at most 2 automatic reloads per deployed version for the whole tab session (`sessionStorage`,
   no time-based reset); without `sessionStorage`, no automatic reload at all.

Otherwise a persistent notice is shown (one toast, replaced in place when its state changes; hidden on the guest
tip journey):

| Notice state | When | EN | DE |
| --- | --- | --- | --- |
| `deferred` | an automatic reload will still happen at a safe moment | "We'll refresh automatically when it's safe." | "Wir laden die Seite automatisch neu, sobald es sicher ist." |
| `manual` | loop guard spent or no `sessionStorage` — no automatic reload will happen | "Refresh to load the latest version. Save any unsaved changes first." | "Bitte die Seite neu laden, um die neueste Version zu nutzen. Ungespeicherte Änderungen vorher sichern." |
| `cleared` | deployed version equals the running one again (rollback) | toast dismissed | toast dismissed |

Title "CareTip has been updated." / "CareTip wurde aktualisiert.", action "Refresh now" / "Jetzt aktualisieren".
"Refresh now" skips the route, idle and loop-guard rules but **waits for blockers** (it reloads as soon as the
last blocker is released), so a click cannot abort a payment, login or save in flight. Before reloading,
the coordinator calls `registration.update()` and waits up to 8 s for a waiting SW to activate, so the reload
gets the new shell rather than the old precache.

Nothing in the update system reads or writes tokens or cookies, clears storage, or signs anyone out; a reload
uses the existing refresh-cookie session restore.

### Blocker API

```ts
import { acquireUpdateBlocker, withUpdateBlocker } from "@/app/lib/deployUpdate/updateBlockers";
import { useUpdateBlocker } from "@/app/lib/deployUpdate/useUpdateBlocker";

// Imperative: release in finally. TTL (default 10 min, max 30 min) is a safety net, not the release path.
const release = acquireUpdateBlocker("payment:guest-tip-checkout", { ttlMs: 2 * 60_000 });
try {
  await createCheckout();
} finally {
  release(); // idempotent
}

// Wrapper
await withUpdateBlocker("kyc:upload", () => uploadDocument(file));

// React: active while the condition is true
useUpdateBlocker("refund:dialog", isRefundDialogOpen);
```

Blockers are per tab; they gate that tab's own reload only. An expired blocker is logged
(`update_deferred`, reason `blocker-expired:<name>`) and dropped.

### Service worker
The existing `generateSW` / `autoUpdate` worker is kept (switching strategy could strand installed PWAs).
`registerSW` is called once (guarded), with `onNeedReload` → coordinator, which replaces the plugin's unconditional
`window.location.reload()` on SW activation (vite-plugin-pwa 1.3.0 `register.js`: `activated` with
`isUpdate || isExternal` → `onNeedReload ?? reload`). The coordinator only runs a version check; an unversioned
bundle does nothing. No other code path registers the Workbox SW or reloads on SW events (in production, FCM push
reuses the Workbox registration via `navigator.serviceWorker.ready` and `importScripts('/fcm-sw-handler.js')`;
its own worker is registered only in dev). `version.json` and `404.html` are excluded from the precache;
`dist/index.html` injects no `registerSW.js`.

### Stale chunks
On a chunk/CSS preload failure (route error boundary, global error boundary, `vite:preloadError`):
1. Fetch `version.json` fresh. Same version → no reload (a real error is shown). Check failed → no reload.
2. Newer version → if `sessionStorage["caretip-deploy-chunk-recovery"]` already records this
   `running → deployed` transition (10 min), stop (`already-attempted`); else record it and reload once.
3. Chunk recovery ignores route deferral (the page is already broken) but still respects blockers.
Missing `/assets/*` now return HTTP 404 instead of `index.html` (200), so the failure is a clean load error.

### Diagnostics
`console.info("[CareTip deploy]", event, fields)` with de-duplication. Events include `running_version`,
`version_check_ok|failed|shared`, `update_detected`, `update_cleared`, `update_deferred` (with reason, including
`blocker-expired:<name>`), `reload_initiated`, `reload_aborted`, `reload_suppressed`, `chunk_recovery_*`. Fields are versions,
triggers and reason codes only — no URLs with query strings, tokens, headers or user data.

## 12. Test evidence (2026-11-02, after the independent review fixes in section 16)

| Check | Result |
| --- | --- |
| `npm run test:deploy-update-reliability` (coordinator, blockers, routes, chunk recovery, cross-tab, SW wiring, notice states, static guards) | 55 passed (48 original, C6 tightened, 7 new G1–G7) |
| `npx tsc --noEmit -p .` | exit 0 |
| ESLint on changed `src/` files and `vite.config.ts` | 0 errors; 1 pre-existing warning (`api.ts:63` unused import, not part of this diff) |
| ESLint on new `scripts/*` | not covered by the project config (`scripts/` is ignored); forcing `--no-ignore` reports Node-global `no-undef` errors identical to existing scripts such as `csp-verify.mjs` |
| `npm run build` with `COMMIT_REF=bf33628a1234567890abcdef BUILD_ID=review-build-2` | exit 0, 395 precache entries |
| `npm run test:deploy-build-artifacts -- --expect-version=bf33628a1234-review-build-2` | ok — `version.json` has only `version`/`buildTime`, version embedded in the main chunk, `version.json`/`404.html` not precached, `index.html` precached, `skipWaiting` present, `dist/_headers` and `dist/_redirects` byte-identical to `public/` |
| csp; navigation-transition-stability; auth-refresh-coordination (38); auth-refresh-reliability-frontend (31); first-party-api-domain-frontend (61); auth-refresh-security (23); auth-logout-session-expired; auth-navigation-session-preservation (13/13); auth-post-login-return; auth-loading-recovery; idle-session-auth-gate; qr-guest-tip-locale; request-demo-calendly (20); pwa-cookie-prompt-stacking; facebook-oauth-session-handoff | all pass |
| white-screen-architecture, landing-hero-return-lifecycle | fail — **verified pre-existing**: run against a pristine `git archive` of `bf33628a`, same assertion (`Component: LandingPage`); eager landing removed by `f30e2510` (2026-10-03) |
| stripe-payments-responsive | 6/10 — **verified pre-existing**: identical 4 failures on pristine `bf33628a` (UI class assertions in business/employee payment pages this branch does not touch) |
| Pre-publish CI-equivalent: `npm run typecheck`, `npm run lint`, `npm run test:xss-audit` | exit 0 / 0 errors (143 pre-existing warnings) / pass |
| Pre-publish build `COMMIT_REF=bf33628a1234567890abcdef BUILD_ID=publish-precheck` + artifact check | exit 0; `deploy-build-artifacts-check: ok (version bf33628a1234-publish-precheck)` |
| `npm run test:csrf-audit` | fail — **verified pre-existing**: (1) `migrateSessionHost` setRefreshCookie handler missing from `scripts/csrf-audit.inventory.json` at `bf33628a` (backend, untouched here); (2) logout `X-CareTip-Client` proximity check fails identically on the `bf33628a` `api.ts` (this branch only adds `isSessionRefreshInFlight`, far from the logout code) |

**Local real-browser smoke test #1 (Chromium in Cursor, `vite preview` of the build — not Netlify, no `_headers`):**
SW registered and controlling; startup check wrote the shared cache. After changing `dist/version.json` to
`sim-build-2` and firing `online` (after the 45 s shared window): `version_check_ok` → `update_detected` →
`update_deferred (user-active)`, German notice visible. Client-side navigation → reload (`navigation.type =
reload`, budget 1). Because only `version.json` changed (bundle still `sim-build-1`), the reloaded page saw the
mismatch again; second navigation → reload (budget 2); third navigation → `update_deferred (reload-budget)` +
`reload_suppressed`, no reload. This confirms the loop guard against a CDN/precache serving old HTML.

**Local real-browser smoke test #2 (same setup, after the review fixes):**
- *SW upgrade path (installed-PWA-like):* the tab still had the previous build's SW; navigation was served the old
  precached shell (`index-Cz98LK6f.js`). The new SW activated → `version_check_ok (trigger: service-worker)` →
  deferred notice; `performance.timeOrigin` unchanged, i.e. **SW activation did not force a reload**.
- The same session also reproduced the defect fixed in G2: the previous build's 30-minute budget window had reset
  and spent a fresh reload for the same version ~30.3 min later.
- *Notice accuracy:* on the new bundle (`index-IyAsqZRc.js`) with the loop guard spent for the pending version,
  the single toast changed in place from "Wir laden die Seite automatisch neu…" to "Bitte die Seite neu laden…";
  a route change logged `reload-budget` / `reload_suppressed` and did not reload. A real click on
  "Jetzt aktualisieren" reloaded (`navigation.type = reload`) without spending budget.

**Not run:** Safari / iOS / Firefox; a real installed (home-screen) PWA; real Netlify deploy and header
verification (incl. whether 404s receive the `/assets/*` header); `auth-refresh-multitab-browser` (needs dev
server + backend); backend, DB, Stripe or webhook suites (no backend changes; would touch shared resources);
a real Stripe test-mode checkout; chunk recovery and multi-tab coordination in a real browser (simulated only).

## 13. Known limitations and remaining risks

- Users can still run a stale deployment: while blocked, on deferred routes, after the reload budget is spent, when
  offline, or until the next poll (≤ 60 s visible, ≤ 5 min hidden).
- **Cached 404 for missing assets (not fixed, not a regression).** Netlify applies custom headers by request path
  only ([docs](https://docs.netlify.com/manage/routing/headers/)), so a 404 for a missing `/assets/*` file also
  carries `public, max-age=31536000, immutable` and a browser may keep that 404. Before this branch the same URL
  returned `index.html` (200) with the same header, which is equally sticky, so this is not worse. It only matters
  if the identical filename later becomes valid again for that browser, i.e. after "Publish deploy" of an older
  Netlify deploy (a rebuild renames chunks; see Rollback). A real fix needs status-aware headers (a Netlify Edge
  Function on `/assets/*` setting `no-store` on 404, or a CDN rule). That is a Netlify production infrastructure
  change with per-request cost and was not made without authorization. `_headers` cannot express it, and removing
  `immutable` from valid assets would regress caching for every visitor.
- `/fonts/*` are not content-hashed but are served immutable (pre-existing).
- Dynamic imports outside routes no longer get their `vite:preloadError` suppressed in versioned builds; they
  surface as rejected promises / error UI instead of a silent reload.
- A tab's blockers only gate its own reload; another tab reloading cannot affect it, but the SW update it triggers
  is shared (the old tab keeps its loaded JS until it reloads).
- Mutation tracking wraps `window.fetch` only. The app has **no `XMLHttpRequest`, axios or `sendBeacon` mutation
  paths** (only a test stub references `XMLHttpRequest`), so no XHR tracking was added. Requests issued in the
  first 2–4.5 s before the runtime starts are not tracked (explicit blockers, the Stripe hold and route deferral
  still apply; the coordinator is not polling yet).
- Mutation tracking is method-based: a non-GET that is not state-changing also defers reloads (conservative).
- A user who stays on a deferred route (e.g. the guest tip journey) is not updated until they leave it.
- Every build changes the main chunk (embedded build id) and therefore most app chunk names, even for a rebuild
  without code changes, so returning visitors re-download app chunks after each deploy (vendor chunks keep their
  names). Deploys with code changes already behaved this way whenever the main chunk changed.
- Real-browser coverage is limited to the two local Chromium smoke tests above.

## 14. Production verification (after an authorized deploy)

```sh
curl -sI https://caretip.de/ | grep -i cache-control            # no-cache, must-revalidate
curl -sI https://caretip.de/index.html | grep -i cache-control  # no-cache, must-revalidate
curl -s  https://caretip.de/version.json                         # {"version":"<sha12>-<buildid>","buildTime":"..."}
curl -sI https://caretip.de/version.json | grep -iE 'cache-control|content-type'  # no-store…, application/json
curl -sI https://caretip.de/assets/does-not-exist.js | head -1  # HTTP/2 404
curl -sI https://caretip.de/manifest.webmanifest | grep -i content-type  # application/manifest+json
curl -sI https://caretip.de/dashboard | grep -i content-type    # text/html (SPA fallback still works)
```

Browser: open the site, note `[CareTip deploy] running_version` in the console, trigger a second deploy, keep the
tab open → within ~60 s `update_detected`; navigate → reload onto the new version (re-check `version.json` vs
console). Repeat on a guest tip page (`/tip-amount`) and confirm neither a reload nor a notice happens there
(`update_deferred route:guest-tip-flow`), and that leaving the journey applies the update. Run a real guest tip in
Stripe test mode on a deploy preview and confirm the hand-off and `/rating?session_id=` return are not interrupted.
Verify login persists across the reload. Repeat in Safari (macOS + iOS) and an installed PWA.

## 15. Rollback

- Code: prefer **roll-forward** — revert the branch's commit(s) and let Netlify build. Because the build id is
  embedded in the main chunk and Rollup hashes include imported chunk names, a fresh build renames most app chunks
  (observed between two local builds: 288 of 347 JS files renamed, including unchanged route chunks such as
  `FAQPage`; only vendor chunks kept their names), so browsers that cached a 404 for an old chunk name are not
  affected. "Publish deploy" of an old
  Netlify deploy is faster but re-serves the old exact filenames; see the cached-404 limitation. No data, session
  or backend migration is involved, so rollback is stateless.
- Old tabs running the new code will detect the rolled-back build id as "different" and move to it under the same
  safe policy (versions are compared for inequality, not ordering).
- If only the 404 rule causes trouble, remove `/assets/*  /404.html  404` from `public/_redirects`.
- Session/local storage keys used (`caretip-deploy-*`) are advisory and safe to leave behind.

## 16. Independent review (2026-11-02)

Scope: every file in the diff, `_headers`/`_redirects`/`netlify.toml`, the Vite/Workbox config, vite-plugin-pwa
1.3.0's `register.js`, the guest/business Stripe flows and all backend Stripe return URLs (read only).

### Issues found and fixed

| # | Severity | Finding | Fix | Regression test |
| --- | --- | --- | --- | --- |
| R1 | High (notice accuracy) | When the loop guard was spent or `sessionStorage` was unavailable, the notice still promised an automatic refresh that would never happen. | Notice has `deferred` / `manual` states; `manual` uses new EN/DE copy; the toast is replaced in place, not stacked. | G1, F8 |
| R2 | High (reload loop) | Reload budget reset after 30 min, so a tab whose new shell never arrives (stuck SW/CDN) reloaded 2× every 30 min indefinitely. Reproduced in the browser (section 12). | Budget is per version for the whole tab session. | G2 |
| R3 | High (payment safety) | "Refresh now" bypassed all blockers, so a click could abort checkout creation, a payment-intent POST, a login or a save. | Manual refresh still skips route/idle/budget rules but waits for blockers, then reloads once. | C6 (tightened), G3 |
| R4 | Medium (payment safety) | `fetch` settles on headers. Business flows (subscription, physical QR order, Connect onboarding) rely on mutation tracking alone, so a hidden tab could reload between the API response and the Stripe redirect. | 5 s `request:mutation-settling` grace after each mutation; re-evaluates when it ends. | G4 |
| R5 | Medium (stuck blocker) | The Stripe hand-off hold has no expiry (ends on `pagehide`); a cancelled hand-off would block automatic updates in that tab forever. | Update system treats the hold as a blocker for at most 5 min per activation; payment code untouched. | G5 |
| R6 | Low (SW bypass) | `handleServiceWorkerUpdated` still called `window.location.reload()` for unversioned bundles. | Unversioned bundles never reload on SW activation. | G6 |

Additional coverage: G7 (20 duplicate/echoed cross-tab messages → one reload; budget holds across page instances).

### Verified without change
- No Stripe.js / Elements in the frontend: card details are submitted only on Stripe-hosted Checkout, Portal and
  Connect pages, outside this app, so a CareTip reload cannot interrupt payment submission. The ~18 in-app
  hand-off call sites (business billing, QR orders, Connect, employee payouts) have no explicit blockers and are
  protected by mutation tracking + settle grace (R4) + the Stripe hold (R5).
- Guest tip checkout: blocker acquired before the API call and released in `finally` on success, failure and
  exceptions; `beginExternalStripeNavigationHold` is set synchronously before `location.assign`, so there is no
  gap. Guest routes and the cancel URL (`/tip-amount?canceled=1`) are deferred and show no notice.
- Every backend Stripe return URL is covered: `/rating?session_id`, `/subscription/success|canceled`,
  `/dashboard/settings?billing=…&session_id`, `/dashboard/qr-studio/…?checkout=`, `/dashboard/stripe/connect?connect=`,
  `/employee/payouts?payoutConnect=`. The portal return `/dashboard/billing/subscription` is not deferred
  (a data-loading page; a reload there is harmless).
- Auth signals are bounded (post-login/logout transitions ≤ 15 s; refresh uses a cross-tab coordination timeout).
- Cross-tab messages are schema-validated; BroadcastChannel and `storage` events deliver live messages only; shared
  cache entries expire after 45 s; storage failures degrade to per-tab polling; blockers are module state per tab.
- Chunk recovery: unchanged version → no reload; offline/failed check → no reload; no `sessionStorage` → no reload;
  one reload per `old→new` transition; blockers respected; nothing clears auth or app data.
- One Workbox registration (guarded); `onNeedReload` is the only plugin reload path in `autoUpdate` mode.

### Not fixed (see section 13)
- Cached 404s under `/assets/*` (requires an Edge Function or CDN rule — production infrastructure, not authorized).
- Real Safari/iOS/installed-PWA/Netlify verification.

## 17. Update UX refinement (2026-11-03) — supersedes the notice, "Refresh now" and superseded-TTL parts of 11–16

### Root causes addressed
- **Two-reload experience:** "Refresh now" reloaded before the new service worker had installed, so the first
  reload could boot the old precached shell; a second reload was needed once the worker activated.
- **Reappearing notice:** completion was tracked by a 10-minute "superseded" window; stale `/version.json`,
  cross-tab or shared-cache signals after the window (or before it was written) could resurrect the notice.
- **Flicker:** the busy notice was shown for every short save (mutation + 5 s settle grace), not only when the user
  had asked to refresh.

### Lifecycle (single source of truth: `updateCoordinator.ts`)
`idle → preparing (detected → installing) → ready → reloading → [new page] verified → idle`, plus `failed`.
- Detection immediately starts `prepareUpdate(target)`. A fast preparation goes straight to *ready*; the
  *preparing* notice appears only after 1.5 s (no flash), or immediately when another notice is already visible.
- Preparation is bounded (90 s). Timeout or failure → *failed* with "Try again"; nothing reloads, the app keeps
  working. A late result of a timed-out attempt is ignored (attempt id). A service-worker activation retries
  silently; the notice stays *failed* until a retry succeeds (no flicker, no repeated error).
- The user's click (*requested*) is remembered. Blockers only produce the *busy* notice when requested; otherwise
  *ready* stays calm. When the last blocker clears, a requested reload runs immediately (synchronously).
- Offline: *offline* notice while preparing/failed, or when ready via network; preparation restarts on `online`.
  No checks and no reloads while offline (a precached build may still reload offline on click).
- Automatic reloads (hidden tab, idle, navigation, chunk recovery) keep the existing policy, but only once *ready*.
  The 5 s mutation settle grace is kept (it protects the checkout-response → Stripe hand-off); it no longer causes
  visible flicker.
- Copy (EN/DE exactly as specified): detected, preparing, ready + "Refresh to update" / "Jetzt aktualisieren",
  busy, offline, failed + "Try again" / "Erneut versuchen", refreshing. Completion shows no toast.

### Service-worker readiness guarantee (`runtime.ts` → `prepareServiceWorkerUpdate`)
- The build stamps `<meta name="caretip-build-version" content="<id>">` into `index.html`
  (`deployVersionPlugin.transformIndexHtml`); the artifact check asserts it matches `version.json`.
- Ready via *service-worker* only when: `registration.update()` ran, an installing/waiting worker reached
  `activated` (redundant → `install-failed`; Workbox install fetches every precache entry first), the active worker
  controls the page, and the precached `/index.html` (`caches.match`, read-only) carries the target id
  (different id → `stale-shell`). A shell without a stamp (rollback to a pre-stamp build) is accepted only after a
  fresh worker/update check.
- Ready via *network* when no service worker controls the page (the reload is served by the network).
- `registerType: 'autoUpdate'` is kept deliberately: switching to a prompt/SKIP_WAITING flow would strand pages
  running the current production bundle, which cannot send SKIP_WAITING, and a waiting worker never activates
  while old tabs stay open.

### Reload behaviour
One click → one synchronous `window.location.reload()` (path, query and history preserved) — no await, poll or
timer. Duplicate clicks and later triggers are ignored while *reloading*. A 15 s watchdog returns to *ready* if the
page did not unload (not counted as completed); a bfcache restore does the same. If the old bundle still boots after
a click (cache race), the page resumes the refresh once ready, at most once (marker `manual: false`), within 2 min.

### Transition tracking (replaces the 10-minute window)
- `sessionStorage` marker `{from, to, at, manual}` before every reload. On boot, `to === running` → transition
  `{from, to, verifiedAt}` appended to `localStorage` `caretip-deploy-transitions` (max 10) and kept in memory.
  The marker alone is never completion.
- Every signal carries `observedAt` (network = now, shared cache = its `at`, cross-tab = message `at`). Ignored:
  signals older than the pending observation (cannot overwrite newer state); relayed signals older than the last
  network confirmation of the running build; signals for a version with a verified `V → running` transition when
  observed before `verifiedAt` or relayed (cross-tab / shared cache / storage fallback).
- A real rollback to `V` is accepted only from network checks at least 2 min apart with no confirmation of the
  running build in between. Newer deployments are always accepted; a newer target replaces a pending one in place.
- Corrupted or unavailable storage is ignored (parsed defensively); without `sessionStorage` there are no automatic
  reloads, the manual refresh still works once.

### Cross-tab
Unchanged transports (BroadcastChannel, `storage` fallback, 45 s shared cache); no new messaging. Each tab prepares,
decides and verifies its own transition; blockers are per tab; a finished tab ignores stale peers; a tab still on the
old build keeps its notice. SW activation only triggers a check / silent retry — never a reload.

### Tests (2026-11-03)
| Suite | Result |
| --- | --- |
| `test:deploy-update-reliability` | 76 passed (new H1–H7 lifecycle, I1–I14 transitions/copy/wiring; C/F/G updated to the new states without weakening safety assertions) |
| auth-refresh-coordination / -reliability-frontend / -security | 38 / 31 / 23 checks ok |
| auth-logout-session-expired, auth-post-login-return, auth-loading-recovery, idle-session-auth-gate | ok |
| navigation-transition-stability, auth-navigation-session-preservation (13/13) | ok |
| stripe-stale-state, pwa-cookie-prompt-stacking, csp | ok |
| white-screen-architecture, landing-hero-return-lifecycle, stripe-payments-responsive (6/10) | fail — pre-existing at base, unrelated (eager landing page, Payments UI classes) |
| qr-guest-tip-locale | not run (needs `DATABASE_URL`; backend email modules) |
| `tsc --noEmit -p .` / ESLint on changed source files | 0 errors |
| `npm run build` + `deploy-build-artifacts-check --expect-version=79486ecf0000-localverify1` | ok; meta present in `index.html` |

**Real browser (Cursor's embedded Chromium, `vite preview`, local — not Netlify):** build 1 served and SW-controlled
on `/login?probe=1`; build 2 built into `dist/` while the tab stayed open. The tab first showed *failed* (detection
raced the non-atomic local rebuild — a real exercise of the failure path); "Erneut versuchen" → *preparing
(installing)* → *ready* ("Jetzt aktualisieren"); the new worker controlled the page and the precached shell was
build 2. Clicking "Jetzt aktualisieren" produced exactly one reload (`navigation.type === "reload"`, same tab) onto
build 2 at `/login?probe=1` (route and query preserved); the reload marker was consumed, transition
`localverify1 → localverify2` was recorded, and no notice was shown. Over the following ~22 minutes there was no
further reload or notice, including after injecting a stale shared-cache entry and a stale BroadcastChannel message
for build 1 and letting the 60 s poll run.

### Limitations / unverified
- Multi-tab, offline, blocker and rollback behaviour verified only in simulated tests, not in a real browser.
  Safari, iOS, installed PWA and Netlify were not tested.
- With `clientsClaim`, an old page's lazy chunks can fail after the new worker claims it; existing chunk recovery
  handles this (waits ≤ 10 s for readiness, respects blockers).
- A CDN persistently serving an old `version.json` for > 2 min is indistinguishable from a rollback; the readiness
  check (shell id must match) still prevents reloading onto a mismatched build.
- The meta stamp exists only from this build on; the first transition away from the current production bundle runs
  the old (pre-refinement) code in those pages.
