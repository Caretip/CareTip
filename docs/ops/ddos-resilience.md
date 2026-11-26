# DDoS resilience and traffic abuse

Last reviewed 2026-11-26. CareTip is **not DDoS-proof**. Two separate layers matter:

- **Infrastructure:** volumetric floods (L3/L4, large L7 floods) are absorbed in front of CareTip by
  Render (Cloudflare-based DDoS protection, automatic) and Netlify (automatic, all plans). CareTip's
  code cannot stop a flood large enough to saturate its instance.
- **Application:** this repository limits what each request can cost: rate limits, body and time
  bounds, and no expensive work before authentication. That keeps a moderate attack, or one abusive
  client, from exhausting the database, Stripe, OpenAI, Resend or the Sentry quota.

## Endpoint limits added in this review, and why

| Endpoint | Limit | Rationale |
|---|---|---|
| `GET /api/payments/tip-session/:id` | id must look like `cs_test_…`/`cs_live_…`; 150 per session per 15 min | Each call is a live Stripe API request, and CareTip's Stripe rate limit is shared with real payments. The rating page polls once a second for up to 60 s, so the cap is per session (polling plus reloads); a per-IP cap would break guests on shared venue Wi-Fi. The global public limit (300/15 min per IP) still applies. |
| `POST /api/feedback/tip` | same id shape check | Avoids a Stripe call for a made-up id. |
| `POST /api/legal/webhook` | 30 per 15 min per address, before the body is read; no XML parse when no provider is configured | The 15 MB body is needed (IT-Recht can push PDFs) and authentication is inside the XML, so reading must happen first; IT-Recht pushes a handful of documents when texts change. |
| Socket.IO handshake | 120 per address per 5 min; 16 KB max message | An authenticated handshake costs 4–5 database reads. A tab opens one connection and reconnects after network changes; a venue's Wi-Fi can carry many guest pages. Clients send no application messages, so 16 KB is ample. |
| `POST /api/me/export` | 5 per user per hour | Each call creates and starts building a data export. |
| `POST /api/landing-ai/chat` | global daily cap, `LANDING_AI_DAILY_MAX_CALLS` (default 2000) | Per-IP limits stop one visitor, not many; every call is a paid OpenAI request. Over the cap visitors get the built-in answers. |
| `GET /api/health` | one database probe shared per 5 s | Must stay public and unthrottled for Render; this stops it from costing one DB connection per call. |
| `/api/internal/jobs/*` | audit row only for authorised runs | Unauthenticated calls each wrote an audit row. |

Other changes: rate-limit keys group IPv6 addresses by /64 (one subscriber usually owns a /64);
Valkey commands time out after 500 ms (connect 3 s) and fall back instead of hanging requests;
HTTP header timeout 20 s and request (upload) timeout 120 s, down from Node's 60 s and 300 s;
at most 10 Sentry events per error context per minute (all are still logged); an unhandled promise
rejection is logged instead of ending the process.

Existing limits (auth, checkout, QR scan, uploads, traffic classes) are listed in
`backend/src/config/authRateLimit.config.ts` and `backend/src/config/securityRateLimit.config.ts`.

## Deployment and activation

1. Deploy as usual. No migration, no new required setting.
2. Optional settings (defaults are safe): `RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS` (500),
   `RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS` (3000), `LANDING_AI_DAILY_MAX_CALLS` (2000).
3. Make sure `REDIS_URL` (Valkey) is set on the web service. Without it every limit is per instance.
   With more than one instance, also set `RATE_LIMIT_FALLBACK_INSTANCE_COUNT` to the instance count.
4. After deploy, check: `/api/health` returns ok; the dashboard's live updates still connect;
   a guest tip reaches the rating page.

## Infrastructure recommendations (not done; owner decisions)

1. **Disable the `onrender.com` subdomain** once nothing uses it (Render: service settings, or
   `renderSubdomainPolicy: disabled`). Blockers today: the mobile app's production URL
   (`mobile/constants/config.ts`, `mobile/eas.json`) and the CSP `connect-src` entries still use
   `caretip.onrender.com`. Ship an app update to `api.caretip.de` first. Until then, any protection
   placed in front of `api.caretip.de` can be bypassed via the Render hostname.
2. **Cloudflare in front of `api.caretip.de`** (proxied, SSL mode Full) would add a WAF, bot and rate
   rules at the edge and absorb L7 floods before they reach Render. It only helps once the
   `onrender.com` hostname is disabled (1). Then set `TRUST_PROXY_CIDRS` to Cloudflare's ranges (or
   raise `TRUST_PROXY_HOPS` to 2), or every client shares one rate-limit bucket. WebSockets work on
   all Cloudflare plans; keep the existing ping interval.
3. **Netlify `/api/*` proxy** (`public/_redirects`) is unsigned: requests through it reach the API
   from Netlify's edge address, so they share one bucket. Either keep the browser calling
   `api.caretip.de` directly (current default) or add a signed proxy in `netlify.toml` and set
   `NETLIFY_PROXY_SIGNATURE_SECRET` on Render.
4. **Database statement timeout** at role level (Supabase SQL editor), for example
   `ALTER ROLE <app role> SET statement_timeout = '15s'`, so a slow query cannot hold a pool
   connection for long. Test long admin exports first. Supabase network restrictions do not cover
   the HTTPS Data API; the app does not use it from browsers, so consider disabling it.
5. **Alerts** (Sentry): Redis degraded/unavailable (already emitted), Prisma `P2024` (pool timeout),
   5xx rate above 2 % for 5 minutes, and the Render CPU/memory alerts at 80 % for 10 minutes.
   Rate-limit blocks are logged (`[security.rateLimit] blocked`), not alerted.
