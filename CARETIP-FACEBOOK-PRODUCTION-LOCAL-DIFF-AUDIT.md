# CARETIP — Facebook OAuth Local vs Production Forensic Comparison

**Audit date:** 2026-10-08  
**Mode:** Read-only (no code, infra, deploy, commit, or push changes)  
**Repo HEAD on `company`/`main` (last push):** `085456ed` — *Pin backend lockfile for npm audit override resolutions.*  
**Local working tree:** Uncommitted observability-only edits (not on production).

---

## Executive Summary

Production **can** reach Facebook: a live `POST https://caretip.de/api/auth/facebook/start` (with `Origin: https://caretip.de`) returns **302** to `facebook.com` via Netlify → Render (`X-Render-Origin-Server: Render`). The live production bundle **`/assets/index-CpFJTPAW.js`** (from `https://caretip.de/login`) implements **same-origin form POST** (`form.method = "POST"`, `form.action = "/api/auth/facebook/start"`, `form.submit()`). It does **not** contain `fetch(..., { redirect: "manual" })`.

The query parameter **`error=start_failed`** is generated **only on the client** by `navigateToFacebookStartFailure()` in `facebookOAuthRedirectWeb.ts`. The backend **never** emits `start_failed` on `/auth/facebook/complete` (callback failures use codes such as `cancelled`, `state_invalid`, `session_failed`, etc.).

**HIGH CONFIDENCE:** If the user truly lands on `?error=start_failed` **in the same navigation as a successful form POST that already opened Facebook in the same tab**, that would contradict the current source model (the start-failure handler runs only on CSP `form-action` violation or `form.submit()` throw on the **login/signup document**). **HIGH CONFIDENCE** alternative: `start_failed` appears on a **later** visit to login/signup (retry, back-forward, or second click), while an **earlier** step in the same user session successfully reached Facebook.

**NOT PROVABLE from this audit:** Render request logs, full Chrome/Firefox HAR timelines, or whether `start_failed` occurred before vs after Facebook without a preserved Network log from the tester.

---

## Exact Production Flow (expected, from code + live probes)

| Step | What happens |
|------|----------------|
| 1 | User on `https://caretip.de/login` or `/signup` |
| 2 | Facebook button → `OAuthProviderRow.runFacebookLogin` → `submitFacebookOAuthRedirectStart(..., "/api/auth/facebook/start", onSubmitFailed)` |
| 3 | Hidden **POST** to **`/api/auth/facebook/start`** (same origin) |
| 4 | Netlify proxies to Render (`public/_redirects`: `/api/*` → `https://caretip.onrender.com/api/:splat`) |
| 5 | Render **302** → `https://www.facebook.com/.../dialog/oauth` (live probe confirmed) |
| 6 | User authorizes on Facebook |
| 7 | Facebook **GET** → `https://caretip.onrender.com/api/auth/facebook/callback` (not `caretip.de/api/...` per `resolveFacebookOAuthRedirectUri()` in production) |
| 8 | Backend processes callback → **302** → `https://caretip.de/auth/facebook/complete?...` (`success=1`, `completion=...`, or `error=<backend code>`) |
| 9 | SPA refresh / MFA handoff as implemented |

**Where `start_failed` fits:** Only if step 3’s **client-side** submit is treated as failed **without** leaving the login/signup document (CSP block or `submit()` exception), **or** on a **new** attempt from login/signup that fails client-side—not from callback completion URLs.

**Mandatory timing classification (requires tester Network + timestamps):**

| Case | Description | Consistent with code? |
|------|-------------|------------------------|
| **A** | `start_failed` before Facebook opens | **YES** — CSP / `submit()` failure |
| **B** | While Facebook is opening | **POSSIBLE** only if violation fires on same document before unload; **NOT PROVABLE** without trace |
| **C** | After Facebook authorization | **NO** for `start_failed` specifically — backend uses other `error=` values |
| **D** | After return to CareTip (callback/complete) | **NO** for `start_failed` — unless user navigates to login and triggers a **new** client start failure |

---

## Exact Local Flow (expected, from code)

| Step | What happens |
|------|----------------|
| 1 | User on `http://localhost:5173/login` or `/signup` |
| 2 | Same `OAuthProviderRow` + `submitFacebookOAuthRedirectStart` |
| 3 | POST **`http://localhost:5173/api/auth/facebook/start`** (Vite proxy; `resolveApiBaseUrl()` returns `""` on loopback) |
| 4 | Backend **302** → Facebook |
| 5 | Callback **`http://localhost:5173/api/auth/facebook/callback`** (dev redirect URI via frontend origin) |
| 6 | Complete → `/auth/facebook/complete?...` on **5173** |

Local success reported by team; production can reach Facebook but may still end on `start_failed` on a **different** step or attempt.

---

## Where Local and Production Diverge

| Area | Local | Production |
|------|-------|------------|
| **Facebook callback host** | `localhost:5173/api/.../callback` (proxied) | `caretip.onrender.com/api/.../callback` (direct to Render) |
| **Browser start URL** | `/api/auth/facebook/start` on **5173** | `/api/auth/facebook/start` on **caretip.de** (proxied) |
| **API base for `fetch()` API client** | Same-origin `/api` (proxy) | `VITE_API_URL` → cross-origin Render for XHR (unchanged; **not** used for OAuth form `action` in deployed `085456ed`) |
| **CSP `form-action`** | Vite dev / `scripts/spa-csp-policy.mjs` — `'self'` | `public/_headers` / Netlify — `'self'` |
| **Deployed frontend commit** | Working tree (+ uncommitted logs) | Netlify build from **`085456ed`** (bundle hash **`index-CpFJTPAW.js`** at time of audit) |
| **Observability** | Uncommitted `[CareTip:FacebookOAuth]` / `[facebook-oauth-start]` | **Not deployed** — production lacks those logs |

---

## Comparison Table (evidence-based cells only)

| | Local | Production |
|---|---|---|
| **Facebook start helper** | `submitFacebookOAuthRedirectStart` in `facebookOAuthRedirectWeb.ts` | Same module in bundle (`O6` in `index-CpFJTPAW.js`: POST form, `action` = path arg) |
| **Signup Facebook handler** | `AuthOAuthButtons` → `OAuthProviderRow` + `facebookRedirectContext` (`isLogin: false`) | Same (bundled) |
| **Signin Facebook handler** | Same row (`isLogin: true`) | Same (bundled) |
| **API URL (form start)** | `/api/auth/facebook/start` on page origin | `/api/auth/facebook/start` on `caretip.de` |
| **/api proxy** | Vite → `:3001` | Netlify → `caretip.onrender.com` (live 302 observed) |
| **Callback URL** | `http://localhost:5173/api/auth/facebook/callback` (service logic) | `https://caretip.onrender.com/api/auth/facebook/callback` (from live `Location` on start probe; values redacted in this doc) |
| **Completion URL** | `{frontend}/auth/facebook/complete` | `https://caretip.de/auth/facebook/complete` |
| **Redirect handling** | Browser follows 302 after form POST | Same (live probe: 302 to Facebook) |
| **Environment** | `import.meta.env.DEV` | Production build |
| **Deployed commit** | N/A (dev) | **`085456ed`** (last pushed; HTML references `index-CpFJTPAW.js`) |
| **JS bundle** | Dev modules / local build | **`/assets/index-CpFJTPAW.js`** (~715 KB, fetched 2026-10-08) |

---

## `start_failed` Call Graph

### Constant

- `FACEBOOK_OAUTH_START_FAILED_ERROR = "start_failed"` — `src/app/lib/facebookOAuthRedirectWeb.ts`

### Sole navigation to `?error=start_failed`

```
navigateToFacebookStartFailure()
  → window.location.assign(`/auth/facebook/complete?error=start_failed`)
```

**Callers (deployed `085456ed` and current source):**

```
submitFacebookOAuthRedirectStart(..., onSubmitFailed?)
  → notifySubmitFailed() / failStart() [local uncommitted only]
      → navigateToFacebookStartFailure()
```

**Conditions:**

1. **`securitypolicyviolation`** with `effectiveDirective === "form-action"` and `blockedURI` containing `"/api/auth/facebook/start"` (only registered when `onSubmitFailed` is passed).
2. **`form.submit()`** throws → `catch` → `notifySubmitFailed()`.

**Who passes `onSubmitFailed`:**

| Caller | File | Flow |
|--------|------|------|
| Signup / Signin | `OAuthProviderRow.tsx` | `() => setProviderBusy(null)` |
| Link account | `LinkedOAuthAccountsSection.tsx` | same pattern |

**Consumers of `start_failed` (display only, no navigation):**

- `FacebookOAuthCompletePage.tsx` — i18n `facebookRedirectStartFailed` / `facebookRedirectStartErrorTitle`

**Backend:** **no** references to `start_failed`.

**Conclusion:** **CONFIRMED** — no server path can set `start_failed`. **CONFIRMED** — callback-stage failures cannot masquerade as `start_failed` without a separate client navigation to that URL.

---

## Network Evidence (automated probes, 2026-10-08)

### `POST https://caretip.de/api/auth/facebook/start`

- **Status:** `302 Found`
- **Proxy:** `Server: Netlify`, `X-Render-Origin-Server: Render`
- **CORS:** `Access-Control-Allow-Origin: https://caretip.de`
- **Result:** `Location` points to `https://www.facebook.com/.../dialog/oauth` (query parameters omitted here; no codes logged)

### Production login HTML

- **Entry script:** `/assets/index-CpFJTPAW.js` (module)
- **Cache:** `Cache-Control: public,max-age=0,must-revalidate` on HTML

### Bundle string analysis (`index-CpFJTPAW.js`)

| Pattern | Present? |
|---------|----------|
| `start_failed` | Yes (1) |
| `redirect:"manual"` / `redirect: "manual"` | No |
| `/api/auth/facebook/start` | Yes |
| `securitypolicyviolation` | Yes |
| `getApiAbsoluteUrl` | Yes (elsewhere in bundle; OAuth start uses direct `form.action = <path>`) |
| Minified `form.submit()` | Yes (`.submit()` in OAuth snippet) |

**Tester should still capture (manual):** Preserve-log sequence for signup vs signin: start POST status, Facebook document, callback GET status, complete URL, refresh POST status—**without** logging tokens, codes, state, or cookies.

---

## Render Evidence

**NOT PROVABLE** from this environment (no Render log access).

**Expected if start POST reached Render:**

- HTTP access log: `POST /api/auth/facebook/start` → 302  
- Existing diag prefix: `[oauth:facebook:diag]` with `facebook_redirect_started` (service) — **not** the uncommitted `[facebook-oauth-start]` lines (not deployed).

**Expected if user completed Facebook:**

- `GET /api/auth/facebook/callback` → 302 to `caretip.de/auth/facebook/complete?...`

**Correlation:** Frontend sends `correlationId` in form body (`fb_web_*`); match in Render diag logs if present.

---

## Netlify Evidence

**CONFIRMED:** `/api/*` rewrite to Render (`public/_redirects`).  
**CONFIRMED:** Live POST to `/api/auth/facebook/start` returns **302** with Render backend headers.

---

## Production Bundle Evidence

- **File:** `https://caretip.de/assets/index-CpFJTPAW.js`
- **Implementation:** Form POST OAuth start aligned with git `085456ed` `facebookOAuthRedirectWeb.ts`
- **Not present:** `fetch` + `redirect: "manual"` for this flow
- **Source maps:** Not fetched; module names minified (`O6`, `N6`, `C6` SDK path)

---

## Cache / Service Worker Evidence

| Mechanism | Production finding |
|-----------|-------------------|
| **HTML caching** | `max-age=0, must-revalidate` on `/login` |
| **Vite PWA / Workbox** | App precaches JS/CSS/HTML (`cacheId: caretip-pwa-v13`, `registerType: autoUpdate`) — **stale shell possible** until SW update |
| **`navigateFallbackDenylist`** | Includes `/api` — API not SPA-fallback |
| **FCM SW** | `/firebase-messaging-sw.js` — push scope `/firebase-cloud-messaging-push-scope` (not full-app OAuth interceptor) |

**POSSIBLE:** Chrome vs Firefox differ if one has an older precached `index-*.js`. **NOT PROVABLE** without comparing `index-*.js` hashes per browser. Do **not** clear caches as part of this audit.

---

## Chrome vs Firefox Evidence

**NOT PROVABLE** here. Recommended: compare loaded `index-*.js` filename/hash and whether `start_failed` appears with or without an intervening Facebook/callback request in Preserve log.

---

## Root Cause Classification

| Hypothesis | Classification |
|------------|----------------|
| Production still uses `fetch` + `manual` redirect for start | **NOT SUPPORTED** — bundle + `085456ed` source use form POST |
| Netlify blocks OAuth start entirely | **NOT SUPPORTED** — live 302 to Facebook |
| `start_failed` means backend/callback failure | **CONFIRMED FALSE** — client-only constant |
| `start_failed` after successful same-tab Facebook open on **same** click | **LOW / contradicts model** — investigate timing with Preserve log |
| `start_failed` on **retry** or **login page** after callback/other errors | **HIGH CONFIDENCE** — matches call graph |
| CSP `form-action` blocks submit (no Facebook) | **POSSIBLE** for failed attempts — would not open Facebook |
| Stale PWA/JS bundle on one browser | **POSSIBLE** — verify bundle hash |
| Callback on Render misconfigured vs Facebook app | **POSSIBLE** for post-Facebook failures — would **not** use `start_failed` |
| Uncommitted observability not on prod | **CONFIRMED** — harder to debug prod without deploy |

---

## Recommended Minimal Fix (DO NOT IMPLEMENT IN THIS AUDIT)

1. **Prove timing:** One production signup + one signin with Preserve log; note whether `start_failed` URL appears **without** any Facebook document request between login and complete.
2. **If `start_failed` is client-only on retry:** Inspect why CSP/`submit()` fails on `caretip.de` (e.g. `form-action` vs actual `blockedURI` in console) — deploy uncommitted `[CareTip:FacebookOAuth]` logging to capture `priorStartFailure` on complete page.
3. **If failure is post-Facebook with other `error=` codes:** Debug Render callback + Facebook app redirect URI (production uses **Render** callback URL, not `caretip.de/api/...`).
4. **PWA:** Confirm both browsers load the same `index-*.js` after deploy.

---

## Appendix — Signup vs Signin Identification

| Flow | `flow` in logs (uncommitted) | Form fields |
|------|------------------------------|-------------|
| Signin | `signin` | `isLogin=true` |
| Signup | `signup` | `isLogin=false` + role/invite/legal fields |
| Link | `link` | `/api/auth/facebook/start/link` + `flow=link` |

Deployed production does not yet emit structured `[CareTip:FacebookOAuth]` lines; use Network + Render `correlationId` in form body until observability is deployed.
