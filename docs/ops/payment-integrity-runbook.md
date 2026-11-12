# Payment integrity remediation: rollout and operations

This covers the remediation of the 2026-11-11 payment audit (H1–H5, M1–M6, L1–L4) and the follow-up hardening. Nothing here has been deployed or applied to production.

## 1. Database migrations

Two additive migrations:

| Migration | Objects |
|---|---|
| `20261112120000_payment_integrity_remediation` | Tables `payment_operation_leases`, `stripe_refund_operations`, `payment_discrepancies`, `physical_qr_payment_adjustments`; enums `StripeRefundOperationStatus`, `PaymentDiscrepancyStatus`; `PhysicalQrPaymentStatus` gains `IN_REVIEW`, `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED` |
| `20261112150000_payment_hardening` | Tables `physical_qr_hold_resolutions` (append-only hold decisions) and `stripe_customer_creations` (durable customer-creation state); three nullable columns on `physical_qr_orders`: `hold_released_at`, `hold_released_by_user_id`, `hold_release_refunded_cents` |

No existing column type, index or constraint changes. No foreign keys are added, so nothing cascades. Adding nullable columns without defaults and creating empty tables are metadata-only operations, and `ALTER TYPE … ADD VALUE` takes only a brief lock on the enum type. The previous release keeps working after both migrations.

**Important:** `backend` `npm start` runs `node scripts/runMigrateDeploy.mjs` (`npx prisma migrate deploy` over the Supabase session pooler, port 5432) before `node dist/index.js`. **Deploying applies both migrations to production automatically.** If the migration fails, `runMigrateDeploy.mjs` logs the error and **starts the API anyway**. The new code would then run without its tables, and refunds, checkout leases, customer creation and discrepancy writes would fail. Read the deploy log; a running API is not proof that the migration applied.

Deployment order:
1. Back up or snapshot the Supabase database.
2. Deploy. A rolling deploy with old and new instances side by side is safe.
3. Confirm the deploy log shows both migrations applied: `prisma migrate deploy` lists `20261112120000_payment_integrity_remediation` and `20261112150000_payment_hardening`.

`prisma migrate diff` from the migration history to `schema.prisma` also reports older drift: three dropped indexes, some timestamp precision and default changes, and a constraint rename. That drift is deliberately not part of these migrations.

## 2. Stripe Dashboard (owner action, H5)

| Endpoint | Listens to | Signing secret env |
|---|---|---|
| `POST https://<api>/api/webhooks/stripe` | events on **your account** (platform) | `STRIPE_WEBHOOK_SECRET` |
| `POST https://<api>/api/webhooks/stripe-connect` | events on **connected accounts** | `STRIPE_CONNECT_WEBHOOK_SECRET` |

How the endpoints behave:
- Each endpoint tries exactly one secret and verifies the raw request body.
- While `STRIPE_CONNECT_WEBHOOK_SECRET` is unset, the Connect endpoint rejects every request with 400.
- Both endpoints share the event-claim table, so an event delivered to both is processed once.
- The Connect endpoint applies only `account.updated`, `payout.*` and `charge.dispute.*` events that carry a connected `account`. It acknowledges and ignores everything else.

Before changing anything, open Developers → Webhooks and note which destinations point at `/api/webhooks/stripe`, and whether each is "Your account" or "Connected accounts".
- A **Connected accounts** destination on `/api/webhooks/stripe` was never able to deliver platform events (tips, checkout, billing) with that secret. Investigate before changing it.
- The usual target setup is:
  1. **Platform destination** → `/api/webhooks/stripe`, with these events: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.
  2. **Connected-accounts destination** → `/api/webhooks/stripe-connect`, with these events: `account.updated`, `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`, `payout.reconciliation_completed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`.
  3. Put the connected destination's signing secret into the Render **web service** as `STRIPE_CONNECT_WEBHOOK_SECRET`.

## 3. Render Cron Jobs (owner action)

### How it works

A Render Cron Job runs a **command** on a schedule; it is not an HTTP request. Both jobs therefore run the project's existing caller, `backend/scripts/render-category-retention-http.mjs`. It sends `POST <CARE_TIP_API_ORIGIN><CARE_TIP_INTERNAL_JOB_PATH>` with the header `x-cron-secret: <CRON_SECRET>`, prints the JSON response, and exits 0 on HTTP 2xx and 1 otherwise. It refuses to run without `CRON_SECRET`.

It uses only built-in Node modules (global `fetch`, so Node 18 or newer), which is why the build command is `true`: no install step. The repository sets no Node version (`NODE_VERSION`, `.node-version`, `.nvmrc` and `engines` are all absent). Render's default for new services is Node 24, which works.

Both jobs are listed in `backend/src/config/internalJobs.manifest.ts` but intentionally **not** in `render.yaml`. By project rule, a job added there becomes a Render service through the Blueprint and needs owner approval. Create them in the Dashboard (New → Cron Job). Writing this code registered nothing.

Schedules are evaluated in **UTC**. Render runs at most one run of a cron job at a time; if a run is still active at the next scheduled time, the next run waits. A manual **Trigger Run** cancels an active run. Runs stop after 12 hours. Render charges per second of run time, with a minimum of $1 per month per cron job.

Each endpoint is also protected on the server against duplicate work, independently of Render:
- Refund attempts are claimed per operation with a compare-and-set.
- Reconciliation holds a run lease; a concurrent call returns `"skipped": "already_running"`.

### Job 1: refund operations tick (every 5 minutes)

```
Service type        Cron Job
Name                caretip-payment-refund-operations-tick
Repository / branch the same GitHub repository and branch as the CareTip backend web service (Caretip/CareTip, main)
Root Directory      backend
Runtime / Language  Node
Region              the same region as the backend web service
Instance type       Starter (same as the existing CareTip cron jobs)
Build Command       true
Command             node scripts/render-category-retention-http.mjs
Schedule            */5 * * * *        (every 5 minutes, UTC)
Environment         CRON_SECRET                 = (copy the value from the backend web service; see below)
                    CARE_TIP_API_ORIGIN         = (the backend URL your existing CareTip cron jobs use; render.yaml documents https://caretip.onrender.com)
                    CARE_TIP_INTERNAL_JOB_PATH  = /api/internal/jobs/payment-refund-operations-tick
                    CARE_TIP_JOB_TIMEOUT_MS     = 300000   (optional; default 120000)
```

What each run does: it retries due refunds that CareTip initiated itself (bounded attempts, same Stripe idempotency key, a lookup before any new key). It then replays billing webhooks that arrived while `SUBSCRIPTION_BILLING_ENABLED` was off.

Expected log line on success (one JSON line, values vary):
```
{"ok":true,"refunds":{"attempted":0,"succeeded":0,"failedPermanent":0,"stillPending":0},"deferredBilling":{"replayed":0,"failed":0,"expired":0,"skipped":null}}
```
`deferredBilling.skipped` is `"billing_disabled"` while subscription billing is off.

### Job 2: payment reconciliation (hourly)

```
Service type        Cron Job
Name                caretip-payment-reconciliation
Repository / branch the same GitHub repository and branch as the CareTip backend web service (Caretip/CareTip, main)
Root Directory      backend
Runtime / Language  Node
Region              the same region as the backend web service
Instance type       Starter
Build Command       true
Command             node scripts/render-category-retention-http.mjs
Schedule            20 * * * *         (hourly at :20 UTC)
Environment         CRON_SECRET                 = (copy the value from the backend web service)
                    CARE_TIP_API_ORIGIN         = (same value as Job 1)
                    CARE_TIP_INTERNAL_JOB_PATH  = /api/internal/jobs/payment-reconciliation
                    CARE_TIP_JOB_TIMEOUT_MS     = 600000   (recommended: a 72-hour window can take longer than 2 minutes)
```

Configuration on the **web service**, not the cron jobs:
- Leave `PAYMENT_RECONCILIATION_REPAIR` **unset** (detection only).
- `PAYMENT_RECONCILIATION_WINDOW_HOURS` is optional (default 72, range 1–720).

Expected log line on success (values vary):
```
{"ok":true,"windowHours":72,"repair":false,"sessionsScanned":0,"truncated":false,"tipsChecked":0,"qrSessionsChecked":0,"discrepanciesOpen":0,"repaired":0,"errors":0}
```
`"skipped":"already_running"` means another run holds the lease, which is normal if runs overlap. `"truncated": true` means more than 1000 Checkout Sessions fell in the window. The reverse check ("CareTip tips that Stripe doesn't have") is then skipped for that run; shorten the window.

### CRON_SECRET

Use the **same** `CRON_SECRET` that is already set on the backend web service, which the existing CareTip cron jobs also use. Copy it from the web service's Environment tab into each new cron job, or attach a shared environment group that holds it. Never put it in `render.yaml` or in the repository.

If the web service has no `CRON_SECRET`, create a long random value on a trusted machine (for example `openssl rand -hex 32`) and set it on the web service and on every cron job. The web service needs a redeploy to pick it up. Without it, every internal job returns 401.

### Verify after creating each job

1. On the cron job's page, click **Trigger Run**, then open **Runs** and select the run.
2. The log shows one JSON line with `"ok":true` and the run status is succeeded (exit 0).
3. The web service log shows the request. The audit log has an `internal_job.run` row with the path and status 200:
   ```sql
   SELECT created_at, metadata FROM audit_logs WHERE action = 'internal_job.run' ORDER BY created_at DESC LIMIT 5;
   ```
4. After 10 minutes (refund tick) or 1 hour (reconciliation), the Runs page shows scheduled runs on time.
5. Duplicate-work check:
   - Reconciliation: run the endpoint twice at once with `curl -X POST -H "x-cron-secret: …" https://<api>/api/internal/jobs/payment-reconciliation`, from a trusted shell, without echoing the secret. One response has `"skipped":"already_running"`.
   - Refund tick: confirm no operation was attempted twice in the same minute:
     ```sql
     SELECT id, attempts, status, updated_at FROM stripe_refund_operations ORDER BY updated_at DESC LIMIT 20;
     ```

### When a run fails

| Symptom in the run log | Meaning and fix |
|---|---|
| `CRON_SECRET is not set; refusing to call internal jobs` | The cron job has no `CRON_SECRET`. Add it. |
| `HTTP 401 …` | Its `CRON_SECRET` differs from the web service's, or the web service has none. Copy the exact value; redeploy the web service if you changed it there. |
| `HTTP 404 …` | Wrong `CARE_TIP_INTERNAL_JOB_PATH` or origin, or the web service still runs a release without these endpoints. Check the path and that the deploy finished. |
| `HTTP 503 …` | The web service is starting or draining (deploy in progress). The next run retries. |
| `HTTP 500 {"ok":false,"message":"…failed"}` | The job threw an error. See the web service log (`internalJobs.payment-…`) and Sentry. A common cause after deploy is that the migration did not apply (section 1). |
| `Request failed …: This operation was aborted` | The client timeout passed. The API usually finishes the job anyway; look for `[payment.reconciliation] done` in the web service log. Raise `CARE_TIP_JOB_TIMEOUT_MS` (maximum 900000). |
| `Request failed …: fetch failed` / DNS error | Wrong `CARE_TIP_API_ORIGIN` or the web service is down. |
| Run never starts | Check the schedule (UTC) and that the cron job's build succeeded on the Builds page. |

## 4. Environment variables (web service; all optional)

| Variable | Default | Effect |
|---|---|---|
| `STRIPE_CONNECT_WEBHOOK_SECRET` | unset (Connect endpoint closed) | Signing secret of the connected-accounts destination |
| `PAYMENT_RECONCILIATION_REPAIR` | unset = `false` | `true` makes reconciliation correct findings by re-running the verified webhook handlers |
| `PAYMENT_RECONCILIATION_WINDOW_HOURS` | `72` (1–720) | How far back reconciliation lists Checkout Sessions |

### Detection mode vs repair mode

- **Detection (default):** reconciliation compares Stripe with CareTip and writes `payment_discrepancies` rows. It changes no tip, order, refund or ledger record. Repeat runs update the same rows (one per object and kind) and mark them `resolved` when a later run finds the object consistent.
- **Repair:** additionally fixes a finding by re-running the same handler the webhook uses: tip creation, QR payment handling, or refund catch-up. Those handlers re-verify the payment with Stripe and the business/employee attribution, and are idempotent. Repair never creates a tip, fulfils an order or issues a refund just because a mismatch exists, and it never releases a held QR order. Amount mismatches are never auto-corrected.

Procedure before enabling repair:
1. Run detection for at least a week.
2. Review every open row: `SELECT workflow, kind, count(*) FROM payment_discrepancies WHERE status = 'open' GROUP BY 1, 2;`
3. Investigate each kind against the Stripe Dashboard (test mode first).
4. Confirm no unexpected kinds appear.
5. Only then set `PAYMENT_RECONCILIATION_REPAIR=true`, watch the first runs' `repaired` count and Sentry, and be ready to unset it.

## 5. Monitoring and alerts

- Sentry: "Payment discrepancy: <workflow>/<kind>" (first sighting of each finding), "CareTip-initiated refund failed permanently", and "Database session TimeZone is not UTC" (startup).
- Useful queries:
  ```sql
  SELECT workflow, kind, count(*) FROM payment_discrepancies WHERE status = 'open' GROUP BY 1, 2;
  SELECT * FROM stripe_refund_operations WHERE status = 'failed_permanent' OR (status = 'pending' AND attempts > 3);
  SELECT id, payment_status, hold_released_at FROM physical_qr_orders WHERE payment_status IN ('IN_REVIEW', 'PARTIALLY_REFUNDED', 'DISPUTED');
  SELECT * FROM physical_qr_hold_resolutions ORDER BY created_at DESC LIMIT 20;
  SELECT * FROM stripe_customer_creations WHERE status <> 'bound';
  ```

## 6. Behaviour changes worth knowing

- **QR orders:**
  - An order is fulfilled only after Stripe reports the session `paid` **and** the PaymentIntent `succeeded` for exactly the order's amount and currency.
  - A paid older session is accepted, and the newer open session is expired.
  - A mismatch moves the order to `IN_REVIEW`.
  - A second payment for an already paid order is refunded automatically.
  - Refunds and disputes set `PARTIALLY_REFUNDED`, `REFUNDED` or `DISPUTED`.
  - A failed card payment can be retried.
- **Subscriptions:**
  - Every mirror write re-reads the subscription from Stripe under a per-business lease.
  - `invoice.payment_succeeded` no longer forces `active`.
  - Events for a replaced subscription are ignored.
  - Checkout idempotency keys are per business and per request fingerprint, and other open CareTip checkouts are expired.
- **Stripe customer creation (M5):** durable state lives in `stripe_customer_creations`, written before Stripe is called, under a per-business lease.
  - Lost response, or lost database write within 23 h: the identical request is repeated with the same idempotency key, so Stripe returns the same customer.
  - An existing CareTip customer is found through Stripe's metadata search (`metadata['caretipBusinessId']`; email listing as a fallback where search is unavailable) and adopted. This search runs before the very first creation and after any interruption older than the key window.
  - Only customers whose metadata names this business are adopted; deleted customers are skipped; if several exist, the oldest is bound and the others are recorded (`orphan_stripe_customer`), never deleted.
- **Billing disabled:** verified billing events are recorded as deferred and replayed by the refund tick once billing is on. Stripe keeps events for 30 days.
- **Tip refunds:** a refund's status only moves forward (pending → succeeded, failed or canceled; succeeded → failed). The payable's refunded amount is the sum of distinct succeeded refunds, so a refund that later fails lowers it again. A transfer that was already reversed for it is flagged for review.

## 7. QR order policies

The rule lives in `backend/src/lib/physicalQr/fulfillmentEligibility.ts` (`physicalQrOrderFulfillmentBlock`). An order may be printed or moved forward in fulfillment only if:
- `paymentStatus = PAID`, or
- it is `PARTIALLY_REFUNDED` **and** a platform admin released it, and its refunds and disputes have not changed since.

The rule is enforced on the server at every entry point:

| Entry point | Code |
|---|---|
| Customer print file `GET /api/business/physical-qr/orders/:id/print` | `physicalQr.controller.ts` `printMyPhysicalQrOrder` |
| Admin print file `GET /api/platform/physical-qr/orders/:id/print` | `platformPhysicalQr.controller.ts` `adminPrintPhysicalQrOrder` |
| Admin bulk print (ZIP) and PDF builder | `physicalQrAdminPrint.service.ts` `buildPhysicalQrOrderPdfForAdmin` |
| Admin processing / printing / ship | `physicalQrFulfillment.service.ts` `transitionOrder`. It checks the rule, then updates with a compare-and-set that requires the same state, so a refund or dispute landing at the same moment cannot slip through. |
| Customer PATCH of an order | refused (403) |

Held orders return `409 FULFILLMENT_ON_HOLD`; unpaid orders return `409 PAYMENT_REQUIRED`. Recording **delivery** of an order that already shipped stays allowed. The admin page shows the reason for a hold and hides processing, printing and shipping while an order is held; tests check that the frontend and server rules agree.

**A. `IN_REVIEW`** (money received, but it did not match the order): on hold.
- Webhook redelivery and reconciliation repair never release it.
- A later correctly sized payment for the same order is a duplicate charge and is refunded; the hold stays.
- The PaymentIntent and session references are kept, and the `payment_needs_review` finding records the amounts.

**B. `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED`:** on hold.
- `REFUNDED` and `DISPUTED` (open or lost) can never be released.
- A **won** dispute is not an automatic release. The order stays held (`IN_REVIEW` without refunds, `PARTIALLY_REFUNDED` with refunds), with a `dispute_won_needs_review` finding, until a platform admin re-verifies it.

**C. Payment methods:** QR Checkout sends `payment_method_types: ["card"]` (`PHYSICAL_QR_CHECKOUT_PAYMENT_METHOD_TYPES`). Card includes Apple Pay and Google Pay. With an explicit list, Stripe ignores the Dashboard payment-method configuration, so SEPA Direct Debit and other delayed methods cannot appear. The asynchronous webhook handling stays for sessions created before the change and for other workflows.

### Releasing a held order (platform admin)

Where: Platform admin → Branding orders → order → **Release for fulfillment**.
API: `POST /api/platform/physical-qr/orders/:id/release-hold` with body `{ reason, expectedPaymentStatus }`.

Who: only platform admins. The platform router re-reads the user from the database and requires `SUPER_ADMIN`, `isPlatformAdmin`, an active account and a verified email. Business managers and employees have no such route; the business QR routes contain no release action, and a test checks this.

Allowed:
- `IN_REVIEW` → `PAID` / `PROCESSING`: the admin accepts this payment for this order.
- `PARTIALLY_REFUNDED` → still `PARTIALLY_REFUNDED`, but released for fulfillment. The payment record stays truthful.

Refused:
- `REFUNDED`, `DISPUTED`, `PAID` and unpaid orders.
- A reason shorter than 10 or longer than 1000 characters.
- A stale screen: `expectedPaymentStatus` differs from the current status.
- Stripe reports the payment as not succeeded, in the wrong currency, with an open, lost or unrecorded dispute, or with a refunded amount that differs from CareTip's.
- Any other open payment finding for the order.

How it's applied: the Stripe check happens first. Then, under the order row lock, the state is re-checked and the order, the `physical_qr_hold_resolutions` row (admin, time, previous and new status, reason, verified amounts) and the resolution of the answered findings are written in one transaction, with an `audit_logs` entry (`physical_qr.hold_released`). No refund, cancellation or other payment action is ever taken. A later refund or dispute automatically invalidates a release.

To refund instead of fulfilling, use the Stripe Dashboard; the refund webhook then marks the order `REFUNDED`.

## 7a. Other notes

- **Tip fee (unchanged; documented only):** floor(10% of the tip) + €0.49, taken from the tip (`backend/src/config/fees.ts`). €1.00 → €0.59 fee; €5 → €0.99; €10 → €1.49. Minimum tip €1, maximum €500.

## 8. Rollback and recovery

- **Code rollback:** redeploying the previous release is safe for the schema; old code ignores the new tables and columns. Orders keep their new statuses. Old code refuses print files for anything other than `PAID`, **but its admin processing, printing and ship actions do not check payment status**, so operators must not advance held orders by hand after a rollback.
- **Schema rollback** (not needed for a code rollback): export `stripe_refund_operations`, `payment_discrepancies`, `physical_qr_hold_resolutions` and `stripe_customer_creations` first, because they are financial audit records. Then drop the six new tables and the two new enums, drop the three `physical_qr_orders` columns, and delete both `_prisma_migrations` rows. PostgreSQL cannot drop enum values; the four added `PhysicalQrPaymentStatus` values stay, which is harmless.
- **Failed migration:** the API starts anyway (section 1). Resolve it with `prisma migrate resolve` and redeploy before taking payment traffic.

## 9. Time zones (L2)

Prisma `DateTime` columns are `timestamp` without a time zone, holding UTC wall-clock time. A `Date` bound into raw SQL is time-zone aware, so PostgreSQL converts it using the session TimeZone.

All financial and payment raw SQL now binds dates through `sqlUtcTimestamp()` (`backend/src/utils/sqlUtcTimestamp.ts`), so results are identical for every session TimeZone and match today's production (UTC) results. That covers:
- business financial metrics, employee analytics and the tip dashboard;
- tip chart buckets, rankings and summaries, and goals;
- platform and payout analytics;
- the QR monthly free-order quota, including its write.

German business days and months still come from `businessUtcRangeForTimeframe` (Luxon, `Europe/Berlin`), which is correct across daylight-saving changes. Tests cover the 23-hour and 25-hour days and the month edges under a UTC+14 session.

Not changed (not financial; still assume a UTC session): token, OAuth and handoff expiry, retention sweeps, QR scan analytics, and platform business-list sign-up filters. At startup the API logs an error and alerts Sentry if the session TimeZone is not UTC.

## 10. Multi-instance verification

What guarantees correctness across instances (all in Postgres, none in process memory or Redis):
- Webhook event claims: one row per Stripe event id, under a transaction-scoped advisory lock.
- Leases (`payment_operation_leases`): QR checkout, billing checkout, Stripe customer creation, per-business subscription sync, and the reconciliation run.
- Refund operation attempt claims (compare-and-set).
- Payable and QR order row locks.
- The instant-payout guard.

Redis is used only for Socket.IO fan-out and rate limits. The financial suites pass with no Redis at all. The Redis multi-instance suite passes against a local Redis.

Proven so far: separate local processes sharing one database (`test:payment-integrity-multi-instance`, `test:financial-multi-instance-concurrency`, `test:multi-instance-redis`). **Not proven: multiple Render instances.**

Safe production procedure for when you choose to scale (this incurs Render cost; owner decision):
1. Have `REDIS_URL` and `SOCKET_REDIS_ADAPTER_ENABLED=true` in place (multi-instance runbook).
2. Scale the web service to 2 instances during a quiet period.
3. Confirm each instance logs `[redis] … ready instance=…` for the rate limiter and the Socket.IO adapter. Production `/health` deliberately does not expose the Redis state.
4. In Stripe test mode, resend one webhook event twice from the Dashboard; `stripe_webhook_events` has one row and the second delivery is answered as a duplicate.
5. Trigger reconciliation twice at once (section 3); one response says `already_running`.
6. Click QR "Pay" twice quickly in two browser tabs (test mode); the order has one Checkout Session.
7. Watch Sentry and `payment_discrepancies` for an hour.
8. Scale back if anything is unexpected.
