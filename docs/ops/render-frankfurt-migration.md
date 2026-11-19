# Moving the CareTip API to Render Frankfurt

Status: proposed, not started. Owner approval is needed before any step that touches production.

## Why

Guests wait on "Taking you to secure checkout…" because the API and the database are on different continents.

| Component | Where it runs | How we know |
| --- | --- | --- |
| API (`api.caretip.de`) | Render **Oregon** (US West) | DNS: `api.caretip.de` → `caretip.onrender.com` → `gcp-us-west1-1.origin.onrender.com` |
| Database | Supabase **Frankfurt** (`aws-1-eu-central-1.pooler.supabase.com`) | `DATABASE_URL` host |
| Guests | Mostly Germany | Product market |

Measured from outside, 2026-11-20, read-only requests against production:

- `GET /health` (no database): about 0.45 s.
- `GET /api/health` (one `SELECT 1`): 0.65 to 2.2 s. One database round trip therefore costs at least 0.16 to 0.2 s. In the same region it would be about 0.005 s.
- Creating a tip checkout runs about 8 database round trips before it calls Stripe. Since 2026-11-20 the three pre-checks run in parallel (`createTipCheckoutSession` in `backend/src/services/stripe.service.ts`), which shortens the chain. Every remaining trip still crosses the Atlantic.

Expected result after the move: database round trips drop from roughly 160 ms to under 10 ms, and the checkout hand-off should fall well below one second. Guests in Germany also get a shorter network path to the API itself.

## Key fact about Render

**A Render service's region cannot be changed after creation.** The move means creating a new web service in Frankfurt, then moving the custom domain `api.caretip.de` to it. The old Oregon service stays untouched as the rollback until the new one has proven itself.

## What has to move, and what does not

| Item | Action |
| --- | --- |
| Web service (Express API + Socket.IO) | New service in **Frankfurt**, same repo, branch, build and start commands, same plan or larger. **Use a plan that does not spin down when idle.** |
| Environment variables | Copy every variable from the Oregon service. Easiest: move them into a Render **Environment Group** first, then attach the group to both services. |
| Redis / Valkey (`REDIS_URL`) | If it is a Render Key Value instance, its internal URL only works inside its own region. Create a new Key Value instance in Frankfurt and point the new service at it. Login lockout counters and rate-limit windows start fresh; that is acceptable. If `REDIS_URL` points to an external provider, check its region and prefer Frankfurt too. |
| Custom domain `api.caretip.de` | Move from the Oregon service to the Frankfurt service (step 6). |
| Supabase | Nothing changes. The database already lives in Frankfurt. |
| Frontend (Vercel) | Nothing to rebuild if `VITE_API_URL` is `https://api.caretip.de`. Confirm this in the Vercel project settings first. |
| Render cron jobs (`render.yaml`) | They call the API over HTTPS. `scripts/render-category-retention-http.mjs` defaults to `https://caretip.onrender.com` unless `CARE_TIP_API_ORIGIN` is set. Set `CARE_TIP_API_ORIGIN=https://api.caretip.de` on every cron before cut-over so they follow the domain. Moving the crons themselves to Frankfurt is optional; they make one request each. |
| Stripe webhook endpoint | Check its URL in the Stripe Dashboard (Developers → Webhooks). If it uses `caretip.onrender.com`, change it to `https://api.caretip.de/api/webhooks` before cut-over. The signing secret (`STRIPE_WEBHOOK_SECRET`) stays the same when only the URL changes. |
| Google OAuth redirect URIs | In Google Cloud Console, check that the authorised redirect URIs use `api.caretip.de` (or the frontend domain), not `caretip.onrender.com`. |
| CSP `connect-src` (`vercel.json`, `public/_headers`) | Already allows `https://*.caretip.de` and `wss://*.caretip.de`. No change needed while the frontend talks to `api.caretip.de`. |

## Steps

1. **Freeze deploys** to the API for the window. Pick a quiet hour (early morning CET); expect 30 to 60 minutes of work and a few minutes of DNS propagation.
2. **Inventory.** Export the Oregon service's environment variables and record: plan, instance count, health check path, build and start commands, `REDIS_URL` host, the Stripe webhook URL, and the Google redirect URIs.
3. **Make the external URLs domain-based** (safe to do days ahead; they keep working against Oregon because `api.caretip.de` still points there):
   - Stripe webhook URL → `https://api.caretip.de/api/webhooks`.
   - Every cron: `CARE_TIP_API_ORIGIN=https://api.caretip.de`.
   - Google redirect URIs on `api.caretip.de`.
4. **Create the Frankfurt Key Value instance** (if Redis is on Render) and note its internal URL.
5. **Create the Frankfurt web service.** Same repo and branch, region **Frankfurt**, same plan, health check `/api/health`, environment group attached, `REDIS_URL` set to the Frankfurt instance. Leave **auto-deploy off** until cut-over is done.
   - Note: `npm start` applies pending Prisma migrations on boot. Both services share the database, and migrations are idempotent, but deploy the **same commit** that Oregon runs so neither service sees an unexpected schema.
   - Set the new service's workers the same way as the old one. If both services run at once, background jobs run twice. The durable email queue and the scheduled-payout claims use database locks, so that is safe. For a clean picture, keep the overlap short.
6. **Smoke-test the new service on its `*.onrender.com` URL**, read-only only:
   - `GET /api/health` returns `{"status":"ok","database":"connected"}`.
   - Time it: `curl -s -o /dev/null -w "%{time_starttransfer}\n" https://<new>.onrender.com/api/health` should be close to `/health`, not 0.2 s+ slower.
7. **Cut over the domain.** In Render, remove `api.caretip.de` from the Oregon service and add it to the Frankfurt service, then update the DNS record at the domain registrar to the target Render shows. Wait for Render to issue the certificate.
8. **Verify on the real domain:**
   - `nslookup api.caretip.de` no longer resolves to `gcp-us-west1-1.origin.onrender.com`; it should point at the new service's origin.
   - `/api/health` timing has dropped.
   - A real guest test tip of €1 on a test venue reaches Stripe Checkout quickly and lands on the thank-you page, and the webhook arrives (check Stripe → Webhooks → recent deliveries for 2xx).
   - Log in as a manager and an employee; the dashboard and live updates (Socket.IO) work.
   - The next cron run succeeds (Render cron logs).
9. **Watch for a day.** Keep the Oregon service running but without the domain. Suspend it after 24 to 48 hours without issues, then delete it and its Key Value instance.
10. **Re-enable auto-deploy** on the Frankfurt service.

## Rollback

Move `api.caretip.de` back to the Oregon service (step 7 in reverse). Nothing in the database depends on which service is serving, and the external URLs are already domain-based, so rollback is a domain switch only.

## Afterwards

- Update `render.yaml` defaults: `scripts/render-category-retention-http.mjs` falls back to `https://caretip.onrender.com`. Change the default to `https://api.caretip.de` once the old service is gone.
- Several live-check scripts in `backend/scripts/` hard-code `https://caretip.onrender.com`. They only affect manual verification runs; update them when convenient.
