# CARETIP — Facebook Sign-In Regression Forensic Audit

**Audit mode:** Read-only (no code, config, schema, or deployment changes made for this report).  
**Report generated:** 2026-10-08 (UTC).  
**Auditor environment:** CareTip repo on Windows; backend `npm run dev` on port 3001; Vite dev server active (terminal evidence).

---

## Executive Summary

Facebook Redirect OAuth **start** is **working** against the local stack: `POST /api/auth/facebook/start` through the Vite proxy (`http://localhost:5173/api/...`) returns **HTTP 302** with a Facebook authorize URL whose `redirect_uri` is **`http://localhost:5173/api/auth/facebook/callback`** (correct same-origin callback architecture).

Backend diagnostic logs for recent user attempts (correlation IDs `fb_web_*` at ~00:04–00:08 UTC) show **`facebook_redirect_started`** only — **no** `facebook_callback_received`, `facebook_redirect_completed`, or `facebook_oauth_failed` entries in captured server logs. That means the **first provable divergence** in this environment is **after start succeeds on the server** and **before (or without) callback processing** — not a failure inside Facebook Graph exchange or account resolution in those attempts.

A **high-confidence regression candidate** in the **uncommitted working tree** is the change in `src/app/lib/facebookOAuthRedirectWeb.ts` that replaced **full-page form POST** with **`fetch(..., { redirect: "manual" })` + `window.location.assign(Location)`**. That path is fragile when the browser cannot read the `Location` header (cross-origin API base / CORS) or when the response is not a visible 302; the code then routes to **`/auth/facebook/complete?error=start_failed`**, which looks like “Facebook sign-in failed” without ever opening Facebook.

**This audit could not complete a full browser OAuth round-trip** (Meta login, callback, cookie `Set-Cookie`, completion refresh) in an automated browser session. **Console evidence from the user’s screenshot was not legible** and is not cited. **Production (caretip.de)** was not exercised from this audit session.

**Primary root cause (single):** **NOT PROVABLE** from available evidence.  
**Best-supported failure class:** **N** (navigation/redirect failure at Facebook start handoff) **or** **B** (callback never executed / not observed) — depending on what the user actually saw.

---

## Reproduction Environment

| Field | Value |
|--------|--------|
| **Scope** | **LOCAL** (proven); **PRODUCTION** not re-tested here |
| **SPA** | `http://localhost:5173` (Vite dev — terminal 3) |
| **API** | `http://localhost:3001` (backend — terminal 4) |
| **Browser-facing API** | `http://localhost:5173/api/*` → Vite proxy → `:3001` |
| **Browser used for audit** | Node `fetch` + `curl.exe` (not interactive Chrome/Firefox) |
| **Facebook app** | App ID visible in authorize URL: `1801849467618260` (public client id) |
| **Working tree** | Uncommitted changes on Facebook redirect + completion + AuthPage (see regression section) |

---

## Exact Reproduction Steps (performed in audit)

1. Ensure backend dev server running (`backend/`, port 3001).
2. Ensure Vite dev server running (port 5173).
3. `POST http://localhost:5173/api/auth/facebook/start` with `Content-Type: application/x-www-form-urlencoded`, body `isLogin=true&returnPath=/login&correlationId=<id>`, headers `Origin: http://localhost:5173`, `X-CareTip-Client: 1`.
4. Observe response status and `Location` header.
5. Repeat with Node `fetch(..., { redirect: "manual" })` to mirror current frontend start implementation.
6. Correlate with backend log lines `[oauth:facebook:diag] ... facebook_redirect_started`.

**Not performed in this audit:** Complete Facebook login in a real browser, callback hit with real `code`, `POST /api/auth/refresh` on completion page with cookies.

---

## OAuth Flow Trace

| Stage | Expected | Actual (local audit evidence) | Status |
|--------|-----------|-------------------------------|--------|
| **1. User clicks Facebook** | `submitFacebookOAuthRedirectStart` invoked | Backend `facebook_redirect_started` for `fb_web_*` correlation IDs | **PASS** (server saw starts) |
| **2. Start** | `POST /api/auth/facebook/start` → 302 → Facebook | `HTTP/1.1 302`; `Location: https://www.facebook.com/...`; `redirect_uri=http://localhost:5173/api/auth/facebook/callback` | **PASS** |
| **3. Facebook auth** | User approves at Meta | **NOT OBSERVED** in audit | **UNKNOWN** |
| **4. Callback** | `GET /api/auth/facebook/callback?code=...&state=...` | **No** `facebook_callback_received` in server logs for `fb_web_*` attempts | **FAIL** / **NOT OBSERVED** |
| **5. Identity** | Code exchange + Graph profile | No callback logs → not reached | **NOT RUN** |
| **6. Account resolution** | `authenticateWithOAuth` | Not reached in logs | **NOT RUN** |
| **7. Session creation** | Refresh token + `Set-Cookie` on callback response | Not reached in logs | **NOT RUN** |
| **8. Cookie** | HttpOnly refresh cookie on **5173** origin (local) | Not verified without full browser callback | **NOT PROVABLE** |
| **9. Completion** | Redirect to `/auth/facebook/complete?success=1` (or error/MFA) | Not observed in logs | **UNKNOWN** |
| **10. Refresh** | `POST /api/auth/refresh` from completion page | Not captured | **NOT PROVABLE** |
| **11. Final navigation** | Dashboard / login MFA | Not captured | **NOT PROVABLE** |

**First divergence (log-based):** Between **successful start (stage 2)** and **callback (stage 4)**.

---

## Browser Console Evidence

**NOT AVAILABLE** for this audit.

- User screenshot referenced in the request is **not legible**; no exact error text, file, or line number can be recorded.
- Vite terminal shows HMR/Fast Refresh messages only — **no Facebook/OAuth console errors** captured.

**Missing evidence:** DevTools console export during a failing Facebook sign-in attempt.

---

## Network Evidence

### `POST /api/auth/facebook/start` (via `localhost:5173`, audit curl)

- **Status:** `302 Found`
- **CORS:** `access-control-allow-origin: http://localhost:5173`, `access-control-allow-credentials: true`
- **Location (redacted tail):** `https://www.facebook.com/v21.0/dialog/oauth?client_id=1801849467618260&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fauth%2Ffacebook%2Fcallback&state=<REDACTED>&scope=email%2Cpublic_profile&response_type=code`
- **Timing:** Sub-second (audit probes)

### Node `fetch` with `redirect: "manual"` (mirrors current `facebookOAuthRedirectWeb.ts`)

- **Status:** `302`
- **Response type:** `basic`
- **`Location` header:** Readable; begins with `https://www.facebook.com/v21.0/dialog/oauth?...`

### User attempts (~00:04–00:08 UTC, backend terminal 4)

- **Observed:** `[oauth:facebook:diag] ... "stage":"facebook_redirect_started"` for three `fb_web_*` correlation IDs.
- **Not observed:** Any callback-stage diagnostics for those IDs.

### Not captured

- `GET /api/auth/facebook/callback`
- `POST /api/auth/facebook/complete`
- `POST /api/auth/refresh`
- `Set-Cookie` headers (would require browser callback completion)

---

## Cookie / Origin Analysis

### Local (expected architecture — **CONFIRMED for start + redirect_uri**)

| Item | Expected | Audit finding |
|------|-----------|---------------|
| SPA origin | `http://localhost:5173` | Used in probes |
| API via proxy | `http://localhost:5173/api/...` | **CONFIRMED** (302 via proxy) |
| Facebook `redirect_uri` | `http://localhost:5173/api/auth/facebook/callback` | **CONFIRMED** in authorize URL |
| Direct `:3001` callback | Should **not** be used for cookie parity in local dev | `resolveFacebookOAuthRedirectUri()` in working tree prefers frontend origin when `NODE_ENV !== "production"` and local hostname (uncommitted backend diff) |

**Split-origin regression (`localhost:3001` callback vs `5173` SPA):** **NOT PROVEN** for current local start responses; `redirect_uri` points at **5173**.

### Production (architecture reference — **not runtime-tested here**)

| Item | Expected |
|------|-----------|
| Callback (API host) | `https://caretip.onrender.com/api/auth/facebook/callback` (when not overridden) |
| Frontend completion | `https://caretip.de/auth/facebook/complete` |
| Netlify | `public/_redirects`: `/api/*` → `https://caretip.onrender.com/api/:splat` **200** (same browser origin `caretip.de` for `/api`) |
| CSP `form-action` | `'self'` on SPA (form POST to same-origin `/api` was previously valid) |

**Production cookie parity:** Requires callback `Set-Cookie` on the **same site** the browser uses for `POST /api/auth/refresh`. With Netlify `/api` rewrite, that is **intended** to be `caretip.de`. **NOT PROVABLE** without a live callback capture.

**Cross-origin `VITE_API_URL`:** If a production build calls `https://caretip.onrender.com` **directly** (bypassing `caretip.de/api`), refresh cookies from callback may not attach to completion-page refresh. `apiOrigin.ts` forces proxy on loopback only; **production may still use absolute API URL** if configured in build env. **NOT VERIFIED** for current Netlify env vars.

---

## Recent Code Regression Analysis

Uncommitted changes (vs `HEAD`) relevant to Facebook sign-in:

| File | Change summary | Regression risk |
|------|----------------|-----------------|
| **`src/app/lib/facebookOAuthRedirectWeb.ts`** | Replaced **hidden form `submit()`** with **`fetch` + `redirect: "manual"`**; failures → `/auth/facebook/complete?error=start_failed` | **HIGH** — If `Location` is unreadable or status is unexpected, user never reaches Facebook; differs from old navigation-following form POST |
| **`src/app/pages/FacebookOAuthCompletePage.tsx`** | 12s refresh timeout; session-specific errors; MFA handoff navigation; handoff cleanup | **MEDIUM** — Failures **after** callback; can show session error or spinner timeout |
| **`src/app/components/AuthPage.tsx`** | Consumes `location.state.mfaChallenge` | **LOW/MEDIUM** — Fixes MFA handoff; unlikely to break non-MFA login |
| **`backend/.../facebookOAuthRedirect.service.ts`** | Local dev `redirect_uri` → frontend `/api/auth/facebook/callback` | **LOW** for local — aligns cookie origin; wrong `FRONTEND_URL` could misconfigure URI |

**Last committed Facebook redirect feature:** `f4b5c7e1` — “Add Facebook OAuth authorization-code redirect flow.”

**Automated tests (prior session, not re-run in this audit):** `npm run test:facebook-oauth-redirect` reported all passed; does not cover browser `fetch` start handoff.

---

## Failure Classification

| Class | Applicability | Confidence |
|-------|----------------|------------|
| **A** Facebook authorization failure | Possible if user cancelled at Meta | **NOT PROVABLE** |
| **B** Callback failure | No callback logs for user attempts | **HIGH** that callback **did not run or was not logged** for those attempts |
| **C–F** Exchange / identity / account | No callback → not reached | **N/A** for logged attempts |
| **G** MFA handoff | Only if callback succeeded with MFA | **NOT PROVABLE** |
| **H–J** Session/cookie creation / origin | Requires successful callback + browser cookies | **NOT PROVABLE** |
| **K** `FacebookOAuthCompletePage` | If user lands on `start_failed` or session error | **POSSIBLE** (new UX paths) |
| **L** `refreshSessionAPI` failure | After `success=1` | **POSSIBLE** (historical issue: `caretip_session_revoked`; completion page clears it in working tree) |
| **M** Bootstrap failure | After refresh | **NOT PROVABLE** |
| **N** Navigation/redirect at start | `fetch` handoff vs form POST | **HIGH CONFIDENCE** as **candidate** when `Location` not applied |
| **O** CSP/CORS | Local start returns CORS headers; fetch works in Node | **LOW** for local same-origin; **MEDIUM** for cross-origin API production |
| **P** Environment/config | `FACEBOOK_OAUTH_REDIRECT_URI`, Meta app settings, `FRONTEND_URL` | **POSSIBLE** if callback never hits server |
| **Q** Unknown | Full browser failure without DevTools | **YES** until user provides network/console capture |

**Selected primary label for reporting:** **Q** (insufficient end-to-end evidence) with **secondary N** and **B**.

---

## Root Cause

### Primary (single)

**NOT PROVABLE** from static + partial server logs alone.

The **earliest supported divergence** in captured backend evidence is: **start succeeds → callback diagnostics never appear** for the same user sessions.

### Secondary / contributing factors (ranked)

1. **HIGH CONFIDENCE — Frontend start handoff change (`facebookOAuthRedirectWeb.ts`):** Async `fetch` + manual redirect may send users to **`start_failed`** without Facebook when `Location` is missing (e.g. cross-origin API, opaque redirect, proxy quirks). Old **form POST** followed 302 without reading `Location`.

2. **HIGH CONFIDENCE — Incomplete OAuth round-trip in logs:** User may not have completed Meta consent, or callback URL blocked/misconfigured in Meta app, or browser never returned to `/api/auth/facebook/callback`.

3. **MEDIUM CONFIDENCE — Post-callback session refresh (historical):** Prior audit: refresh 401 when `caretip_session_revoked` blocked refresh; working tree calls `clearClientSessionRevoked()` before refresh on completion — if user tests **without** that change deployed, “Facebook failed” may be session establishment.

4. **MEDIUM CONFIDENCE — MFA path:** Before `AuthPage` mfaChallenge hydration, MFA users could land on plain login; working tree includes fix — regression may present as “login failed” after Facebook.

5. **LOW CONFIDENCE — Local vs production mismatch:** Testing local against production Meta redirect URIs or vice versa.

---

## Confidence

| Conclusion | Level |
|------------|--------|
| Local start + correct `redirect_uri` on 5173 | **CONFIRMED** |
| User start requests reached backend | **CONFIRMED** (diag logs) |
| Callback ran for those user attempts | **NOT PROVABLE** (no logs) |
| `fetch` manual redirect works on same-origin 5173 | **CONFIRMED** (Node probe) |
| `fetch` start change caused user-visible regression | **HIGH CONFIDENCE** (mechanism) but **NOT PROVEN** for their session |
| Production failure | **NOT PROVABLE** (not tested) |

---

## Recommended Fix (describe only — **do not implement in this audit**)

1. **Smallest safe fix for start handoff:** Restore **same-origin full-page form POST** for the **success path** (302 → browser navigates to Facebook), while keeping **fetch-or-navigate** only to detect errors and route to `/auth/facebook/complete?error=start_failed` **without** relying on reading `Location` cross-origin. Alternatively: keep `fetch` but if `status` is 302/opaque, fall back to **one** form POST submit (no architecture change on server).

2. **Verify in browser (required before any fix merge):** One HAR capture of failing attempt: start → Facebook → callback → complete → refresh, with **redacted** cookies/tokens.

3. **If failure is post-callback:** Confirm `Set-Cookie` on callback response at browser origin used for refresh; confirm `POST /api/auth/refresh` status on completion page (401 vs 503 vs timeout).

4. **Meta console:** Ensure `http://localhost:5173/api/auth/facebook/callback` and production callback URLs match `redirect_uri` emitted by start.

**Do not:** Revert to popup SDK, weaken CSP, move tokens to localStorage, or change OAuth state/session architecture.

---

## What Must NOT Be Changed

- Facebook Redirect OAuth flow and endpoints (`/start`, `/start/link`, `/callback`, `/complete`)
- DB-backed single-use OAuth state and TTL
- Server-side code exchange and Graph identity lookup
- `authenticateWithOAuth` / OAuthAccount rules
- JWT + HttpOnly refresh cookie model
- Auth/MFA middleware and role/tenant rules
- Meta app configuration (except validating redirect URI list operationally)
- CSP `form-action 'self'` policy (fix client handoff, not CSP)

---

## Verification Plan (after a fix)

1. **Local:** From `/login`, click Facebook → must land on `facebook.com` dialog → approve → callback URL `http://localhost:5173/api/auth/facebook/callback` → `/auth/facebook/complete?success=1` → `POST /api/auth/refresh` **200** → dashboard (or MFA UI if applicable).
2. **Start failure:** Force 503 on start → must see CareTip completion **`start_failed`** UI, not JSON.
3. **Production:** Same matrix on `https://caretip.de` with Netlify `/api` proxy; confirm refresh cookie on `caretip.de` and refresh includes credentials.
4. **Regression guard:** Add Playwright test mocking `POST /api/auth/facebook/start` returning 302 with `Location` header, assert `window.location` assigned to Facebook URL (or network navigation).

---

## Audit Success Criteria (answers)

| # | Question | Answer |
|---|----------|--------|
| 1 | Does Facebook authorization itself succeed? | **NOT PROVABLE** (no completed browser flow captured) |
| 2 | Does the callback execute? | **NOT OBSERVED** in server logs for `fb_web_*` attempts |
| 3 | Does Facebook identity resolution succeed? | **NOT REACHED** in evidence |
| 4 | Does CareTip identify the correct account? | **NOT REACHED** |
| 5 | Does CareTip create the authenticated session? | **NOT REACHED** |
| 6 | Is the refresh cookie created? | **NOT PROVABLE** |
| 7 | Is cookie available on refresh origin? | **NOT PROVEN** (architecture correct for local `redirect_uri`) |
| 8 | Does `refreshSessionAPI()` succeed? | **NOT CAPTURED** |
| 9 | Does MFA interfere? | **POSSIBLE**; working tree has handoff fix — **NOT RUNTIME VERIFIED** |
| 10 | Does completion navigate correctly? | **NOT CAPTURED** |
| 11 | Exact request/error for user-visible failure? | **MISSING** — need DevTools Network + console |
| 12 | Recent CareTip change introduced regression? | **HIGH CONFIDENCE candidate:** `facebookOAuthRedirectWeb.ts` fetch handoff (uncommitted) |

---

## LOCAL vs PRODUCTION

| Environment | Status in this audit |
|-------------|----------------------|
| **LOCAL** | Start + `redirect_uri` verified; callback/refresh **not** verified in browser |
| **PRODUCTION** | **Not tested**; architecture documented from config files only |
| **BOTH** | Cannot claim same root cause without user environment details |

---

*End of report.*
