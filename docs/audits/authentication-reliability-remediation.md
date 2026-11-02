# CareTip — Authentication Reliability Remediation

Status: implemented locally, **not committed, not deployed**. Branch `main`, HEAD `fc295030`.

## 1. Executive summary

The refresh path used to treat several non-authentication events as "your session is invalid". This
logged users out even though their session was fine. The events were:

- database or pooler failures;
- a refresh response lost in transit;
- two refreshes racing on one cookie;
- a 12-second client timeout.

This change separates those cases:

- **Infrastructure failures** now return `503` without touching the cookie. The middleware returns
  `503 AUTH_UNAVAILABLE` instead of `401` when the session store is unreachable.
- **Lost responses** are recovered through a server-side 60-second rotation grace window. The
  window is restricted to the current replacement chain and never revives logout or expired
  sessions.
- **Concurrent rotations** produce exactly one winner. The loser gets `409 REFRESH_CONFLICT` with
  no `Set-Cookie`, so it can neither revoke nor clear the winner's cookie.
- **The client** no longer blindly replays the refresh POST. It aborts the request at the
  12-second deadline and holds the cross-tab lock until the aborted request has settled.
- **Every refresh outcome** is logged as one structured, token-free line.

Two items are **not** fixed by this change and still need an architecture decision:

- **Third-party cookies.** Browser refresh still depends on a third-party cookie on
  `caretip.onrender.com` (section 12).
- **Facebook logout.** Logout does not revoke Facebook sessions. This defect predates this work
  and was found during the investigation.

## 2. Confirmed root causes addressed

| User ID | Root cause (verified in code at `fc295030`) | Fix |
|---|---|---|
| F1 | `rotateRefreshToken` caught every error and returned `null`, so the controller cleared the cookie and returned 401 | Typed outcomes, plus `RefreshTokenStoreUnavailableError` (classified with `instanceof`, no string matching). The controller returns 503 without changing the cookie |
| F2 | Rotation committed but the response was lost, so the retry with the old cookie looked like reuse and cascaded to a full logout | Bounded 60-second grace recovery to the current chain head (section 4) |
| F3 | Two concurrent rotations: the loser saw a "revoked" token and ran the reuse cascade, revoking the winner | Insert-first ordering and a conditional `updateMany` as the single commit point. The loser deletes its never-issued row and returns 409 without a cookie change |
| F4 | Middleware DB failure was caught by the JWT `try` and answered 401 | JWT verification and DB lookups are separated. DB failure returns 503 `AUTH_UNAVAILABLE`, and every 401 check is unchanged |
| F5 | The coordination timeout released the lock while the original request continued, so two refreshes could overlap | `runWithRefreshDeadline`: aborts with `AbortSignal` and waits for settle (5-second cap) before releasing the lock |
| F6 | `fetchWithNetworkRetry` and the retry loop re-sent the POST after ambiguous failures | Plain `fetch` with no replay. Only `409` or `503 retryable:true` are retried, once |
| F7 | No server-side reason for refresh failures | `auth.refresh` structured JSON log with a reason code |

## 3. Files changed and why

**Backend:**
- `backend/src/services/refreshToken.service.ts`:
  - `rotateRefreshTokenWithOutcome`;
  - typed outcomes;
  - `RefreshTokenStoreUnavailableError` with a `committed` flag;
  - grace recovery and the conflict path;
  - injectable store and clock for isolated tests.

  The strict `rotateRefreshToken` wrapper is kept with `graceMs: 0` for existing callers and
  scripts.
- `backend/src/controllers/auth.controller.ts`: the `refresh()` handler maps each outcome to an
  HTTP response, logs diagnostics, and has a test hook for the post-rotation user lookup. Prisma
  errors are classified with `instanceof`.
- `backend/src/middleware/auth.middleware.ts`: 503 on store failure, and a test hook for the
  lookup store.
- `backend/src/lib/authRefreshDiagnostics.ts` (new): reason codes and a safe logger.
- `backend/scripts/auth-refresh-reliability-runtime.ts` (new) and `backend/package.json`: the
  `test:auth-refresh-reliability` script.

**Frontend:**
- `src/app/lib/authRefreshCoordination.ts`: the runner now receives an `AbortSignal`. Adds
  `runWithRefreshDeadline` and `REFRESH_ABORT_SETTLE_MAX_MS = 5000`.
- `src/app/lib/api.ts`:
  - no-replay refresh;
  - bounded retry on confirmed no-commit;
  - abort passed through;
  - transient failures never clear the session (`apiRequest`, `fetchAuthedObjectUrl`,
    `refreshSessionAPI`, `bootstrapRefreshSession`);
  - `fetchWithNetworkRetry` refuses to retry `/api/auth/refresh`.

**Tests:**
- `scripts/auth-refresh-coordination-runtime.ts`:
  - real 12-second tests F2 and F3;
  - corrected the test [E] label, which said ">20s" but slept 250 ms;
  - the architecture check updated to the new `(signal) =>` call form.
- `scripts/auth-navigation-session-preservation-runtime.ts`: the AUTH-16 source check is updated
  to the deliberately narrower clearing condition. The behavior is covered by new `api401` checks.
- `scripts/auth-refresh-reliability-frontend-runtime.ts` (new), `scripts/run-vite-ssr-runtime.mjs`
  (new) and `package.json`: the `test:auth-refresh-reliability-frontend` script. The runner loads
  the test through Vite SSR so `import.meta.env` works. It uses an inline config with **no env
  files**, so no local or production URLs or secrets are loaded.

**Report:** `docs/audits/authentication-reliability-remediation.md`.

**Out of scope.** The following pre-existing dirty files are untouched and still uncommitted:
- the six deleted markdown files;
- `public/sitemap.xml`;
- `images/caring001.webp` and `new-employee.jpeg`;
- the German tip-email change: `i18nEmail.ts`, `employeeTipNotificationPrefs.ts` and
  `employee-tip-email-deep-link-runtime.ts`.

## 4. Detailed rotation recovery design

**Write order for one rotation:**
1. Look up the presented token by hash.
2. **Insert** the replacement row.
3. Run a conditional `updateMany({ where: { id, revokedAt: null }, data: { revokedAt, replacedByTokenId } })`.
   This is the **only commit point**.
4. If the count is not 1, another request won. Delete the never-issued replacement and return
   `conflict`.

**Why there are no transactions.** Production uses the Supabase transaction pooler (6543,
`connection_limit=5`). Interactive Prisma transactions there have produced P2028 before, so the
design avoids them. The conditional update is an atomic single statement and is safe on PgBouncer
transaction mode. A failed compensating delete leaves an orphan row that was never sent to any
client and expires naturally. It cannot authenticate anyone, because nobody holds its raw token.

**Grace recovery.** This applies only when **all** of these hold:
- the presented token is revoked **and** has `replacedByTokenId` set, so it was rotated, not
  logged out;
- `now − revokedAt ≤ 60 s`, using the server clock and DB timestamps only;
- the presented token itself is unexpired;
- following `replacedByTokenId` (at most 5 hops) reaches a head that is active (`revokedAt` null)
  and unexpired.

If the walk does not reach a head within 5 hops, the request is rejected as `revoked_logout`
**without** the reuse cascade. Five rotations of one chain inside 60 s indicate abuse, not a lost
response. Skipping the cascade here is the one narrow case where the new code is more lenient than
the old immediate cascade. Tightening it to cascade is a one-line change if preferred.

The head is then rotated normally. One new token is issued and the head is revoked, so the chain
still has exactly one active session. Two recoveries racing on the same head resolve through the
same conditional update, giving one winner and one 409.

**Never recovered.** These keep the previous behavior:
- **Logout-revoked token** (`replacedByTokenId` null): `revoked_logout`, 401, no cascade.
- **Replaced token whose chain was later logged out:** `revoked_logout`, 401.
- **Expired token:** `expired`, 401.
- **Replay outside 60 s:** `reuse_detected`, which runs the existing cascade revoking all of the
  user's sessions.

**Strict wrapper.** `rotateRefreshToken` uses `graceMs: 0`. It is used by existing DB scripts and
preserves their immediate-replay cascade contract (test 8b).

## 5. Infrastructure error handling changes

| Failure point | Response | Cookie | `retryable` |
|---|---|---|---|
| Token lookup / replacement insert fails | 503 `REFRESH_UNAVAILABLE` | unchanged | `true` (nothing committed) |
| Conditional revoke fails | 503 | unchanged | `false` (may have committed) |
| Rotation committed, then user lookup throws a Prisma error | 503 | **new cookie set** | `true` (retry uses the new token) |
| Any Prisma error reaching the outer catch | 503 | unchanged | `true` |
| Middleware user/session lookup throws | 503 `AUTH_UNAVAILABLE` | n/a | n/a |

401 is still returned for:
- missing, invalid or expired JWT;
- `tv` mismatch;
- revoked, mismatched or expired `sid`;
- inactive or missing user;
- role checks;
- missing cookie;
- not-found, logged-out, expired or reused refresh tokens.

`EmailNotVerified` is still 403.

## 6. Frontend retry and coordination changes

**Refresh POST behavior:**
- The POST is sent with plain `fetch` and **never replayed** after a network error, a 502, or a
  `503` without `retryable:true`. The result is transient: `shouldClearSession: false`, a cooldown
  is set, and the session is kept.
- `409`, or `503 retryable:true`, is retried **once**, after 400 ms or 500–2000 ms respectively.
- `401`/`403` are definitive.

**Deadline and lock:**
- `REFRESH_COORD_TIMEOUT_MS` (12 s) now aborts the in-flight request through `AbortSignal`.
- The Web Lock, or the localStorage fallback lock, is held until the aborted request settles, with
  a hard cap of 5 s. The lock can never be held for more than 17 s.
- The caller gets a transient `504`, never a logout.

**Session clearing:**
- `apiRequest` and `fetchAuthedObjectUrl` no longer clear the session on a 401 when the refresh was
  only temporarily unavailable.
- `refreshSessionAPI` reports 409, 429, 5xx and abort with the non-definitive service-unavailable
  message.
- `bootstrapRefreshSession` maps any `shouldClearSession: false` result to `transient_error`.

The degraded-mode bootstrap, with a 4-second retry and the 12-second bootstrap timeout, is
unchanged.

## 7. Security properties preserved

- The refresh cookie is still HttpOnly. Its Secure, SameSite and path attributes are unchanged.
  No tokens are stored in localStorage.
- Revoked tokens are not generally valid. Only a rotated token, within 60 s, on a chain whose head
  is active and unexpired, can mint **one** successor, and doing so revokes the head.
- Logout is never revived. Expired sessions are never revived. The reuse cascade still fires
  outside the window.
- The middleware still enforces `tv`, `sid`, active account, MFA and role checks. Only the HTTP
  status changes when the store cannot answer.
- Logs contain user and session IDs, reason, status, timings and Prisma error codes. They never
  contain tokens, cookies, headers or secrets (asserted by a test). A logging failure cannot break
  refresh.

**Accepted residual.** An attacker holding a stolen, already-rotated token may use it once within
60 s of the victim's rotation. This produces "ping-pong" between attacker and victim instead of an
immediate cascade. The prior design cascaded immediately, so this is a deliberate trade-off for
lost-response recovery. It is bounded by the 60-second window, by chain-head validity, and by the
victim's next rotation.

## 8. Tests added and their actual results

All runs are local, with **no database or credentials**. They use in-memory stores and scripted
`fetch`.

**`backend: npm run test:auth-refresh-reliability`: 17/17 PASS.**

| Scenario | What it checks |
|---|---|
| 1 | Lookup failure gives 503 retryable, cookie untouched, no reuse event |
| 2a | Insert failure gives 503 retryable, and the old token still works |
| 2b | Revoke failure gives 503 non-retryable, with no session-wide revoke |
| 2c | Committed rotation followed by a user-lookup failure gives 503 with the new cookie delivered |
| 4 | Genuinely overlapping refreshes produce one chain. The loser gets 409, and its response contains no cookie set or clear |
| 5 | Rotation commits, then the response is dropped. The retry with the old cookie recovers without logout |
| 7 | Grace boundary at exactly 60 s recovers without an extra active session |
| 7b | A multi-hop chain recovers to the current head only |
| 8 | At 60 s + 1 ms the replay triggers the reuse cascade, revoking all sessions, and is logged |
| 8b | The strict wrapper keeps the immediate cascade |
| 9 | A logged-out token is never recovered and does not cascade |
| 9b | A rotated token whose chain was later logged out is not recovered |
| 10 | An expired token is not recovered |
| 16 | An inactive account cannot restore a session |
| missing cookie | 401 `missing_cookie` with no Set-Cookie |
| log safety | No token or cookie values in logs, and a throwing logger does not break refresh |
| 3 | Middleware store failure gives 503, while invalid JWTs still get 401 |

**Mutation check.** With the grace window disabled in the controller, scenarios **5, 7, 7b and 9b
failed**. This proves they detect the lost-response defect. The change was reverted.

**`npm run test:auth-refresh-reliability-frontend`: 31/31 PASS** against the real `api.ts`.

| Scenario | What it checks |
|---|---|
| 11 | A network failure is transient. The cached user is kept and the session is not marked revoked |
| 12a | One POST on an ambiguous network error |
| 12b | 409 is retried exactly once and the token is kept |
| 12c | 503 `retryable:true` is retried once |
| 12d | 503 `retryable:false` is not replayed |
| 12e | 502 is not replayed |
| 12f | Persistent 409 stops at two POSTs |
| 12g | 401 is definitive with one POST |
| msg | The `refreshSessionAPI` 409 error is non-definitive |
| 13a | Concurrent callers in one tab produce one POST |
| 13b | Two tabs overlap in time, yet the maximum number of POSTs in flight is 1 and both end authenticated |
| 14 | A degraded first attempt is followed by recovery without re-login |
| 15 | After a logout signal from another tab: unauthenticated, with **zero** POSTs |
| api401 | A transient refresh failure on an API 401 keeps the session, while a definitive refresh 401 still clears it |
| F5 | The **real 12-second deadline** aborts the hung POST at 12,070 ms. It is not replayed, and the user is kept |

**Mutation check.** With blind replay re-introduced after a network error, **4 checks failed**
(11, 12a and two in 14). The change was reverted.

**`npm run test:auth-refresh-coordination`: 38/38 PASS.** This is the existing suite plus the new
checks:
- **F2 (real 12 s).** The abort fired at 12,025 ms. The queued tab started only after the aborted
  request settled.
- **F3 (real 12 s, runner ignores the abort).** The lock was released at 17,015 ms, which is the
  deadline plus the settle cap, and not earlier.
- The existing **F** test, a real 12.2 s sleep, still passes.

## 9. Existing regression suites and actual results

**Root suites, all PASS:**
- `test:auth-refresh-security`: 23 checks;
- `test:auth-logout-session-expired`;
- `test:auth-navigation-session-preservation`: 13/13, after the AUTH-16 source-string update in
  section 3;
- `test:auth-loading-recovery`;
- `test:auth-post-login-return`;
- `test:idle-session`: all 6 sub-suites.

**Backend suites, all PASS:**
- `auth-middleware-dedup`;
- `security-remediation`;
- `employee-tip-email-resend-adapter`;
- `employee-tip-email-deep-link`;
- `employee-tip-notification-prefs`;
- `oauth-welcome-email`.

**Not run.** These use `dotenv -e ../.env` and connect to the shared Supabase database used by
production, so they are unsafe without an isolated database:
- `test:auth-refresh-reuse-detection`;
- `test:password-reset-session`;
- `test:oauth-expansion`;
- `test:facebook-oauth-*`;
- `test:business-2fa-login`;
- `test:auth-enumeration`;
- `test:security-hardening`;
- `test:sprint2-security`;
- `test:api-security-sprint`.

`test:auth-refresh-multitab-browser` and `test:fanny-session-loss-browser` were also not run,
because they need a live backend and credentials.

## 10. Lint, type-check and build results

- Backend `tsc --noEmit`: **pass**, re-run after the final edit.
- Frontend `tsc --noEmit`: **pass**.
- ESLint on the changed frontend files: **0 errors**. There is 1 pre-existing warning: the unused
  import `migrateLegacyAccessTokenFromStorage` in `api.ts`, which is already in HEAD. The backend
  and `scripts/` files are excluded by the repository's ESLint ignore patterns.
- `npm run build` (Vite, PWA and SEO prerender): **pass**.

## 11. Remaining risks

1. **Third-party cookie dependency**, for password, Google and Apple sign-in (section 12). This is
   the biggest remaining source of "logged out after reload" in Safari, in Chrome with third-party
   cookies blocked, and in in-app browsers.
2. **Facebook-session logout does not revoke the session.** This predates this work and was found
   during the investigation. The owner has since confirmed that Facebook login is retired, so this
   only affects any legacy Facebook sessions still within their 7-day expiry. It is not being fixed.
   - The Facebook refresh cookie lives on `caretip.de`, through the Netlify proxy.
   - `logoutAPIWithTimeout` posts to `VITE_API_URL`, the Render host, which never receives that
     cookie.
   - The server's `logout` revokes only the session named by the cookie it receives.
   - Result: the client state is cleared, but the server session and the `caretip.de` cookie stay
     valid until expiry, up to 7 days, on that device.

   Recommended fix, needing owner approval: route logout through the same origin as refresh
   (`resolveBrowserAuthRefreshUrl` logic), or revoke by the Bearer `sid` as well.
3. **An outage longer than 60 s after a committed-but-lost refresh** still ends in the reuse
   cascade, which matches the old behavior.
4. **Stolen-token ping-pong within 60 s** (section 7).
5. **The `committed=false` failure path** leaves at most one orphan refresh row that was never
   issued and expires within 7 days.
6. **Shared database.** The DB-backed auth suites could not be run safely. The new behavior is
   covered by isolated tests, but has not yet been validated against real Postgres.

## 12. Third-party-cookie investigation findings

- **Frontend API base.** Production uses `VITE_API_URL`, which is cross-site to
  `caretip.onrender.com` and called with `credentials: "include"`. Local dev always uses the Vite
  proxy.
- **Netlify.** `public/_redirects` contains `/api/*  https://caretip.onrender.com/api/:splat  200`.
  This is a proxy rewrite, so `Set-Cookie` without `Domain` becomes host-only on the page host. It
  already exists and is already used in production by the Facebook flow.
- **Cookie.** `caretip_refresh` is HttpOnly. It is `Secure` and `SameSite=None` in production, has
  path `/` and no `Domain`. Clearing uses matching attributes.
- **Flows:**

  | Flow | How it works | Where the cookie lands | Third-party dependent? |
  |---|---|---|---|
  | Password login | XHR to `VITE_API_URL` | Render host | **Yes** |
  | Google (GIS) | Credential exchanged by XHR `oauthAPI` to `VITE_API_URL` | Render host | **Yes** |
  | Apple (JS SDK popup) | Exchanged by XHR to `VITE_API_URL` | Render host | **Yes** |
  | Facebook | Full-page form POST to same-origin `/api/auth/facebook/start`, then the callback through the proxy | `caretip.de` | No. The client sets `caretip_page_origin_refresh` and refreshes through `/api/auth/refresh` on the page origin |

- **CORS and trusted origin.** Allowed origins are `https://caretip.de`, `https://www.caretip.de`,
  plus `FRONTEND_URL`, `NEXT_PUBLIC_APP_URL`, `VITE_APP_URL` and `CORS_ORIGINS`.
  `requireTrustedOrigin` accepts Origin/Referer from that list, or `X-CareTip-Client: 1`. Requests
  through the proxy carry `Origin: https://caretip.de`, so they pass unchanged.
- **Apex vs www.** Host-only cookies set via the proxy on `caretip.de` are **not** sent to
  `www.caretip.de`, and the reverse is also true. Whether Netlify redirects www to the apex (or the
  apex to www) could not be verified from the repository. `netlify.toml` and `_redirects` have no
  host redirect, so it is presumably configured in the Netlify domain settings.
- **Can the proxy support all flows?** Technically yes. The Facebook flow already proves that
  cookie set, refresh and Origin checks work through it. Open items before switching:
  - **Client IP and rate limits.** The backend uses `app.set("trust proxy", 1)`. Behind both Netlify
    and Render, `req.ip` will likely become a Netlify egress IP. Per-IP limiters, such as the
    global 400 requests per IP per 15 minutes, would then pool many users into one bucket. This
    needs a verified XFF policy, for example `trust proxy` set to 2, or a keyed header, before
    migrating.
  - **Socket.IO.** Netlify proxies do not carry WebSockets. Sockets should keep using the direct
    API URL with their own token auth, so this needs verification.
  - **Latency and timeouts.** There is an extra hop, and Netlify proxy timeouts apply to slow or
    cold-starting Render responses. This matters with the 12-second refresh deadline.
  - **Logout parity.** Logout must use the same origin as the cookie (risk 2 in section 11).
  - **Session migration.** Users with existing sessions hold their cookie on the Render host. A
    switch needs either a one-time cross-site refresh that re-issues the cookie on the page origin,
    or a single forced re-login.

## 13. Whether a production architecture change is still required

**Yes.** This remediation removes the false logouts caused by:
- infrastructure errors;
- races;
- lost responses;
- timeouts.

It cannot fix browsers that refuse the third-party cookie on `caretip.onrender.com`. For those
users, password, Google and Apple sessions still do not survive a reload.

Recommended target: serve the API **same-site**. The options, in order of preference:
1. A first-party API subdomain such as `api.caretip.de`, which is same-site, needs no proxy hop,
   and keeps WebSockets direct.
2. Route all browser auth through the existing Netlify `/api/*` proxy, after resolving the items
   in section 12.

This is an owner decision and was not changed here.

## 14. Exact owner actions required before deployment

1. Review and authorize a local commit. Nothing has been committed or pushed.
2. Optionally, run the DB-backed auth suites (section 9) against an **isolated** Supabase branch
   or a local Postgres, not the shared production database.
3. Deploy the backend and frontend together:
   - **Backend first** is safe: old clients treat 409 and 503 as transient.
   - **Frontend alone** is also safe: the new client handles the old server's 401 the same as
     before.
4. After deploy, monitor the Render logs for `"event":"auth.refresh"`. Expected:
   - `reason: "ok"` with `recovered: true`: lost-response recoveries.
   - `rotation_conflict`: tab races.
   - `db_error`: pooler problems, with `errorCode` set.
   - `reuse_detected`: should be rare. A spike means replay attacks or outages longer than 60 s.
5. Verify in the Netlify domain settings that `www.caretip.de` and `caretip.de` redirect to one
   canonical host.
6. Confirm the production `VITE_API_URL` value in Netlify. Do not paste it into tickets or logs.
7. Decide on the same-site API architecture (section 13) and the Facebook logout fix (risk 2 in
   section 11).

## 15. Git branch, HEAD and final working-tree status

- Branch: `main`. HEAD: `fc295030`. No commits, pushes, merges or deploys were made. No production
  data or configuration was changed.
- Modified for this task:
  - `backend/package.json`;
  - `backend/src/controllers/auth.controller.ts`;
  - `backend/src/middleware/auth.middleware.ts`;
  - `backend/src/services/refreshToken.service.ts`;
  - `package.json`;
  - `scripts/auth-navigation-session-preservation-runtime.ts`;
  - `scripts/auth-refresh-coordination-runtime.ts`;
  - `src/app/lib/api.ts`;
  - `src/app/lib/authRefreshCoordination.ts`.
- New for this task:
  - `backend/src/lib/authRefreshDiagnostics.ts`;
  - `backend/scripts/auth-refresh-reliability-runtime.ts`;
  - `scripts/auth-refresh-reliability-frontend-runtime.ts`;
  - `scripts/run-vite-ssr-runtime.mjs`;
  - `docs/audits/authentication-reliability-remediation.md`. `docs/audits/` is in `.gitignore` at
    line 65, so this report does not appear in `git status`. Committing it requires `git add -f`.
- Pre-existing, preserved and untouched:
  - the six deleted markdown files;
  - `public/sitemap.xml`;
  - `images/caring001.webp` and `new-employee.jpeg`;
  - the German tip-email change: `backend/src/emails/i18nEmail.ts`,
    `backend/src/services/notifications/employeeTipNotificationPrefs.ts` and
    `backend/scripts/employee-tip-email-deep-link-runtime.ts`.
