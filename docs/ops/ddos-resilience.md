# DDoS resilience, traffic abuse and account lockout

Last reviewed 2026-11-26. **CareTip is not DDoS-proof.** Three layers, each with its own limits:

| Layer | What it does | Who provides it | Status |
|---|---|---|---|
| Network / volumetric (L3/L4, large L7 floods) | Absorbs floods before they reach the API | Render (Cloudflare-based, automatic), Netlify (automatic, all plans) | Active, not configurable on current plans |
| Edge rules (WAF, bot rules, per-path rate limits) | Blocks abusive clients at the edge | Cloudflare in front of `api.caretip.de` | **Not in place** (see "Cloudflare readiness") |
| Application (this repository) | Bounds the cost of each request: rate limits, body/time limits, no expensive work before auth | CareTip | Implemented |

A flood large enough to saturate the API instance must be stopped at the first two layers. CareTip's code
keeps a moderate attack or one abusive client from exhausting the database, Stripe, OpenAI, Resend or
Sentry, and keeps legitimate users signed in.

## 1. Protections implemented in CareTip

| Area | Behaviour | Rationale |
|---|---|---|
| Client address | One resolver (`backend/src/lib/clientIp.ts`); `TRUST_PROXY_HOPS` (default 1) or `TRUST_PROXY_CIDRS`; nothing reads `X-Forwarded-For` directly | A forged header prefix is ignored |
| IPv6 | Rate-limit keys use the /64; logs keep the full address | One subscriber owns a /64. A venue's IPv6 Wi-Fi shares one /64, exactly as its IPv4 NAT shares one address today |
| Auth limits | Login IP 100 / email 20 / IP+email 10 per 15 min; register, reset, verification, invites (`authRateLimit.config.ts`) | Before any password hashing |
| **Account lockout** | 5 failures → 5 min, then 10 min per round (email-wide). **Trusted devices** have their own lockout and email limit (section 2) | Stops guessing without letting anyone lock a user out |
| API traffic classes | Per-class IP/user limits on every `/api` request (`securityRateLimit.config.ts`) | Financial writes fail closed when Valkey is down |
| Socket.IO | 120 handshakes per address per 5 min, before any DB read; 16 KB max message | An authenticated handshake costs 4–5 DB reads; clients send no messages |
| Public tip-session lookup | Stripe id shape check; 150 per session per 15 min; malformed ids share one bucket | Each call is a live Stripe request; the rating page polls 1/s for ≤60 s, so the cap is per session |
| Legal webhook | 30 per address per 15 min before the 15 MB body is read; no XML parse when no provider is configured | XML entity expansion is capped at 100 KB per document by the parser (verified) |
| Landing AI | 30 per IP per 15 min + global daily cap `LANDING_AI_DAILY_MAX_CALLS` (default 2000) | Paid OpenAI calls; over the cap, built-in answers |
| Data export | 5 per user per hour | Heavy job per request |
| Health check | One DB probe shared per 5 s | Public and unthrottled for Render |
| Internal jobs | Audit row only for authorised runs | No DB writes for anonymous callers |
| HTTP server | Header timeout 20 s (Node: 60 s); request timeout 300 s (Node's default, kept for slow 10 MB uploads) | The header timeout is the slow-sender protection |
| Sentry | ≤10 events per error context per minute through the general logger (all still logged); critical alerts call Sentry directly and are never throttled | Anonymous callers cannot drain the quota |
| Process | Unhandled promise rejection is logged, not fatal; an uncaught exception still exits (Render restarts) | One forgotten `await` cannot become a restart loop |

## 2. Account lockout policy

**Problem fixed:** the lockout and the per-email login limit were keyed by email only, so anyone who knew
an email could keep its owner out of password sign-in.

**Policy (OWASP "device cookie"):**

- After a correct password, the browser receives `caretip_device`: httpOnly, Secure, SameSite as the refresh
  cookie, host-only, `Path=/api/auth` (sent only where it is read), signed with a key derived from
  `JWT_SECRET`, bound to that email and to the account's credential version, valid 180 days.
- A password reset or change (and "sign out everywhere") bumps the credential version and retires every
  earlier device cookie, so cookies minted by someone who briefly knew an old password give no separate
  guessing budgets. The rate limiter checks the signature only (no database before limiting); the
  password step also checks the version, so a stale cookie never escapes the email-wide lockout.
- Signing out keeps the cookie: it is not a session and grants nothing without the password.
- With a valid cookie for the email, failures count in that device's own lockout and email limit.
- Without one (attackers, new browsers, the mobile app which keeps no cookies), the email-wide lockout and
  limit apply exactly as before, so rotating IP addresses or distributing the attack gains nothing.
- A completed password reset clears the email-wide lockout.
- Unchanged: identical responses for registered and unknown emails; password and MFA always verified;
  Google/Apple/Facebook sign-in are not subject to the password lockout; lock events are logged with scope.

**Trade-offs:** a stolen device cookie gives its holder that device's own 5 attempts per lock period (no
worse than before, and it still needs the password). A user on a new device during an attack waits out the
lock or resets the password. One email per browser (the latest sign-in).

## 3. Valkey (Redis) outage behaviour

- Commands time out after 500 ms, connects after 3 s (`RATE_LIMIT_REDIS_*_TIMEOUT_MS`). On a failure the
  connection is closed and the store waits 30 s before reconnecting; meanwhile checks answer from memory
  immediately (verified against a fake Valkey that accepts connections and stops answering).
- During an outage limits are **per instance** and in memory: with N instances, the fleet allows N times
  each limit (set `RATE_LIMIT_FALLBACK_INSTANCE_COUNT=N` to divide auth limits). Financial-write limits
  refuse instead. The memory store holds 50,000 buckets and evicts the oldest when flooded with keys.
- The login lockout uses the same client: during an outage each instance keeps its own lockout state.
- Outages and recovery are reported (`[redis] rate_limit_store DEGRADED/RECOVERED`, Sentry).

## 4. Render hostname (`caretip.onrender.com`) and migration plan

The API answers on both `api.caretip.de` and `caretip.onrender.com`. Any protection placed in front of
`api.caretip.de` can be bypassed through the Render hostname until it is disabled.

**Live dependencies found (2026-11-26):**

| Where | Reference | Action |
|---|---|---|
| Mobile app | `mobile/constants/config.ts` `PRODUCTION_API_URL`; `mobile/eas.json` `EXPO_PUBLIC_API_URL` (two profiles) | Change to `https://api.caretip.de`, release, wait for adoption |
| Apple Sign in (Android/web return URL) | Registered at Apple: `https://caretip.onrender.com/api/auth/apple/native-callback` (`.env.example`) | Add the `api.caretip.de` URL at Apple first, then remove the old one |
| Web CSP | `scripts/spa-csp-policy.mjs` → `public/_headers`, `vercel.json` (`https://`/`wss://caretip.onrender.com`) | Remove after the web app no longer needs `VITE_LEGACY_API_URL` |
| Web session migration | `VITE_LEGACY_API_URL` (`src/app/lib/apiOrigin.ts`) moves sessions from the old host | Unset once sessions have migrated (refresh cookies live ≤ their max age) |
| Cron runner default | `backend/scripts/render-category-retention-http.mjs` defaults to the Render host; `render.yaml` sets `api.caretip.de` | Already overridden; change the default when convenient |
| Docs and test scripts | Several `backend/scripts/*`, `docs/*` | No runtime effect |

Not found in the repository (check in the dashboards): Stripe Live webhook endpoint URLs (test-mode
endpoints use `api.caretip.de`), Facebook and Google OAuth redirect URIs, Render health check path.

**Order:** (1) ship the mobile release and confirm adoption; (2) move Apple, Facebook and Google redirect
URIs and any Stripe Live webhook to `api.caretip.de`; (3) watch Render logs for requests with
`Host: caretip.onrender.com` for 2 weeks; (4) remove the CSP entries and `VITE_LEGACY_API_URL`;
(5) disable the Render subdomain (dashboard toggle, or `renderSubdomainPolicy: disabled`; it then answers
404). **Rollback:** re-enable the subdomain in Render (immediate).

## 5. Cloudflare readiness for `api.caretip.de`

Do this only after section 4, step 5.

1. **DNS:** keep the `CNAME api → caretip.onrender.com` as **DNS only** until Render shows the certificate
   valid, then switch to **Proxied**. Remove any `AAAA` records (Render is IPv4).
2. **TLS:** SSL mode **Full (strict)** (Render serves a valid certificate for the custom domain). Always
   Use HTTPS on; minimum TLS 1.2.
3. **Origin protection:** the Render subdomain must already be disabled; otherwise Cloudflare is bypassed.
   Whether Render can restrict inbound traffic to Cloudflare's addresses was not established in this
   review; check Render's current options. Without such a restriction, `TRUST_PROXY_CIDRS` (step 4) still
   prevents a direct caller from choosing its rate-limit address.
4. **Client address (do not guess the hop count):** first measure. Call
   `GET https://api.caretip.de/health` with the `x-health-secret` header (value: `HEALTH_CHECK_SECRET`) before
   and after enabling the proxy; the `proxy` section shows the forwarded-chain length, each entry's kind
   and /24 prefix (public and carrier-grade addresses only; internal addresses by kind alone; never a full
   address or header value; the trust mode is shown, not the configured ranges), the connecting peer, and
   whether `CF-Connecting-IP` equals the resolved address. It describes only the request that asks.
   - Expected after proxying: the rightmost forwarded entry is a Cloudflare edge address.
   - Then set `TRUST_PROXY_CIDRS` to Cloudflare's published ranges (https://www.cloudflare.com/ips/),
     comma-separated. Private, loopback and link-local peers are trusted automatically; if the measured
     peer is `cgnat` (100.64/10), add that range too.
   - Do **not** set `TRUST_PROXY_HOPS=2` blindly: if any request reaches the origin with fewer proxies, the
     client could choose its own address. The CIDR list is safe against that.
   - Verify: `cfConnectingIpMatchesResolved: true`, and rate-limit logs show varied client prefixes.
5. **WAF / rate rules:** managed WAF rules on; rate rules on `/api/auth/*` (e.g. 60 per minute per IP) and
   `/api/payments/create-tip-session`; challenge (not block) for suspicious bots on HTML-less API paths
   only where no mobile app traffic is affected. Keep CareTip's own limits; edge rules are a first filter.
6. **Exempt:** `/api/webhooks/*` and `/api/webhook/*` (Stripe; signature-verified), `/api/internal/jobs/*`
   (Render cron; secret-verified), `/api/legal/webhook` (IT-Recht), `/health` and `/api/health`.
7. **WebSockets:** supported on all plans; the 25 s Socket.IO ping keeps connections alive.
8. **Rollback:** set the record back to DNS only (takes effect within minutes), then remove
   `TRUST_PROXY_CIDRS`.

## 6. Database statement timeout (recommendation, not applied)

- The app connects as role **`postgres`** through Supabase's shared pooler (transaction mode, port 6543,
  5 connections per instance). The same role runs migrations, the dashboard SQL editor and maintenance.
- Supabase today: `postgres` has no role timeout and is capped by the global 2-minute default.
- A role-level setting applies to pooled connections; `SET` from the app would not (transaction mode).
- A statement timeout rolls back the whole transaction (no partial financial write). Stripe webhooks retry
  and payment work is idempotent and reconciled, so a timeout surfaces as a retried error, not drift.
- 15 s is too tight: unbounded CSV exports, retention/anonymisation batches, analytics and migrations can
  run longer. **Recommended: 30 s after measuring.**

Rollout:
1. Measure: `select query, calls, max_exec_time from pg_stat_statements order by max_exec_time desc limit 30;`
2. If nothing legitimate exceeds ~10 s: `alter role postgres set statement_timeout = '30s';`
   and `alter role postgres set idle_in_transaction_session_timeout = '60s';`
3. Verify with `select rolname, rolconfig from pg_roles where rolname = 'postgres';` (not `SHOW`).
4. A migration that may run longer must start with `SET statement_timeout = 0;`.
5. Rollback: `alter role postgres reset statement_timeout;` (new connections).
A dedicated application role would allow a tighter timeout without touching migrations (larger change).

## 7. Monitoring

| Signal | Implemented in CareTip | Manual setup required |
|---|---|---|
| 5xx rate | In-process watch: ≥200 requests and >2 % 5xx over 5 min per instance → Sentry issue tagged `caretip_alert=api_5xx_rate` (≤1 per 15 min; health checks excluded) | Sentry issue alert: tag `caretip_alert` equals `api_5xx_rate` → email, **high** |
| DB pool timeouts | Prisma errors carry tag `prisma_code` (e.g. `P2024`) | Sentry issue alert: tag `prisma_code` equals `P2024` → email, **high** |
| Valkey degraded/recovered | Already reported to Sentry and logs | Sentry issue alert on the Redis degraded issue → email, **medium** |
| Service unhealthy, deploy/cron failure | — | Render notifications (email): unhealthy service, failed deploy, failed cron, **high** |
| CPU / memory | — | Render has no threshold alerts. Watch Render Metrics; for alerts use a metrics stream (Pro plan) to e.g. Grafana: CPU or memory >80 % for 10 min, **medium** |
| Rate-limit blocks | Logged (`[security.rateLimit] blocked`, `[auth.rateLimit] blocked`, `[auth.lockout] account sign-in locked`) | Optional log alert if your log tool supports it |

False positives: a deploy restarting instances (5xx monitor excludes health checks, but a short burst of
errors from a broken deploy is a real signal); the 5xx watch is per instance; Sentry's free plan supports
email issue alerts but not rate-based alert types.

## 8. Incident response

1. **Traffic spike / slow API:** check Render Metrics (requests by status), Sentry for `api_5xx_rate`,
   `P2024`, Redis degraded. Rate-limit block logs show which scope and IP prefixes are hit.
2. **Credential stuffing:** `[auth.lockout] account sign-in locked` and login 429s rise; trusted devices
   keep working. If one prefix dominates, block it at Render/Cloudflare.
3. **Valkey down:** limits continue per instance; financial writes return 429 until Valkey is back. Restore
   Valkey; the store reconnects within 30 s.
4. **Database pool exhaustion (`P2024`):** look for long queries (`pg_stat_activity`), consider scaling
   instances only together with `RATE_LIMIT_FALLBACK_INSTANCE_COUNT` and Valkey.
5. **Large L7 flood:** beyond application limits; requires Cloudflare (section 5) or Render support.

## 9. Production configuration still required

- `REDIS_URL` on the web service (shared limits and lockout). `RATE_LIMIT_FALLBACK_INSTANCE_COUNT` when
  running more than one instance.
- Optional: `LANDING_AI_DAILY_MAX_CALLS`, `RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS`,
  `RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS`, `HEALTH_CHECK_SECRET` (for the proxy measurement).
- Sentry and Render alerts in section 7; database timeout in section 6; hostname migration and Cloudflare
  in sections 4–5.
