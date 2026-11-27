# API hostname migration: `caretip.onrender.com` → `api.caretip.de`

Last reviewed 2026-11-27. Canonical API host: **`https://api.caretip.de`** (a Render custom domain on the
same web service). The Render-generated `https://caretip.onrender.com` still answers and must keep
answering until every retirement criterion in section 7 is met. Cloudflare comes after this migration
(`docs/ops/ddos-resilience.md`, section 5).

## 1. Current architecture (verified 2026-11-27)

| Component | API host | How verified |
|---|---|---|
| Web app (Netlify, `caretip.de`) | `VITE_API_URL=https://api.caretip.de` | Live production bundle (read-only fetch) |
| Web legacy session move | `VITE_LEGACY_API_URL=https://caretip.onrender.com` | Live production bundle |
| Web `/api/*` proxy (OAuth callbacks, same-origin calls) | `public/_redirects` → `https://api.caretip.de/api/:splat` | Repository |
| Web CSP `connect-src` | `https://*.caretip.de`, `wss://*.caretip.de`, plus exact legacy `https://`/`wss://caretip.onrender.com` | Live response header + `scripts/spa-csp-policy.mjs` |
| Mobile app (Expo) | **Was** `caretip.onrender.com` (production + preview); now `api.caretip.de` in the repository | Repository; not yet built or released |
| Render Cron Jobs (`render.yaml`) | `CARE_TIP_API_ORIGIN=https://api.caretip.de` | Repository only; **dashboard values not verified** |
| Backend public URL (`resolvePublicApiBaseUrl`) | `PUBLIC_API_BASE_URL`, else Render's `RENDER_EXTERNAL_URL` (`*.onrender.com`) | Repository; Render value not verified |
| Both hosts | `GET /api/health` → 200 on `api.caretip.de`, `caretip.onrender.com`, `caretip.de` (proxy) | Live, read-only |

Host-independent (no change needed): CORS and Socket.IO origins (the frontend origins `caretip.de` /
`www.caretip.de`, never the API host), Stripe Checkout/Connect return URLs and email links
(`FRONTEND_URL`), web Google and Facebook OAuth (callbacks on the page origin, proxied by Netlify), web
Apple sign-in (popup, return URL = page origin).

## 2. Old-host references and their classification

| Reference | Class | Action |
|---|---|---|
| `mobile/constants/config.ts` `PRODUCTION_API_URL`, `mobile/eas.json` (preview, production) | 1 Active production | **Changed** to `api.caretip.de`; needs a mobile release (section 4) |
| Apple Services ID Return URL `…onrender.com/api/auth/apple/native-callback` (Android Sign in with Apple, built from the mobile API URL) | 1 Active production | Add the `api.caretip.de` URL **before** the mobile release (section 5) |
| Netlify `VITE_LEGACY_API_URL` + `src/app/lib/legacySessionMigration.ts` | 2 Legacy compatibility | Keep; remove at retirement step R1 |
| CSP exact `https://`/`wss://caretip.onrender.com` (`scripts/spa-csp-policy.mjs` → `public/_headers`, `vercel.json`; `scripts/csp-verify.mjs`) | 2 Legacy compatibility | Keep; remove together with `VITE_LEGACY_API_URL` |
| Backend `resolvePublicApiBaseUrl` fallback to `RENDER_EXTERNAL_URL` | 2 (latent) | Set `PUBLIC_API_BASE_URL` on Render (section 5); startup now warns while unset |
| Cron runner default (`backend/scripts/render-category-retention-http.{mjs,sh}`) | 2 | **Changed** to `api.caretip.de` (used only when `CARE_TIP_API_ORIGIN` is unset) |
| Old mobile builds already installed | 2 | Keep the old host until adoption (section 4) |
| `refreshToken.service.ts` (SameSite=None on non-first-party hosts) | 2 | Keep; harmless after retirement |
| `backend/scripts/first-party-api-domain-runtime.ts`, `scripts/first-party-api-domain-frontend-runtime.ts`, `scripts/authed-file-url-runtime.ts`, `src/app/lib/pageOriginAuthRefresh.runtime.ts`, `mobile/scripts/share-service-runtime.ts` | 3 Test | Keep (they test legacy handling) |
| Live/one-off verification scripts: `backend/scripts/employee-stripe-phase-*`, `stripe-payout-*`, `e2e-euro90-*`, `marie-testerin-remediation-e2e.ts`, `stripe-full-e2e-production-readiness.ts` | 5 Safe to remove/update after migration | Not run; no runtime effect. Update the host before reusing any of them |
| `.env.example`, `docs/ops/*.md`, `scripts/sanitize-docs-secrets.mjs` | 4 Documentation | `.env.example` and runbooks updated |

## 3. Session migration

**Web.** Refresh cookies are host-only (`caretip_refresh`, no `Domain`), `HttpOnly`, `Secure`, `Path=/`;
`SameSite=Lax` on `api.caretip.de` (first-party to `caretip.de`), `None` on the Render host. A browser whose
session lives on the old host has no cookie on the new one, so on its first refresh the SPA:
1. refreshes once against `VITE_LEGACY_API_URL` (rotates the old cookie, receives an access token);
2. calls `POST /api/auth/session/migrate` on `api.caretip.de` with that token, which revokes the old session
   and sets a new-host cookie.

Runs inside the cross-tab refresh lock (no duplicate refreshes), writes no token to storage (only a
completion marker), retries once after an uncertain move, and treats 401/403 as "no session". Logout also
revokes the old-host session while the move is pending. Sign-out-everywhere bumps the credential version
and revokes sessions in the database, so it covers both hosts. Cookies are not broadened (no `Domain`).

User impact: none while `VITE_LEGACY_API_URL` is set. After it is removed, a browser that still holds only
an old-host cookie must sign in once. Refresh sessions expire after 7 days without use
(`REFRESH_TOKEN_EXPIRES_DAYS`, default 7; 90-day absolute limit), so after a week of the move being live,
only browsers that have not opened CareTip since are affected, and those sessions had already expired.

**Important ordering:** remove `VITE_LEGACY_API_URL` *before* disabling the Render subdomain. If the old
host answers 404 while the variable is set, the legacy refresh fails as a transient error and those browsers
keep retrying instead of falling through to sign-in.

**Mobile.** The app stores the refresh token in SecureStore and sends it as a `Cookie` header itself; the
backend validates the token, not the host. Existing mobile sessions therefore keep working when the app
switches to `api.caretip.de`; no migration step exists or is needed.

## 4. Mobile release and adoption

Facts from the repository: version `1.0.0`, `runtimeVersion` `1.0.0`, Android `versionCode` 6, iOS
`buildNumber` 1; `eas.json` submits Android to the **internal** track and iOS still has the placeholder
`ascAppId`. This suggests no public store release yet; confirm in Google Play Console and App Store Connect.
No minimum-version or forced-upgrade mechanism exists.

Plan:
1. Register the new Apple Return URL (section 5) first: the new build's Android Apple sign-in uses
   `https://api.caretip.de/api/auth/apple/native-callback`.
2. Build and ship from the updated repository: `eas build --profile production` (Android and iOS), then submit.
   The profile's `env` block sets `EXPO_PUBLIC_APP_ENV=production` and `EXPO_PUBLIC_API_URL`.
   `eas build --profile preview` for internal testers uses the same API host.
3. Over-the-air (`eas update --channel production`) can reach existing installs on runtime `1.0.0` without a
   store release, **but `eas.json` build `env` is not applied to updates**: every `EXPO_PUBLIC_*` value
   (`EXPO_PUBLIC_APP_ENV=production`, `EXPO_PUBLIC_API_URL`, Google/Facebook/Apple IDs) must come from the
   shell or EAS environment variables at update time, or the bundle falls back to development settings.
   Prefer a store build unless those variables are configured in EAS.
4. Old builds keep working against the old host until it is disabled; after that every request from them
   fails (404). Retire only when the legacy-host monitor shows no `mobile_app` traffic (section 7).
5. If the app is already public: wait at least two store-release cycles and add a minimum-version check
   before retiring (separate work; none exists today). If it is internal only: confirm every tester has
   installed the new build.

## 5. External configuration checklist (manual; nothing below has been changed)

| Service | Verify now | Change to | Test | Expected | Rollback |
|---|---|---|---|---|---|
| **Stripe Live platform webhook** | Dashboard → Developers → Webhooks: endpoint URL and events (`docs/ops/payment-integrity-runbook.md`, section "destinations") | Edit the **existing** endpoint's URL to `https://api.caretip.de/api/webhooks/stripe` (signing secret is unchanged by a URL edit) | On the endpoint, **Resend** one recent successfully delivered event | 200; no second ledger effect (events are deduplicated by id) | Edit the URL back |
| **Stripe Live Connect webhook** | Same, "Connected accounts" endpoint | `https://api.caretip.de/api/webhooks/stripe-connect` | Resend a recent `account.updated` | 200 | Edit the URL back |
| Stripe (if creating new endpoints instead) | — | New endpoints get **new** secrets; the API verifies one secret per endpoint (`STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`) | — | Avoid: the old and new endpoint cannot both verify | — |
| **Apple** (Certificates, Identifiers & Profiles → Services IDs → the web Services ID → Sign in with Apple → Configure) | Return URLs include `https://caretip.onrender.com/api/auth/apple/native-callback` and the web origins `https://caretip.de` (and `www` if used) | **Add** `https://api.caretip.de/api/auth/apple/native-callback` (and the domain `api.caretip.de`); keep the old URL | New Android build: Sign in with Apple | Returns to the app signed in | Remove the added URL |
| **Google Cloud** (APIs & Services → Credentials → web OAuth client) | Origins `https://caretip.de`, `https://www.caretip.de`; redirect `https://caretip.de/api/auth/google/redirect` (and `www`) | No change expected; any `onrender.com` entry is legacy | Web Google sign-in (mobile-web redirect mode) | Signed in | — |
| **Meta** (App → Facebook Login → Settings) | Valid OAuth Redirect URIs `https://caretip.de/api/auth/facebook/callback` (and `www`); App Domains `caretip.de` | No change expected; `onrender.com` entries are legacy | Web Facebook sign-in | Signed in | — |
| **Render web service** env | `PUBLIC_API_BASE_URL` | `https://api.caretip.de` | Deploy log: no `PUBLIC_API_BASE_URL is not set` warning | Warning absent | Remove the variable |
| **Render Cron Jobs** (every live job, incl. manually created ones such as `dispute-reconciliation-tick`) | Each job's `CARE_TIP_API_ORIGIN` | `https://api.caretip.de` | Next run log | `ok:true`, HTTP 200 | Old value |
| Render custom domain | Settings → Custom Domains: `api.caretip.de` verified, certificate issued | — | `curl -I https://api.caretip.de/health` | 200, valid cert | — |
| **Netlify** | `VITE_API_URL=https://api.caretip.de` (verified live), `VITE_LEGACY_API_URL` (verified live) | Unchanged until R1 | — | — | — |
| **IT-Recht Kanzlei** legal webhook | Which URL is registered in their portal | `https://api.caretip.de/api/legal/webhook` if it uses the Render host | Their "send test" / next push | 200 in logs | Old URL |
| External uptime monitors (if any) | Monitored URL | `https://api.caretip.de/health` | Monitor green | — | Old URL |

Do not change `caretip-scheduled-bank-payout-tick` (stays suspended) or any `DATA_LIFECYCLE_*` value while
checking the cron jobs.

## 6. Measuring old-host traffic

The API logs, at most once per minute per instance while there is any, a summary of requests that arrived
on a `*.onrender.com` host since its previous summary; the number of seconds is the measured window, which
is longer than 60 after quiet periods (`backend/src/lib/legacyHostMonitor.ts`):

    [legacy-host] caretip.onrender.com 60s: mobile_app=3 stripe_webhook=1 (total 4)

Categories: `mobile_app`, `web_session_move`, `stripe_webhook`, `internal_job`, `oauth_callback`,
`legal_webhook`, `media`, `health`, `other`. No address, user, token or header value is logged. Search the
Render logs for `[legacy-host]`. Socket.IO connections are not counted (their clients also make API calls).

## 7. Retirement criteria and sequence

Criteria (all must hold):
- C1 `PUBLIC_API_BASE_URL` set; the startup warning is absent.
- C2 Both Stripe Live endpoints point at `api.caretip.de` with 2xx deliveries for 7 days.
- C3 Every cron job uses `api.caretip.de` (one successful run each).
- C4 New Apple Return URL registered; new mobile build released and adopted (section 4).
- C5 `[legacy-host]` shows zero `mobile_app`, `stripe_webhook`, `internal_job`, `oauth_callback`,
  `legal_webhook`, `media` and `other` for **14 consecutive days** (`health` alone is acceptable).
- C6 `web_session_move` at zero for 7 days, and `VITE_LEGACY_API_URL` live for at least 7 days.

Sequence:
- R1 (after C6) Remove `VITE_LEGACY_API_URL` in Netlify and the CSP legacy entries (`scripts/spa-csp-policy.mjs`,
  regenerate `public/_headers`/`vercel.json`, update `scripts/csp-verify.mjs` and the legacy assertions in the
  frontend first-party test); deploy.
- R2 Wait 7 days; confirm no sign-in regressions.
- R3 (after C1–C5) Disable the Render subdomain: Render → web service → Settings → Custom Domains →
  Render Subdomain → Disabled (or `renderSubdomainPolicy: disabled`). It then answers 404.
- R4 Watch Sentry, 5xx alerts and sign-in for 48 hours.
- R5 After 30 days: remove the legacy Apple Return URL and any `onrender.com` Google/Meta entries.

## 8. Rollback

- Old host: Render → Settings → Custom Domains → Render Subdomain → Enabled (immediate; old mobile builds,
  webhooks and jobs work again).
- Web legacy move: re-add `VITE_LEGACY_API_URL=https://caretip.onrender.com` in Netlify and revert the CSP
  change, then redeploy. Re-enable the subdomain first.
- Stripe: edit the endpoint URL back. Apple/Google/Meta: re-add the removed entries.
- Mobile: a release cannot be recalled; keep the old host enabled until C4/C5 hold again.
