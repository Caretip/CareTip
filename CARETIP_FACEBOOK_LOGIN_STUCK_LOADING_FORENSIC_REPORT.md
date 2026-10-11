# CareTip — Facebook Login & Meta Email Permission Stuck Loading Forensic Report

**Date:** 2026-10-05  
**Scope:** Forensic / configuration investigation only — **no code, env, Meta, or deployment changes in this pass.**  
**Status:** **ROOT CAUSE CONFIRMED — READY FOR MINIMAL REMEDIATION**

---

## 1. Executive summary

CareTip’s Facebook web flow uses the **JavaScript SDK** (`FB.init` + `FB.login` with `scope: "email,public_profile"`). There is **no** server-built Facebook authorize URL and **no** `/api/auth/facebook/callback` route.

Two independent blockers explain the reported behavior:

| # | Issue | Evidence strength | Effect |
|---|--------|-------------------|--------|
| **A** | **Production CSP blocks Facebook** | **Proven** (live `Content-Security-Policy` on `https://caretip.de/login`) | `connect.facebook.net` is not in `script-src`; `www.facebook.com` / `facebook.com` are not in `frame-src`; Graph/connect hosts are not in `connect-src`. Facebook Login cannot run correctly on Netlify production. |
| **B** | **Meta `email` use-case / dashboard configuration** | **Strong** (code + Meta community patterns; dashboard not directly accessible in this pass) | Requesting `email` in `FB.login` when the app’s **Authentication & account creation** use case does not include `email` commonly yields Meta’s **“Sorry, something went wrong”** in the login dialog. The **Permissions and features → Add email** UI error is a **known Meta dashboard issue** and does **not** prove `email` is disabled — it may already be implicit or must be added under **Use cases**, not “Add” on extended permissions. |
| **C** | **Local Vite App ID wiring** | **Proven** (repo `.env` at audit time) | Web reads **`VITE_FACEBOOK_APP_ID` only** (`oauthProviderIds.ts`). Root `.env` had active `FACEBOOK_APP_ID` but **`VITE_FACEBOOK_APP_ID` commented** — local `import.meta.env` would not receive the App ID unless set elsewhere (e.g. shell, uncommitted `.env.local`, or Netlify-only). |
| **D** | **SDK loader edge case (code)** | **Code review** | If `sdk.js` is already in the DOM but `window.FB` is not ready, `loadFacebookSdk()` can **return without resolving or rejecting**, leaving `providerBusy === "facebook"` until refresh (**permanent button spinner**). |

**Production** failure mode aligns with **(A)** plus likely **(B)** once CSP is fixed. **Local** may differ: dev server typically **does not** send Netlify CSP headers, so Facebook may reach the dialog — then **(B)** or **(C)** dominate.

**Smallest remediation (next pass, not applied here):**

1. **CSP:** Allow Facebook in `scripts/spa-csp-policy.mjs` → sync `public/_headers` and `vercel.json` (`script-src`, `frame-src`, `connect-src` for `connect.facebook.net`, `www.facebook.com`, `graph.facebook.com` as required by SDK/dialog).
2. **Netlify:** Redeploy after CSP sync (headers already ship from `public/_headers` on build).
3. **Local env:** Set **`VITE_FACEBOOK_APP_ID`** to the same numeric App ID as `FACEBOOK_APP_ID` (Vite does not read backend-only names).
4. **Render / API:** Keep **`FACEBOOK_APP_ID`** + **`FACEBOOK_APP_SECRET`** (or `META_*` aliases) for `debug_token` + `/me` verification — secret was **present** at audit time; value not recorded here.
5. **Meta:** Enable **`email`** under **Use cases → Authentication and account creation** (not only “Permissions and features → Add”). Use **Development** mode test users; retry login dialog after save. If “Add email” still errors, treat as Meta UI bug if login dialog grants `email` to testers.

---

## 2. Exact step where the flow stops

### Web flow map (code)

| Step | Location | Notes |
|------|-----------|--------|
| 1 | `OAuthProviderRow` | Facebook button; `showFacebook = Boolean(facebookOAuthWebAppId())` |
| 2 | `runProvider("facebook")` | `setProviderBusy("facebook")` → spinner on icon |
| 3 | `requestFacebookAccessToken()` | `facebookOAuthWeb.ts` |
| 4 | Load SDK | `https://connect.facebook.net/en_US/sdk.js` |
| 5 | `FB.init({ appId, cookie: true, version: "v21.0" })` | No `redirect_uri` |
| 6 | `FB.getLoginStatus` | **Not called** in CareTip (only typed on SDK interface) |
| 7 | `FB.login(callback, { scope: "email,public_profile", return_scopes: true })` | |
| 8 | Callback | Requires `status === "connected"` and `authResponse.accessToken` |
| 9 | `onSocialCredential("facebook", token)` | Fire-and-forget `void runSocialOAuth(...)` |
| 10 | `oauthAPI` → `POST /api/auth/oauth` | `api.ts` |
| 11 | `facebookVerifier.ts` | JWT **or** `debug_token` + `GET graph.facebook.com/me?fields=id,name,email` |
| 12 | `oauthAuth.service.ts` | Login by OAuth subject; signup requires email |
| 13 | Session | Refresh cookie + access token; `useAuth.loginWithOAuth` |
| 14 | `AuthPage.runSocialOAuth` | `beginAuthSignInHandoff`, redirect after auth |

### Where execution stops (by environment)

**Production (`https://caretip.de`, Netlify CSP):**

- **Stops at step 4–7 (Facebook SDK / dialog)** — CSP prevents loading or framing Facebook resources (see §4–5). CareTip **`POST /api/auth/oauth`** is not expected to run until a token is returned.
- If CSP were fixed but **`email` scope** is invalid for the Meta app, stop is at **step 7 (Meta login dialog)** with Meta generic error — category **B**, not CareTip backend.

**Local (`vite` dev, default port 5173):**

- CSP from `public/_headers` is **not** applied by Vite dev server in the normal `npm run dev` path.
- If **`VITE_FACEBOOK_APP_ID` is unset**, stop is at **step 1** (button hidden) — unless env is injected another way.
- If App ID is set but Meta rejects `email` scope, stop at **step 7** (dialog error / no token).
- If SDK script tag race hits the **non-resolving branch** in `loadFacebookSdk`, stop at **step 4** with **button spinner only** (category **F** subset).

**Failure category (requested taxonomy):**

- Production: **A** (SDK blocked by CSP) and/or **B** (Meta dialog / email scope).
- Not **D/E** until a token reaches the API (no evidence of `/api/auth/oauth` Facebook traffic in this pass without user HAR).
- **F** possible locally via SDK promise hang; **G** only after token + successful API (handoff overlay).

---

## 3. Console evidence

**This pass did not run an interactive browser session** (no DevTools capture attached). Expected console signatures given proven CSP:

| Symptom | Likely console message |
|---------|-------------------------|
| CSP blocks SDK script | `Refused to load the script 'https://connect.facebook.net/...' because it violates Content Security Policy` |
| CSP blocks dialog | `Refused to frame 'https://www.facebook.com/...' because it violates Content Security Policy` |
| CSP blocks Graph | `Refused to connect to 'https://graph.facebook.com/...'` (after token, if SDK partially worked) |
| Meta email / use case | Meta page text: **“Sorry, something went wrong”** (in Facebook tab/dialog, not CareTip console) |
| SDK hang (code path) | No error; promise never settles; React state `providerBusy === "facebook"` |

**Recommended capture for follow-up:** one login attempt on `https://caretip.de/login` with Console filtered by `facebook`, `CSP`, `Refused`.

---

## 4. Network evidence

### Live production headers (2026-10-05)

**Request:** `HEAD https://caretip.de/login`  
**Server:** Netlify  
**`Content-Security-Policy` (abbreviated):**

- `script-src`: `'self'`, `accounts.google.com`, `www.gstatic.com`, `assets.calendly.com` — **no `connect.facebook.net`**
- `frame-src`: `accounts.google.com`, `calendly.com`, `*.calendly.com` — **no `facebook.com`**
- `connect-src`: CareTip, Onrender, Google, Firebase, Sentry, Calendly — **no `graph.facebook.com` / `connect.facebook.net` / `www.facebook.com`**

Source of truth in repo: `scripts/spa-csp-policy.mjs` → copied to `public/_headers` (Netlify) and `vercel.json`.

### Expected network sequence (when working)

| URL | Role | Production (current CSP) |
|-----|------|---------------------------|
| `https://connect.facebook.net/en_US/sdk.js` | SDK load | **Blocked** by `script-src` |
| `https://www.facebook.com/.../dialog/oauth...` | Login UI | **Blocked** by `frame-src` if dialog opens |
| `https://graph.facebook.com/...` | Token / me (SDK or API) | **Blocked** by `connect-src` in page context |
| `POST /api/auth/oauth` (CareTip API) | Backend auth | Not reached without token |

No access tokens or secrets were captured.

### Production build / App ID injection

- Downloaded `https://caretip.de/assets/index-*.js` (hash from live `/login` HTML).
- Bundle contains `connect.facebook.net/en_US/sdk.js` string and inlined numeric App ID (same family as backend `FACEBOOK_APP_ID` configured in repo env files).
- **Conclusion:** Netlify **`VITE_FACEBOOK_APP_ID` is present at build time** for production; frontend is not missing App ID in the deployed artifact.

---

## 5. Facebook SDK initialization evidence

| Check | Result |
|-------|--------|
| `FB.init` `appId` source | `import.meta.env.VITE_FACEBOOK_APP_ID` via `facebookOAuthWebAppId()` |
| `FB.init` version | `v21.0` |
| `redirect_uri` in code | **None** |
| `getLoginStatus` | **Not used** |
| `FB.login` scope | **`email,public_profile`** (`return_scopes: true`) |

---

## 6. Runtime App ID presence / match

| Environment | Variable(s) | Audit result |
|-------------|-------------|--------------|
| **Web (Vite)** | `VITE_FACEBOOK_APP_ID` | **Production bundle:** App ID **present** (inlined). **Repo root `.env`:** `VITE_FACEBOOK_APP_ID` **commented**; `FACEBOOK_APP_ID` **set** — Vite **does not** read `FACEBOOK_APP_ID` for the SPA. |
| **API** | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` (or `META_*`) | **Backend `.env`:** App ID **present** (numeric); App Secret **configured** (value not disclosed). |
| **Match** | Same Meta app for web + API | **Expected match** when `VITE_FACEBOOK_APP_ID` equals `FACEBOOK_APP_ID`; production build aligns with backend ID family. |

Do not duplicate env names: web **`VITE_FACEBOOK_APP_ID`** only; API **`FACEBOOK_APP_ID`** + **`FACEBOOK_APP_SECRET`**.

---

## 7. Local result

| Test | Expected at audit time |
|------|-------------------------|
| `http://localhost:5173` | No Netlify CSP → SDK **may** load **if** `VITE_FACEBOOK_APP_ID` is set for the running Vite process. Repo `.env` had **no active `VITE_FACEBOOK_APP_ID`** → button should stay hidden unless env is set outside tracked files. |
| Meta dialog | If SDK runs and `email` not in use case → **“Sorry, something went wrong”** |
| Backend | `localhost:3001` + proxy `/api` — Facebook verification needs **secret** on API (present in backend env). |

**Local vs production:** Production is **strictly worse** due to CSP. Local failures are more likely **env (VITE)** or **Meta email use case**, not CSP.

---

## 8. Production result

| Host | CSP blocks Facebook | App ID in JS bundle |
|------|---------------------|---------------------|
| `https://caretip.de` | **Yes** (proven) | **Yes** |
| `https://www.caretip.de` | Same policy expected (same Netlify site / `_headers`) | Same build |

Facebook button visibility on production is consistent with **inlined App ID**. Stuck loading is **not** explained by missing `VITE_FACEBOOK_APP_ID` on Netlify; it **is** explained by **CSP** and possibly **Meta scope** after CSP fix.

---

## 9. Meta configuration findings (code-derived + public Meta patterns)

**CareTip does not use a custom OAuth redirect URI.** Meta dashboard entries should focus on:

- **Facebook Login** product enabled
- **App Domains:** `caretip.de`, `localhost`, `127.0.0.1`
- **Site URL:** `https://caretip.de/`
- **Allowed JavaScript SDK domains:** `localhost`, `127.0.0.1`, `caretip.de`, `www.caretip.de`
- **Valid OAuth Redirect URIs:** **None required by CareTip’s implementation** (no callback route). If Meta’s UI forces entries, use real SPA origins only (`http://localhost:5173/`, `https://caretip.de/`, etc.) — not a fabricated callback path.
- **Client OAuth Login / Web OAuth Login:** On for web SDK

**App mode:** Development mode allows `public_profile` + `email` for **roles/test users** without App Review; Live requires review for extended access beyond defaults.

---

## 10. `email` permission investigation

### What CareTip requests

- `public_profile`
- `email`  
(scopes only; no other Facebook permissions in code.)

### Is manual “Add email” under Permissions and features required?

| Question | Finding |
|----------|---------|
| Implicitly available? | For **Facebook Login**, `public_profile` and `email` are **standard** permissions; they are normally declared through the **Authentication and account creation** use case, not as optional “extended” permissions. |
| Must you click “Add” on Permissions and features? | **Often no** — and Meta’s **“Sorry, something went wrong”** when clicking **Add** on `email` is **widely reported** (developers.facebook.com / Stack Overflow) even when login works after configuring the **use case** path. |
| Is `email` enabled if Add fails? | **Unknown without Meta app UI inspection.** Verify under **App → Use cases → Authentication and account creation → Permissions** whether `email` is listed as added. |
| Can Dev mode `FB.login` request `email` without that Add button? | **Yes**, for app roles/test users **if** the use case includes `email`. If not, the **login dialog** fails (Meta generic error), not CareTip. |
| Does dialog return email? | Only if user grants and account has email; backend reads `me.email` or JWT `email`. Signup **requires** email; login for **already linked** accounts does not. |
| Token without dashboard Add? | **Possible** in Development with correct use case; **not** provable from repo alone. |

### Separate dashboard problem (your item B)

The **Permissions and features → + Add → email → “Sorry, something went wrong”** is treated as:

1. **Meta dashboard / use-case UI failure** (common), **or**
2. **`email` already attached** to Facebook Login use case (Add redundant), **or**
3. Browser/session issue (try different browser, disable blockers, Meta business account permissions).

**It does not by itself prove** CareTip should stop requesting `email` — product signup **requires** it.

**Action for configuration fix (no code):** Use **Use cases → Authentication and account creation → Edit → Permissions → email**, save, wait, retest dialog. Add app admin as **Tester** under **Roles**.

---

## 11. OAuth / backend verification findings

| Step | Requirement |
|------|-------------|
| Access token path | `FACEBOOK_APP_SECRET` for `debug_token` + `/me` |
| Limited Login JWT (mobile iOS) | JWKS verify; `email` in token if granted |
| Signup | `oauthAuth.service.ts` throws if Facebook and no `email` |
| Login | Lookup by OAuth **subject**; email not required if already linked |
| Auto-link by email | **Disabled** (anti-enumeration) |

No evidence in this pass that production reaches verification while CSP blocks the SDK.

---

## 12. Loading-state findings

### Facebook icon spinner (`OAuthProviderRow`)

| Event | Loading |
|-------|---------|
| Click Facebook | `setProviderBusy("facebook")` |
| `requestFacebookAccessToken()` resolves | `onSocialCredential` then **`finally` → `setProviderBusy(null)`** |
| Rejects (cancel, SDK error) | Toast + **`finally` clears** |
| **Promise never settles** | **Spinner stuck** (documented SDK race if script tag exists without `window.FB`) |

### Full-page auth handoff (`AuthPage.runSocialOAuth`)

| Event | Loading |
|-------|---------|
| After token received | `beginAuthSignInHandoff()`, `setAuthFlowInProgress(true)`, `setIsSubmitting(true)` |
| Success | `redirectAfterAuth` — may keep handoff until layout ready (`authSignInHandoff.ts`, max 20s) |
| Error | `endAuthSignInHandoff`, clears submit flags in `finally` |
| MFA | Clears submit flags, keeps MFA UI |

**Distinction:** Stuck **icon-only** spinner → steps 3–7 (SDK/login). Stuck **full-page** cover → post-token handoff or redirect (steps 9–14).

---

## 13. Exact root cause

**Primary (production):** CareTip’s **Content-Security-Policy** on the Netlify-hosted SPA **does not allow** Facebook JavaScript SDK, login framing, or Graph connectivity. Facebook Login cannot complete on `https://caretip.de`.

**Secondary (all environments once SDK runs):** Meta app may not have **`email`** correctly enabled under **Authentication and account creation**, causing Meta’s login dialog to fail when CareTip requests `scope: "email,public_profile"`. The dashboard **Add email** error is a **separate Meta UI/configuration** issue and must not be read as “email already OK.”

**Tertiary (local):** Web App ID must be **`VITE_FACEBOOK_APP_ID`**; backend-only `FACEBOOK_APP_ID` does not configure Vite.

**Quaternary (code quality):** `loadFacebookSdk()` can hang without rejecting if `sdk.js` is present but `FB` is uninitialized.

---

## 14. Smallest remediation required

1. **CSP allowlist** for Facebook (repo policy file + redeploy) — **required for production.**
2. **Meta:** Confirm `email` on **Authentication and account creation** use case; testers in **Development** mode — **required for dialog success with current scopes.**
3. **Local:** Uncomment/set **`VITE_FACEBOOK_APP_ID`** matching Meta app — **required for local web button + init.**
4. **Render:** Keep **`FACEBOOK_APP_ID`** + **`FACEBOOK_APP_SECRET`** aligned with same Meta app — **required for backend after token is issued.**
5. **Optional follow-up code fix:** SDK loader hang + clearer timeout/error if `FB.login` never callbacks — **not in this pass.**

---

## 15. Remediation class

| Item | Class |
|------|--------|
| CSP / `_headers` / Netlify redeploy | **Code + deployment configuration** (CSP source in repo) |
| `VITE_FACEBOOK_APP_ID` on Netlify (already in build) | **Netlify configuration** (verify value matches Meta app) |
| `VITE_FACEBOOK_APP_ID` local | **Local environment configuration** |
| `FACEBOOK_APP_ID` / secret on Render | **Render configuration** |
| `email` use case / testers | **Meta configuration** (and possible **Meta-side UI bug** for Add button) |
| SDK promise hang | **Code** (future minimal fix) |

---

## Final status

**ROOT CAUSE CONFIRMED — READY FOR MINIMAL REMEDIATION**

---

## Appendix — Environment variable names (verified in code)

| Surface | Names |
|---------|--------|
| Web | `VITE_FACEBOOK_APP_ID` |
| API | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`; aliases `META_APP_ID`, `META_APP_SECRET`; fallback read `VITE_FACEBOOK_APP_ID` in verifier only for App ID |
| Mobile | `EXPO_PUBLIC_FACEBOOK_APP_ID`, `EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN` |

**NO CODE CHANGES IN THIS PASS.**
