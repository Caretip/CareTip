# Running the API on more than one Render instance

Moving the backend from one Render instance to two. Every step that changes production (Render, Supabase, Netlify, instance count) needs explicit approval first. Nothing here is automatic.

## What has to be true before a second instance

| Area | Requirement | Why |
| --- | --- | --- |
| Live events | `REDIS_URL` set and `SOCKET_REDIS_ADAPTER_ENABLED=true` on the web service | Without the adapter, a dashboard only gets events raised on the instance it happens to be connected to. |
| Rate limits | Same `REDIS_URL` | Counters are shared. Without Redis each instance counts on its own, so the effective limit doubles. |
| Outage fallback (optional) | `RATE_LIMIT_FALLBACK_INSTANCE_COUNT`, default **1** | Has no effect while Redis is healthy. During a Redis outage with two instances, the default 1 lets each instance allow the full auth/MFA limit, so the effective limit **doubles**. Setting it to 2 halves each instance's share and keeps the fleet total at the limit. Deciding to set it is a production change that needs approval. |
| Socket transport | Frontend build containing the WebSocket-only change | Long-polling needs sticky sessions, which Render does not provide. |
| Database | Supabase capacity checked (below) | Each instance holds its own Prisma pool, and deploys briefly run old and new instances side by side. |
| Shutdown | Render shutdown delay of at least 30s (the default), `SHUTDOWN_DRAIN_MS` below it (default 25000) | In-flight requests finish before the old instance exits. |

## Redis (Render Key Value)

- Same region as the web service. Use the **internal** connection URL.
- No persistence needed: it holds rate-limit counters (expire on their own) and pub/sub traffic.
- **Connections:** 3 per API instance (1 rate-limit client, 1 Socket.IO publisher, 1 subscriber).
  - 2 instances: 6. During a deploy (old and new overlap): up to 12. The plan must allow at least 12, ideally 20 or more.
- Memory: small (counter keys of at most a few hundred bytes each, with TTLs).
- Eviction policy: `noeviction` or `volatile-*`. Every key carries a TTL.
- Never commit the URL. Set it only in the Render dashboard.

## Supabase (verify in the dashboard; these are requirements, not known values)

Prisma uses the **transaction pooler** (port 6543) with `connection_limit = DATABASE_CONNECTION_LIMIT` (default 5) per process. Migrations run once per instance start through the **session pooler** (port 5432).

| Scenario | Pooler client connections |
| --- | --- |
| 1 instance | 5 (plus ~1 session-mode connection during `migrate deploy`) |
| 2 instances | 10 |
| 2 instances during a deploy (old and new up together) | up to 20 (plus ~2 for migrate) |
| Other clients | local dev servers pointed at the hosted DB (5 each), scripts, Studio. Render Cron Jobs call the API over HTTP and open none. |

- **Max Client Connections** (pooler): at least 30 recommended (20 during a deploy + one dev server + headroom).
- **Pool Size** (server-side connections the pooler keeps per user/database): at least 10–15. In transaction mode this limits how many transactions run at once, not how many clients connect.
- Keep `DATABASE_CONNECTION_LIMIT=5` on the web service. All instances share the service's environment, so the value is the same everywhere.
- The previously mentioned "limit of five" must be identified. If it is Max Client Connections, even one instance plus a dev server would exceed it, and two instances cannot run.
- Pool exhaustion shows up as Prisma `P2024` (pool timeout after 30s) in logs and Sentry.
- Advisory locks (`pg_advisory_xact_lock`) and row locks are transaction-scoped and work through the transaction pooler. Nothing relies on session-level locks.

## Netlify

- `VITE_API_URL` must point straight at the Render API. Since the first-party API domain migration that is `https://api.caretip.de` (a Render custom domain on the same web service); `VITE_LEGACY_API_URL` may still name `https://caretip.onrender.com` while old sessions move over. `public/_redirects` proxies only `/api/*` and has no `/socket.io` rule, so sockets only work against the API host directly, which this setup does.
- `public/_headers` already allows `wss://*.caretip.de` in `connect-src`, which the WebSocket-only clients need.
- Check under Site settings, Environment variables. Both instances serve the same custom domain, so nothing changes there when scaling.

## Environment variables on the Render web service

```
REDIS_URL=<internal Key Value URL>          # secret, dashboard only
SOCKET_REDIS_ADAPTER_ENABLED=true
# RATE_LIMIT_FALLBACK_INSTANCE_COUNT=1      # default (absent = 1); outage-only, see "Behaviour while Redis is unavailable"
DATABASE_CONNECTION_LIMIT=5
# SHUTDOWN_DRAIN_MS=25000                   # default; keep below Render's shutdown delay
```

Cron Jobs need none of these. They keep calling `/api/internal/jobs/*` over HTTP.

## Log lines to look for

Healthy start (one per instance, before "Caretip API running"):

```
[redis] socket_adapter ready instance=<id>
[socket] Redis adapter attached: live events are shared across instances
[redis] rate_limit_store ready instance=<id>
```

Outage and recovery (once per change of state, never per error; also sent to Sentry):

```
[redis] socket_adapter DEGRADED instance=<id> from=ready — live events reach only sockets connected to this instance
[redis] rate_limit_store DEGRADED instance=<id> from=ready — rate limits are per instance; auth limits use the divided fallback; financial writes are refused
[redis] socket_adapter STILL DEGRADED instance=<id> for 5min — ...   (then hourly)
[redis] socket_adapter RECOVERED instance=<id> after 42s
[redis] rate_limit_store RECOVERED instance=<id> after 61s
```

Misconfiguration:

```
[socket] REDIS_URL is set but SOCKET_REDIS_ADAPTER_ENABLED is not "true": live events stay on this instance
[rateLimit] REDIS_URL is not set while RATE_LIMIT_FALLBACK_INSTANCE_COUNT > 1: ...
```

Shutdown:

```
[server] SIGTERM: draining (up to 25000ms)
[server] shutdown: all requests finished      # normal
[server] shutdown: drain timeout reached, ... # a request was cut off: investigate
```

Health:
- `GET /api/health`: 200 when the database answers, 503 when it doesn't or the instance is draining. Redis never fails this check. Use it as the Render health check path.
- `GET /health` with header `x-health-secret: <HEALTH_CHECK_SECRET>`: adds Redis component states and the Render instance id. Redis state is deliberately not public in production, so attackers can't tell when limits fall back.

Sentry alerts to configure: issues titled `Redis rate_limit_store degraded`, `Redis socket_adapter degraded`, `Redis … persistently unavailable`, and Prisma `P2024`.

## Behaviour while Redis is unavailable

| Traffic | Behaviour |
| --- | --- |
| Instant payouts, financial writes | Refused with 429 and a short `Retry-After` (fail closed) |
| Login, register, reset, invite, OAuth, MFA, password change | Served. Each instance allows `limit / RATE_LIMIT_FALLBACK_INSTANCE_COUNT`. **With the default (1) and two instances that is the full limit on each, so the fleet allows up to 2x the limit** until Redis returns. With the value set to 2, the fleet total stays at the limit. |
| Other API traffic, public endpoints (QR, tip checkout, leads) | Served. Per-instance counts (up to N times the limit) |
| Live events | Only reach sockets on the instance that raised them. Screens refresh over REST (every 30–60s while disconnected, and once immediately on reconnect) |
| Cache invalidation across instances | Paused. Entries expire on their TTL (up to 10 min for the dashboard context) |

Only during the outage: with Redis healthy, every limit is a single shared Redis counter and RATE_LIMIT_FALLBACK_INSTANCE_COUNT is not read. When Redis returns, each instance reconnects on its own, with no restart: on the next limited request once its 30s retry cooldown has passed, or at the latest through the 60s background check (worst case about 90s with no traffic). Counts made in memory during the outage are not copied to Redis.

The API keeps serving through a Redis outage. A Redis failure can no longer crash the process (the previous adapter setup did, after about 11s of outage).

## Rollout

1. Merge the reviewed code. **Do not change the instance count yet.**
2. Create the Key Value instance (approval: paid service). Set `REDIS_URL`, `SOCKET_REDIS_ADAPTER_ENABLED=true`, `RATE_LIMIT_FALLBACK_INSTANCE_COUNT=1` (approval: production env change).
3. Deploy at **one** instance. Check the three startup lines and `/health` (secret) showing both components `ready`.
4. Check that distributed rate limiting works: a burst of failed logins for a test account returns 429 at the configured limit.
5. Dashboard: sign in, leave idle past the access-token lifetime, confirm live tips still arrive (token refreshed on reconnect). In devtools, Network → WS: one `websocket` connection, no `polling` requests.
6. Guest staff directory: open, keep it open more than 6 minutes, trigger a redeploy, confirm it reconnects (fresh room token).
7. Staging, or a short production window with approval: two instances, a dashboard on each (check `instance` in `/health` through devtools), make a test tip and confirm both dashboards update.
8. Confirm Supabase limits per the table above.
9. **Explicit approval** to scale from 1 to 2.
10. Scale to 2. Leaving `RATE_LIMIT_FALLBACK_INSTANCE_COUNT` at its default (1) is fine while Redis is healthy, but outage-time auth/MFA limits double (see above). Optionally set it to 2 first (approval: production env change).
11. Check both instances logged the startup lines. Check Supabase client connections (about 10 steady).
12. Watch for 24h: Sentry (Redis, P2024, 5xx), Render logs (`DEGRADED`, `drain timeout`), Supabase connections, Key Value connections, and payout/webhook processing (Stripe dashboard compared with CareTip records).

## Rollback triggers

Scale back to 1 instance (and keep Redis on) if any of these happen:
- any `P2024` pool timeouts, or Supabase client connections at 80% of the limit or more
- `socket_adapter DEGRADED` lasting more than 5 minutes, or repeating more than 3 times an hour
- users reporting dashboards that don't update while other users' do
- any duplicate payout, transfer, refund or webhook effect (none expected; investigate before resuming)
- any `drain timeout reached` during a deploy
- 5xx rate above twice the single-instance baseline

## Rollback procedure

1. Render → web service → Scaling → set instances to 1. No code change needed: one instance with the adapter on behaves exactly as before.
2. If `RATE_LIMIT_FALLBACK_INSTANCE_COUNT` was set above 1, set it back to 1 (or remove it; the default is 1).
3. If Redis itself is the problem, also set `SOCKET_REDIS_ADAPTER_ENABLED=false` and redeploy. Rate limits then fall back to process memory, which is correct for one instance.
4. Code rollback (if ever needed) is an ordinary redeploy of the previous commit. There are no schema or data changes in this work.

## Tests (disposable loopback services only)

```
# disposable Postgres + Redis on 127.0.0.1; scripts/safe-test.mjs refuses anything else
export CARETIP_ISOLATED_POSTGRES_URL=postgresql://postgres@127.0.0.1:<pg-port>/<db>
export CARETIP_ISOLATED_REDIS_URL=redis://127.0.0.1:<redis-port>
node scripts/safe-test.mjs db:migrate:isolated-test
node scripts/safe-test.mjs test:multi-instance-redis                 # 2 processes, rooms, outage, recovery
node scripts/safe-test.mjs test:financial-multi-instance-concurrency # 3 processes, money paths
node scripts/safe-test.mjs test:graceful-shutdown
node scripts/safe-test.mjs test:rate-limit-traffic-classes
```
