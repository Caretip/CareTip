# Notification delivery runbook

Status (2026-11-19): implemented in the working tree, **not committed, not deployed**. Nothing below
has been applied to production.

## What exists

| Piece | Where |
|---|---|
| Email outbox table `notification_email_deliveries` | migration `backend/prisma/migrations/20261119120000_notification_email_deliveries` |
| Queue (enqueue, SKIP LOCKED claim, retry, health) | `backend/src/services/notifications/notificationEmailQueue.service.ts` |
| In-process worker (60 s) | `backend/src/services/notifications/notificationWorker.ts`, started in `src/index.ts` |
| Backup cron route | `POST /api/internal/jobs/notification-delivery-tick` (`x-cron-secret`) |
| Payout notifications + repair sweep | `backend/src/services/notifications/payoutNotifications.service.ts` |

## Deployment steps (need owner approval)

1. **Migration.** `npm start` runs `prisma migrate deploy`, so the first deploy creates the table
   automatically. It is additive (one enum, one table, five indexes, RLS on). Rollback:
   `DROP TABLE "notification_email_deliveries"; DROP TYPE "NotificationEmailDeliveryStatus";`
   and delete the row from `_prisma_migrations`. Until the table exists, emails fall back to the
   previous direct send, so ordering does not matter.
2. **Worker.** On by default when `NODE_ENV=production`. No new service is needed; it runs inside
   the API process and is safe with any number of instances.
3. **Optional backup cron** (recommended once approved): Render cron every 5 minutes calling
   `notification-delivery-tick`, same pattern as `subscription-billing-notification-retry`.
   `render.yaml` was deliberately not edited.

## Environment variables (all optional)

| Name | Default | Purpose |
|---|---|---|
| `NOTIFICATION_WORKER_ENABLED` | on in production, off elsewhere | `true`/`false` to force |
| `NOTIFICATION_WORKER_INTERVAL_MS` | `60000` | worker interval (min 5000) |
| `CARETIP_ALLOW_REMOTE_TEST_DATABASE` | unset | lets a test run use a non-loopback database (dedicated test DB only) |
| `CARETIP_ALLOW_LIVE_EMAIL_TEST` | unset | lets a test run send real email |

## Delivery guarantee

At least once per logical email. Each row stores the rendered message and a stable idempotency key
(`notification-email:<notificationId>`, `trial-reminder:<subscriptionId>:<day>`), so retries are
byte-identical and Resend returns the original result for a repeat within its 24-hour key window.
Rows stop retrying after 23 hours (`expired_window`) to stay inside that window. Retry: up to 8
attempts, exponential backoff from 1 minute to 1 hour with jitter, Retry-After honoured. Permanent
rejections (422, other 4xx) stop at once; 401/403 and 409 "concurrent request" are retried.

## Watching it

`POST /api/internal/jobs/notification-delivery-tick` returns counts only:
`pending, retryScheduled, processing, expiredLeases, failedLast24h, deliveredLast24h, oldestDueAgeSeconds`.
Log lines: `[notificationQueue] delivery will be retried`, `delivery failed permanently`,
`delivery expired`, `result not written: lease was taken over`, `[notificationWorker] outbox table missing`.

Alert suggestions: `oldestDueAgeSeconds > 900`, `failedLast24h > 0`, `expiredLeases > 0` for 2 ticks.

## Scope

Queued: every email sent through the notification orchestrator (support, QR orders, inactivity,
announcements, tip emails, payout failures) and trial reminders. Not queued (unchanged): billing
failure emails (own queue, now with an idempotency key) and request-time account emails (verify,
reset, activation, login alert, security), which the user can request again.

---

## Update 2026-11-19 (final hardening): returned payouts, queue modes, test overrides

### Returned payouts

- Migration `backend/prisma/migrations/20261119140000_stripe_payout_returns` adds the append-only
  table `stripe_payout_returns` (one row per Stripe payout, unique `stripe_payout_id`, RLS on, no
  foreign keys so the record outlives deleted people). Rollback: `DROP TABLE "stripe_payout_returns";`
- A return is Stripe reporting a payout as `paid` and later `failed` (either delivery order). The
  payout row keeps `status = paid` and its `paid_at`; the return is recorded separately with the
  amount, original paid time, return time, failure code, Stripe event id and failure balance
  transaction. Detected from webhooks and from API syncs, so a missed webhook is recovered.
- Money: Stripe moves the funds back to the connected account's Stripe balance. CareTip books
  nothing for it (it keeps no ledger for bank payouts; employee balances and history come from
  Stripe). Business payout lists expose `returnedAt`, the badge shows "Returned by bank", and
  platform analytics count it in `returnedCount` instead of `paidCount`.
- Notifications: employee (in-app, push, email) and business owner, deduplicated per payout, never
  sent when the person was already told the payout failed. Copy never says the money is available.

### Queue operating modes (no new environment variable)

| Mode | When | Email on outbox write failure |
|---|---|---|
| pre_migration | table missing AND migration not in `_prisma_migrations` | sent directly (old behaviour) |
| durable | the outbox has worked once in this process | not sent; logged; repaired later |
| unknown | anything else (database down, migration recorded but table missing) | not sent; logged; repaired later |

Activation is automatic: applying `20261119120000_notification_email_deliveries` (done by
`npm start`) switches every instance to durable on its first successful write. The repair pass
(worker and cron) enqueues email-channel notifications that have no delivery row, using the same
idempotency key, for rows created at least 10 minutes after the migration finished, 2 minutes to
23 hours old. Rollback of the queue migration: drop the table, delete its `_prisma_migrations`
row, then restart the API (the durable latch is per process).

### Deployment sequence (when approved)

1. Deploy the backend. `npm start` applies both migrations (additive) before serving.
2. Watch logs for `[rateLimit] shared store engine` (expect `engine: valkey, version: 8.1.4`) and
   `[notificationWorker] started`.
3. Optional: Render cron every 5 minutes for `notification-delivery-tick` (not added to render.yaml).
4. Check `POST /api/internal/jobs/notification-delivery-tick` health counts after the first hour.

### Verifying Valkey 8.1.4 (staging, never production keys)

```
CARETIP_TEST_REDIS_URL=redis://<staging host>:<port> \
CARETIP_EXPECT_ENGINE=valkey CARETIP_EXPECT_ENGINE_VERSION=8.1.4 \
npm --prefix backend run test:login-lockout-redis
```
The test uses only `auth:lockout:v1:*` keys it creates and deletes. `CARETIP_TEST_REDIS_URL` must be
a loopback URL by design; for a remote staging instance tunnel it to 127.0.0.1 first.

### Intentional overrides (operators only)

- Remote test database: `CARETIP_ALLOW_REMOTE_TEST_DATABASE=<exact hostname of DATABASE_URL>`.
  `1`/`true` is refused; ignored in CI.
- Live test email: `CARETIP_ALLOW_LIVE_EMAIL_TEST=1` plus
  `CARETIP_LIVE_EMAIL_TEST_RECIPIENTS=<a@x,b@y>`; every recipient must be listed. `LEAD_EMAIL_E2E=1`
  may only reach the configured leads/support inboxes. Ignored in CI.
- Live Supabase audit: `CARETIP_SECURITY_AUDIT_TARGET=<project ref>` (must match every configured
  project). Catalog queries run in READ ONLY transactions. Write probes (anon POST, anon upload) need
  `CARETIP_SECURITY_AUDIT_WRITE_PROBES=attempt-blocked-writes:<project ref>` and should only target
  a non-production project.
