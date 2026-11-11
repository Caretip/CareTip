# CareTip — First-Party API Domain Migration (`api.caretip.de`)

Status: **reviewed, hardened and tested locally. Committed locally only; not pushed, not deployed.**

- Worktree: `C:\Users\Juliet\Downloads\CareTip-api-first-party-domain`.
- Branch: `feat/first-party-api-domain`, built on the authentication baseline `0e301b93`.
- No DNS, Render, Netlify, OAuth-provider, database or production-session changes were made.
- Real-browser verification (including Safari) cannot happen until the domain is live, and has not happened.

## 1. Final architecture

- The SPA stays on `https://caretip.de`. Netlify redirects `www.caretip.de` to the apex with a 301; this is verified and unchanged.
- The browser calls `https://api.caretip.de`. This is a Render custom domain on the existing Render service: same code, same database.
- `caretip.de` and `api.caretip.de` share the registrable domain, so they are **same-site**. The refresh cookie becomes a first-party, host-only `SameSite=Lax` cookie, which is the point of the migration: browsers stop treating it as a third-party cookie.
- `https://caretip.onrender.com` stays live, with its existing `SameSite=None` cookie policy, for:
  - native mobile apps;
  - Render cron jobs;
  - Stripe webhooks;
  - the Apple Android native callback;
  - the Netlify `/api/*` proxy;
  - browsers that have not migrated yet.
- The access token stays memory-only, and the refresh token is never readable by JavaScript.

## 2. Session migration security review

**Flow.**

1. The new host refresh finds no cookie and returns `401 REFRESH_COOKIE_MISSING`.
2. The client refreshes on the old host, using the old cookie.
3. The client calls `POST https://api.caretip.de/api/auth/session/migrate` with the access token the old host just issued.

**How the source session is validated.**

- **Old refresh cookie.** The old host validates it: SHA-256 lookup, revocation, expiry, rotation with grace. The migrate endpoint never accepts a refresh token.
- **Access token.** `authMiddleware` checks:
  - the HS256 signature and expiry;
  - the token type (pending-MFA tokens are refused);
  - that the user exists, `isActive` is true and `accountStatus` is `active`;
  - that the token version matches;
  - that `sid` points to an existing, unrevoked, unexpired refresh row owned by the same user.
- **Production binding.** Production tokens must carry both `tv` and `sid`.
- **Controller checks.** The controller additionally rejects impersonation tokens and tokens without `sid`. **New:** it also rejects access tokens older than 2 minutes (`SESSION_MIGRATE_STALE_TOKEN`), so an older leaked access token cannot be turned into a 7-day refresh cookie.
- **No caller-chosen identity.** The user and session come only from the verified token. No user id or token is read from the body or query string; a test asserts this.
- **Route guards.** The route chain is `oauthRateLimit`, `requireCaretipClientHeader`, `requireTrustedOrigin`, then `authMiddleware`.

**New session.**

- It is created for the token's user. The cookie is set by `api.caretip.de` itself: host-only, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, expiring with the session.
- The refresh token appears only in `Set-Cookie`, never in the JSON body. Tests cover both points.
- Nothing is written to localStorage or sessionStorage apart from the non-secret marker `caretip_api_host_migration=done`.
- Logs (`auth.refresh`) contain the user and session id only.

## 3. Session migration operation order

`migrateSessionToNewRefreshToken` uses the same commit protocol as the remediated rotation. It uses no interactive transaction, because the Supabase transaction pooler rejects those (P2028).

1. `findUnique(sid)`: reject if not found, owned by another user, revoked or expired.
2. `create` the new row. A failure here throws `committed:false`, and the old session stays usable.
3. **Commit point:** `updateMany({ id: sid, revokedAt: null })` sets `revokedAt` **and `replacedByTokenId = new id`**. A failure here throws `committed:true`, and the old host's grace window covers a retry.
4. If `count ≠ 1`, a concurrent request won: delete our never-issued row and return 409. The winner is untouched, and no cookie is set or cleared.

**Change in this pass.** The old row is now **linked** to its replacement; before, it was revoked without a link. Without the link, a migrate response lost in transit left the browser holding only a dead old cookie, which logged the user out. With the link, the old cookie replayed within 60 seconds recovers into the migrated chain through the existing grace logic: the head is rotated, so there is still one active session.

## 4. Concurrency and recovery evidence

All of these are covered by the isolated backend suite:

| Scenario | Result |
|---|---|
| Two concurrent migrations of one session | one 200 and one 409; one active session; the loser sets and clears no cookie |
| Response lost after commit, old cookie replayed within 60 seconds | recovered (`recoveredFromSessionId`); still one active session |
| Retry migration after recovery | 200, cookie set; exactly one active session; other devices untouched |
| Re-migrating the already-moved session | 401 |
| Old cookie replayed after the grace window | reuse cascade, the same as any rotated token (the remediation's theft protection is unchanged) |
| Revoked, expired, foreign, no-sid or impersonation source | 401, nothing changed |
| Stale access token (older than 2 minutes) | 401, nothing changed |
| Inactive, suspended, token-version mismatch, revoked or expired session, expired or forged JWT | 401 at `authMiddleware` |

**Client side.** Migration runs inside the cross-tab refresh lock, so two tabs produce one legacy refresh and one migration. If the migrate call returns no response or a 409, the client:

1. tries the current host first, because the new cookie may already be stored;
2. otherwise redoes the legacy refresh and migrate exactly once.

A 503 keeps the user signed in on the legacy session, and migration is retried on a later load.

**Residual case.** If a migrate response is lost and the Set-Cookie never arrived, and the browser only returns after more than 60 seconds, the old cookie replay is treated as token reuse. That revokes the user's sessions and forces a sign-in. This is the same behaviour the authentication remediation already accepts for a lost refresh response.

## 5. Logout lifecycle verification

**Server change.** Logout revokes the presented session **and its replacement chain**, with a bounded walk that re-reads a row that was replaced mid-logout. It starts from either:

- the host's own cookie; or
- the `sid` of a valid Bearer access token, checked for signature, expiry and the session's owner. Impersonation and pending-MFA tokens are ignored.

As a result, a refresh or migration that commits while logout is in flight cannot leave a live session behind.

**Cookie clearing.** Each host clears only its own cookie, with the attributes it set it with: Lax on `api.caretip.de`, None on onrender, always host-only.

**Client change.** `logoutAPIWithTimeout` now:

- awaits the previous-host logout as well;
- sends the access token to both hosts;
- reports `ok` only when the API confirmed. `legacyConfirmed` reports the previous-host result.

Network errors and 5xx are no longer reported as success. Local state is cleared either way.

| Scenario | Evidence |
|---|---|
| Before migration (legacy cookie only, old host) | legacy session revoked; SameSite=None clear |
| After migration (new cookie only, new host) | migrated session revoked; clear attributes equal the set attributes (Lax) |
| Both cookies present | both hosts called; no active session remains; each clears its own cookie |
| During migration (logout first, migrate first, parallel) | no active session remains in any order; migrate after logout returns 401 and sets no cookie |
| Old host unavailable | the new host revokes through the Bearer `sid`; the legacy cookie is dead afterwards |
| Repeated logout | 200, `revoked: 0` |
| Store failure | 503, `ok:false` (revocation not claimed) |
| Client: 5xx, network error, or legacy host unreachable | `ok:false`; local session cleared |

**Limitation.** While the old host is unreachable, the browser's old-host cookie cannot be *deleted*, because it is host-only and only that host can clear it. The *session* behind it is still revoked server-side through the Bearer `sid`, so the leftover cookie is inert. Revocation is complete only if the logout request reached at least one host with a valid token or cookie. A fully offline logout clears local state only.

## 6. Cookie and CORS design

- **`api.caretip.de`:** `HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/`, `Max-Age` equal to the session expiry, no `Domain`. Deletion uses `Max-Age=0` and epoch expiry with the same attributes.
- **Other production hosts:** `SameSite=None`, unchanged.
- **Development:** Lax, unchanged.
- **`FIRST_PARTY_API_HOSTS`:** optional, adds more first-party hosts. `api.caretip.de` is built in.
- **Why Lax:** every cookie-setting web flow is a same-site credentialed `fetch` POST from `caretip.de`; nothing relies on a cross-site top-level navigation to the API.
- **CORS** (`backend/src/config/cors.ts`):
  - exact allowlist: `https://caretip.de`, `https://www.caretip.de`, plus `FRONTEND_URL` / `CORS_ORIGINS`;
  - credentials true, never `*`;
  - tested rejections: `evil.example`, `caretip.de.evil.example`, `api.caretip.de.evil.example`, `http://caretip.de` and `null`.
- **`www`:** `https://www.caretip.de` stays allowed, consistent with the canonical 301 (the redirect is a page navigation and never reaches the API).
- **CSRF:** `requireTrustedOrigin` and `requireCaretipClientHeader` guard refresh, migrate and logout. A foreign Origin is rejected even with the client header.

## 7. Forwarded-IP remediation

**Found.** Three raw `X-Forwarded-For[0]` reads. The earlier audit reported two; the third was a fallback in `validateInvite`.

| File | Use |
|---|---|
| `backend/src/services/loginNotification.service.ts` | login-notification IP |
| `backend/src/services/qr/qrScanRequestContext.ts` | QR session fallback hash |
| `backend/src/controllers/business.controller.ts` | invite-validation limiter key fallback |

**Fix.** A new `backend/src/lib/clientIp.ts` (`trustedClientIp`) returns Express `req.ip`, which is bounded by `app.set("trust proxy", …)`, with IPv4-mapped addresses normalised. All three call sites use it, and so do the auth and security rate-limit key helpers, which already used `req.ip`. The limits themselves are unchanged.

**Tests.**

- With `trust proxy 1`, `X-Forwarded-For: 6.6.6.6, 203.0.113.7` yields `203.0.113.7` for `req.ip`, the login-notification IP and the QR hash alike.
- A legitimate single-entry forward works.
- Without trust proxy (non-production), the header is ignored.
- The login limiter still returns 429 per client, and spoofed prefixes don't evade it.
- A source scan finds no raw `headers["x-forwarded-for"]` or `get("x-forwarded-for")` reads in `backend/src`.

**Not invented.** `trust proxy` stays at the pre-existing value of `1`. The repository cannot prove that Render's edge appends exactly one trusted entry, and does not strip client-supplied values, for both the onrender hostname and a custom domain. **Owner verification is required after deploy.** For example, from a known client IP, send a request with a fake `X-Forwarded-For` and compare the address recorded in a login notification. Until then, spoofing is mitigated, not proven resolved. IP addresses are network-level hints only: they identify neither a person nor an exact location.

## 8. Windows line-ending regression

**Cause.** `src/app/lib/authCredentialExchangeDeadline.runtime.ts` compared source text containing a literal `\n` (`'failStart(\n      "csp_form_action_blocked"'`). A `core.autocrlf=true` checkout has CRLF, so it failed.

**Fix.** The test's `read()` helper normalises CRLF and CR to LF before the source checks. A self-test asserts that normalisation turns the CRLF form of that exact marker into the LF form; LF input is unchanged.

**What did not change.**

- No assertion was removed or weakened.
- The Facebook production code is unmodified (Facebook is retired).
- No global line-ending changes were made.

The file already contains behaviour tests for the deadline abort, real-error passthrough and navigation recovery, scheduling and cancellation; they are unchanged.

**Result.** It passes in the CRLF worktree. LF checkouts are unaffected by construction, and passed before.

## 9. Password, Google and Apple compatibility

- **Password login, Google GIS and Apple web (popup, `redirectURI = window.location.origin`)** exchange credentials by POST to `api.caretip.de` with credentials. The cookie is issued by `api.caretip.de` and the session survives a reload. The Render host is never contacted (frontend suite).
- **Unchanged:** provider-side state, nonce and ID-token verification, trusted origins and session rotation. No provider console changes are needed: Google's JavaScript origins are the SPA origins, and Apple web returns to the page origin.
- **Apple Android native:** the return URL stays on onrender.
- **Facebook:** retired. Its dormant code and Netlify-proxy refresh path are untouched and not extended.

## 10. Socket.IO compatibility

- Both clients connect to `resolveApiBaseUrl()`, so they follow `VITE_API_URL` to `wss://api.caretip.de`.
- The token is sent in the `auth` payload (memory only), never in the URL.
- Server origin checks use the same exact allowlist: the `caretip.de` handshake succeeds and a foreign origin is refused (real socket.io polling handshake test).
- User rooms, notifications and chat are server-side and unchanged.
- Logout still disconnects the user's sockets.
- CSP already allows `https://*.caretip.de` and `wss://*.caretip.de`.

## 11. Mobile, cron and webhook compatibility

- **Mobile:** `mobile/constants/config.ts` and `eas.json` stay on onrender. Native clients use the `X-CareTip-Refresh` header, not cookies, so nothing changes for them.
- **Cron jobs:** `render.yaml` crons use `CARE_TIP_API_ORIGIN=https://caretip.onrender.com` (server-to-server); kept.
- **Stripe webhooks:** the raw-body mount comes before CORS/JSON and is host-independent (tested). The dashboard endpoints stay on onrender.
- **Uploads:** browser uploads and downloads use `apiPath` and therefore `api.caretip.de`. Stored `/uploads` and onrender media URLs still resolve.
- **`PUBLIC_API_BASE_URL`:** only used for disk-storage fallback URLs, so it is **not needed**. Leave it unset; it would also change the retired Facebook host comparison.

## 12. Test results (actual runs, isolated)

The backend suites point `DATABASE_URL` at the unreachable `db.invalid` host, use in-memory stores and clear `REDIS_URL`. No production credentials were used.

| Suite | Result |
|---|---|
| `backend: test:first-party-api-domain` | **104/104 PASS** |
| `test:first-party-api-domain-frontend` | **61/61 PASS** |
| `backend: test:auth-refresh-reliability` | 17/17 PASS |
| `backend: test:auth-middleware-dedup` | PASS |
| `test:auth-refresh-reliability-frontend` | 31/31 PASS |
| `test:auth-refresh-coordination` | 38/38 PASS |
| `test:auth-refresh-security` | 23/23 PASS |
| `test:auth-navigation-session-preservation` | 13/13 PASS |
| `test:auth-logout-session-expired`, `test:auth-post-login-return`, `test:idle-session`, `notification-settings-phase2` | PASS |
| `test:auth-loading-recovery` | **PASS** (CRLF worktree) |
| Frontend and backend `tsc --noEmit` | PASS |
| ESLint, changed frontend files | 0 errors; one pre-existing unused-import warning in `api.ts`. Backend files are excluded by the repo's ESLint config, so backend `tsc` is its gate. |
| `npm run build` with `VITE_API_URL` and `VITE_LEGACY_API_URL` set | see the commit report |

**Skipped**, because they use the shared Supabase database (load `.env` or write rows):

- `test:auth-refresh-reuse-detection`
- `test:auth-enumeration`
- `qr-scan-phase3-regression`
- `sql-injection-smoke` (DB part)
- the live, pentest and e2e scripts

Browser-automation suites (`auth-refresh-multitab-browser`, `fanny-session-loss-browser`) were not run.

## 13. Environment-variable requirements

These are all URLs, not secrets.

| Variable | Where | Value / action |
|---|---|---|
| `VITE_API_URL` | Netlify, production build | `https://api.caretip.de` (value only) |
| `VITE_LEGACY_API_URL` | Netlify, production build | `https://caretip.onrender.com`: **required during the transition** (without it, existing sessions are not moved and users sign in once); remove after 7 days or more |
| `FIRST_PARTY_API_HOSTS` | Render | not needed |
| `PUBLIC_API_BASE_URL` | Render | not needed; leave unset |
| `FRONTEND_URL`, `CORS_ORIGINS`, `CARE_TIP_API_ORIGIN`, OAuth client ids, `EXPO_PUBLIC_API_URL` | — | no change |

`netlify.toml` defines no per-context environment, and both are `VITE_*` build-time variables. Set them in Netlify (Site configuration → Environment variables) with the scope that includes **Builds** for the **Production** context.

## 14. Render custom-domain instructions (owner)

1. Render dashboard → service `caretip` → **Settings → Custom Domains → Add** `api.caretip.de`.
2. Render displays the DNS record it requires. **Copy that exact value; this report deliberately gives none.**
3. After DNS is in place, wait for Render to show **Verified** and the certificate as **Issued**.
4. Keep `caretip.onrender.com` enabled.

## 15. Netlify DNS instructions (owner)

1. Netlify → Domains → `caretip.de` → DNS settings, if Netlify hosts the zone (otherwise the actual DNS provider).
2. Add the record for host `api` **exactly as Render specified**.
3. Do not modify the apex, `www` or any existing records; the canonical 301 setup stays as it is.
4. Verify: `https://api.caretip.de/api/health` returns 200 over valid TLS.

## 16. Existing-session migration and user impact

- **Signed-in users with a working old cookie** move silently on their next page load.
- **Users whose old cookie was already blocked** (third-party cookie restrictions) sign in once.
- **Anonymous visitors** never contact the old host.
- **No sessions are bulk-revoked.** Unmigrated old cookies expire within the 7-day refresh lifetime.
- **Safari ITP** caps first-party cookies set by CNAME-cloaked hosts at 7 days. The lifetime is already 7 days and rotates on each refresh, so there is no practical effect. This is unverified in a real browser until the domain is live.

## 17. Rollout sequence

1. Owner approves; the branch is pushed and merged (not done).
2. Deploy the backend to Render. This is safe before DNS: the onrender behaviour is unchanged apart from the extra 401 code, the logout chain revocation and the IP helper.
3. Add the Render custom domain (section 14) and the DNS record (section 15); wait for TLS.
4. Smoke-test `/api/health` on `api.caretip.de`.
5. Set the Netlify variables (section 13) and redeploy the frontend.
6. Verify in real browsers, including Safari with cross-site tracking prevention:
   - sign-in, reload, logout;
   - silent migration of an existing session;
   - Google and Apple sign-in;
   - realtime updates;
   - uploads.
7. Verify the forwarded-IP boundary (section 7).
8. After 7 days or more, remove `VITE_LEGACY_API_URL` and redeploy the frontend.

## 18. Rollback

1. Set `VITE_API_URL` back to `https://caretip.onrender.com`, remove `VITE_LEGACY_API_URL`, and redeploy the frontend.
2. Browsers that already migrated hold only an `api.caretip.de` cookie, so they sign in once.
3. The backend changes are backward-compatible and can stay deployed.
4. The custom domain can stay attached or be removed in Render.

## 19. Remaining risks

- Owner actions are pending: merge, deploy, Render domain, DNS and Netlify variables.
- The forwarded-IP trust boundary needs live verification (section 7).
- The residual case of a lost migrate response plus a return after more than 60 seconds forces a sign-in (section 4).
- Logout while the old host is unreachable leaves an inert (revoked) old cookie in the browser (section 5).
- Rolling back after migration costs one sign-in for migrated users.
- Real-browser and production verification only after go-live.

## 20. Exact production owner actions

1. Approve, push and merge `feat/first-party-api-domain`.
2. Deploy the backend to Render.
3. Add the Render custom domain `api.caretip.de`.
4. Create the Render-specified DNS record for `api.caretip.de`.
5. Set the Netlify production build variables: `VITE_API_URL=https://api.caretip.de` and `VITE_LEGACY_API_URL=https://caretip.onrender.com`. Redeploy the frontend.
6. Run the post-deploy browser and IP verification.
7. After 7 days or more, remove `VITE_LEGACY_API_URL` and redeploy.

Do not change `PUBLIC_API_BASE_URL`, `FIRST_PARTY_API_HOSTS`, OAuth consoles, mobile config, cron jobs, Stripe webhooks or the canonical `caretip.de` / `www` configuration.
