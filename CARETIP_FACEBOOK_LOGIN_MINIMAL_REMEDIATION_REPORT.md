# CareTip — Facebook Login Minimal Remediation Report

**Date:** 2026-10-05  
**Prior audit:** `CARETIP_FACEBOOK_LOGIN_STUCK_LOADING_FORENSIC_REPORT.md`  
**Scope:** CSP + env documentation only — **no OAuth redesign**, no SDK hang fix, no routing/callback changes.

---

## Final status

**READY — CODE FIXED, META CONFIGURATION STILL REQUIRED**

Production **https://caretip.de** still serves the **pre-remediation CSP** until Netlify deploys this build. End-to-end Facebook Login on production was **not** re-verified in a browser in this pass (deploy + Meta use case + tester account required).

---

## 1. Files changed

| File | Change |
|------|--------|
| `scripts/spa-csp-policy.mjs` | Canonical CSP: Facebook `script-src`, `connect-src`, `frame-src` |
| `public/_headers` | Synced CSP (Netlify) |
| `vercel.json` | Synced CSP |
| `.env.example` | Document `VITE_FACEBOOK_APP_ID` vs `FACEBOOK_APP_ID`; Meta use-case notes |

**Not changed:** `facebookOAuthWeb.ts`, `oauthAuth.service.ts`, `facebookVerifier.ts`, Auth UI, mobile Facebook, backend secrets.

---

## 2. Exact CSP changes

**Source of truth:** `scripts/spa-csp-policy.mjs`  
**Sync:** Manual copy to `public/_headers` and `vercel.json` (same string as `SPA_CONTENT_SECURITY_POLICY`).  
**Verify:** `npm run test:csp`

| Directive | Added hosts |
|-----------|-------------|
| `script-src` | `https://connect.facebook.net` |
| `connect-src` | `https://connect.facebook.net`, `https://graph.facebook.com`, `https://www.facebook.com` |
| `frame-src` | `https://www.facebook.com`, `https://facebook.com` |

All existing Google, Calendly, CareTip, Onrender, Firebase, Sentry rules unchanged. No `unsafe-inline` on scripts, no `*.facebook.com` wildcard.

---

## 3. `public/_headers` and `vercel.json` synchronized

- `npm run test:csp` → **PASS** (`public/_headers`, `vercel.json`, API middleware checked).
- `npm run build` → **`dist/_headers`** contains `connect.facebook.net` in CSP.

---

## 4. Local `VITE_FACEBOOK_APP_ID` status

| Check | Result |
|-------|--------|
| Code reads | `import.meta.env.VITE_FACEBOOK_APP_ID` only (`oauthProviderIds.ts`) |
| Tracked `.env.example` | Documents that web **must** set `VITE_FACEBOOK_APP_ID` (same numeric ID as `FACEBOOK_APP_ID`) |
| Workspace root `.env` (audit) | **`VITE_FACEBOOK_APP_ID` is set** (not committed in this remediation; verify locally) |
| Backend | `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` unchanged |

**Action for you:** If any machine lacks the Facebook button locally, set `VITE_FACEBOOK_APP_ID` to your Meta App ID and restart `npm run dev`.

---

## 5. Meta configuration — manual verification still required

CareTip still requests **`email,public_profile`** via `FB.login` — unchanged.

**Do not** rely on **Permissions and features → Add email** if Meta shows “Sorry, something went wrong” (known dashboard issue).

**Verify in Meta Developer Console:**

1. **Use cases → Authentication and account creation → Edit → Permissions** — `email` and `public_profile` enabled.
2. **Facebook Login** product enabled.
3. **Development** mode + test user / role on the Facebook account used for login.
4. **Settings → Basic:** App Domains (`caretip.de`, `localhost`), Site URL `https://caretip.de/`.
5. **Facebook Login → Settings:** Client OAuth Login / Web OAuth Login on; Allowed domains for JS SDK: `localhost`, `127.0.0.1`, `caretip.de`, `www.caretip.de`.
6. **No** CareTip callback URL — do not add `/auth/facebook/callback`.

If the dialog still shows Meta’s generic error **after** CSP deploy + use-case `email`, treat as **Meta configuration** (not CareTip OAuth code).

---

## 6. Production build result

| Command | Result |
|---------|--------|
| `npm run test:csp` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |

Built bundle still references `connect.facebook.net/en_US/sdk.js` (Facebook web flow intact).

---

## 7. Browser verification result

| Environment | CSP / SDK | E2E login |
|-------------|-----------|-----------|
| **https://caretip.de** (live, pre-deploy) | **Old CSP** — no `connect.facebook.net` in `Content-Security-Policy` header (curl 2026-10-05) | Not tested — blocked until deploy |
| **Local `npm run dev`** | No Netlify CSP headers | Not run interactively in this pass |
| **`dist/` after build** | New CSP in `_headers` | Pending Netlify deploy |

---

## 8–14. Post-deploy checklist (for you)

After **Netlify deploy** of this commit:

1. Hard-refresh `https://caretip.de/login` — Console must **not** show refused `connect.facebook.net` / `facebook.com` / `graph.facebook.com`.
2. Facebook button → dialog opens → grant **email** + **public_profile**.
3. Network: `POST` to CareTip API `/api/auth/oauth` with `provider: "facebook"` (via your API host / proxy).
4. Session cookie + redirect to dashboard (or signup/MFA as applicable).

| Step | Expected |
|------|----------|
| Facebook SDK loaded | `connect.facebook.net/.../sdk.js` 200 |
| `FB.login` opened | Facebook dialog / popup |
| Email returned | In Graph/JWT when user grants and account has email |
| `POST /api/auth/oauth` | 200 + auth payload (or known 401/signup errors) |
| Backend verification | `facebookVerifier` + `FACEBOOK_APP_SECRET` on Render |

---

## 15. Remaining issues / next steps

1. **Deploy to Netlify** — required for production CSP fix (live site still on old policy).
2. **Meta use case `email`** — confirm under Authentication and account creation; use Development testers.
3. **SDK promise hang** — not fixed in this pass; investigate only if spinner persists **after** deploy + Meta checks.
4. **Full E2E success** — re-test after deploy; update this report status to **READY — FACEBOOK LOGIN VERIFIED** when complete.

---

## OAuth flow preserved

`FB.init` → `FB.login(scope: email,public_profile)` → access token → `POST /api/auth/oauth` → `facebookVerifier` → session — **unchanged**.
