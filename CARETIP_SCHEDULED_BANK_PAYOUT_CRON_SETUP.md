# CareTip — Scheduled bank payout cron (production)

Operational setup for **CareTip-initiated standard payouts** (`every_3_days` preference only).  
This cron does **not** replace Stripe automatic payouts for daily / weekly / monthly businesses.

---

## Where things run

| Component | Platform | Evidence in repo |
|-----------|----------|------------------|
| **API / Express backend** | **Render** (`https://caretip.onrender.com`) | `render.yaml`, `CARE_TIP_API_ORIGIN`, `mobile/constants/config.ts`, `RENDER` in `backend/src/index.ts` |
| **SPA (caretip.de)** | **Vercel** (static) | `vercel.json` — **no** backend cron here |
| **Scheduled jobs** | **Render Cron Jobs** | `render.yaml` + `backend/scripts/render-category-retention-http.mjs` |

If your production API uses a custom origin, set `CARE_TIP_API_ORIGIN` on the cron service to that HTTPS origin (same value family as `PUBLIC_API_BASE_URL` / `RENDER_EXTERNAL_URL` on the web service). The repository default for cron callers is `https://caretip.onrender.com`.

---

## Endpoint

| Field | Value |
|-------|--------|
| **Method** | `POST` |
| **Path** | `/api/internal/jobs/scheduled-bank-payout-tick` |
| **Production URL** | `https://caretip.onrender.com/api/internal/jobs/scheduled-bank-payout-tick` |
| **Body** | Empty (no JSON required) |
| **Success** | `200` with JSON e.g. `{ "ok": true, "scanned": N, "created": …, "zero": …, "blocked": …, "notDue": … }` |

Mounted in `backend/src/index.ts` as `app.use("/api/internal/jobs", internalJobsRoutes)`.

---

## Authentication (fail-closed)

Implementation: `backend/src/routes/internalJobs.routes.ts` → `authorizeCronRequest`.

1. Web service must have **`CRON_SECRET`** set (preferred), **or** **`HEALTH_CHECK_SECRET`** (fallback, same header).
2. Request must send header **`x-cron-secret`** with the **same** value as that env var on the **web** service.
3. If neither secret is set on the web service, **all** cron job requests are rejected (`401 Unauthorized`).
4. **Never** commit the secret. **Never** put `CRON_SECRET` in `render.yaml` (use Dashboard / secret sync).

Cron caller script (`render-category-retention-http.mjs`) also **refuses to run** if `CRON_SECRET` is unset on the **cron** service.

---

## Recommended cron frequency

**Do not** schedule this job every 3 days. The **business** payout cadence is every 3 calendar days at **09:00** in `Business.timezone`; the **cron** only polls for rows where `bankPayoutNextScheduledAt <= now`.

| Cron interval | Max delay after 09:00 local due time | Recommendation |
|---------------|----------------------------------------|----------------|
| Every minute | ~1 min | Unnecessary cost for this workload |
| **Every 5 minutes** | ~4 min | **Recommended (production)** |
| Every 15 minutes | ~14 min | Acceptable; matches retention-tick granularity |
| Hourly | up to ~59 min | Too coarse for a 09:00 local target |

**Production schedule expression (Render):** `*/5 * * * *` (every 5 minutes, UTC).

The scheduler processes up to **50** due businesses per tick (`take: 50` in `tickScheduledBankPayouts`). If more than 50 are due, the remainder are picked up on the next ticks (same idempotency window).

---

## Render Cron Job — exact configuration

Create a **new** Render Cron Job (Dashboard → New → Cron Job), or add the blueprint block from `render.yaml` and sync the blueprint.

| Setting | Value |
|---------|--------|
| **Name** | `caretip-scheduled-bank-payout-tick` |
| **Runtime** | Node |
| **Root directory** | `backend` |
| **Build command** | `true` |
| **Start command** | `node scripts/render-category-retention-http.mjs` |
| **Schedule** | `*/5 * * * *` |
| **Plan** | `starter` (same as other CareTip crons) |

### Environment variables (cron service)

| Variable | Required | Value |
|----------|----------|--------|
| `CRON_SECRET` | **Yes** | Same secret as the **CareTip web service** `CRON_SECRET` (paste in Dashboard; do not commit) |
| `CARE_TIP_API_ORIGIN` | Yes | `https://caretip.onrender.com` (or your production API origin) |
| `CARE_TIP_INTERNAL_JOB_PATH` | Yes | `/api/internal/jobs/scheduled-bank-payout-tick` |

The script issues:

```http
POST {CARE_TIP_API_ORIGIN}{CARE_TIP_INTERNAL_JOB_PATH}
x-cron-secret: {CRON_SECRET}
```

with a **120 second** client timeout.

### Web service (API) — required env

| Variable | Required |
|----------|----------|
| `CRON_SECRET` | **Yes** (must match cron job) |

Optional fallback only if you intentionally use one secret everywhere: `HEALTH_CHECK_SECRET` (same value sent as `x-cron-secret`).

### Timeout / retry

- **HTTP client timeout:** 120s (`render-category-retention-http.mjs`).
- **Render cron:** If the job exits non-zero, Render marks the run failed; the next schedule fire retries. Safe for idempotent ticks.
- A single tick may call Stripe per due business (balance + optional `payouts.create`). With many `every_3_days` businesses, watch duration; increase frequency does not help beyond batch `take: 50` — add monitoring if `scanned` is often 50.

---

## Safety properties (verified in code)

### Unauthenticated access

`POST` without valid `x-cron-secret` → **`401`** `{ "message": "Unauthorized" }`.

### Repeated / concurrent cron runs

- Due businesses: `bankPayoutSchedule = every_3_days` and `bankPayoutNextScheduledAt <= now`.
- Per window: unique `(business_id, schedule_window_key)` and Stripe idempotency key `caretip_scheduled_payout:{businessId}:{windowIso}`.
- Re-run after success or zero-balance skip: advances schedule; no duplicate payout for the same window.
- Failed Stripe create: ledger `failed`, **window not advanced** → retried on later ticks.
- In-process serialization per business via `runSerializedByKey`.

**Note:** Multiple API instances can still race on ledger `create`; unique constraints + Stripe idempotency limit duplicate payouts. Uncaught DB unique violations could abort one tick early — monitor logs if running many replicas.

---

## Deploy backend before enabling cron

Production `https://caretip.onrender.com` must expose `POST /api/internal/jobs/scheduled-bank-payout-tick`. Until that build is deployed you may see **`404`**; after deploy, unauthenticated calls must return **`401`** (not `404`). Then create the Render cron.

Backend TypeScript build and scheduler P2002 hardening are documented in `CARETIP_INDIVIDUAL_PAYOUT_SCHEDULING_BUILD_FIX_REPORT.md` (**READY FOR CRON SETUP**).

---

## Deployment checklist

- [ ] DB migration `20260928180000_business_bank_payout_schedule` applied (**done** per operator)
- [ ] Backend **deployed** to Render with `scheduled-bank-payout-tick` route (unauthenticated POST returns **401**, not **404**)
- [ ] `CRON_SECRET` set on **production web service** (strong random value; not in git)
- [ ] Render Cron Job `caretip-scheduled-bank-payout-tick` created with schedule `*/5 * * * *`
- [ ] Cron service `CRON_SECRET` matches web service
- [ ] `CARE_TIP_API_ORIGIN` points at live API
- [ ] `CARE_TIP_INTERNAL_JOB_PATH=/api/internal/jobs/scheduled-bank-payout-tick`
- [ ] **Reachability:** from cron logs, `200` and `ok: true`
- [ ] **Auth:** manual `POST` without header → `401`; with wrong secret → `401`
- [ ] **Safe dry run:** tick with no due `every_3_days` businesses → `scanned: 0` (no Stripe payouts)
- [ ] **Logs:** Render cron log shows JSON body; API logs `businessScheduledBankPayout` on errors
- [ ] **Stripe mode:** web service `STRIPE_SECRET_KEY` is **live** in production (test key only in staging)
- [ ] **First real payout:** one test business on `every_3_days`, confirm `bankPayoutNextScheduledAt`, after due time confirm one standard payout + ledger row + payout history UI

---

## Manual verification commands

Replace placeholders locally; **do not** paste real secrets into tickets or docs.

**Unauthenticated (expect 401):**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST \
  "https://caretip.onrender.com/api/internal/jobs/scheduled-bank-payout-tick"
```

**Authenticated (expect 200):**

```bash
curl -sS -X POST \
  "https://caretip.onrender.com/api/internal/jobs/scheduled-bank-payout-tick" \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

**Monitor Render:** Cron Job → Logs → successful runs every ~5 minutes with HTTP 200 body.

---

## Related jobs (already in `render.yaml`)

These use the same HTTP caller pattern but **different paths**:

- `caretip-trial-reminders` — daily
- `caretip-category-retention-sweep` — hourly
- `caretip-category-retention-tick` — every 15 minutes
- `caretip-employee-stripe-inactivity-tick` — daily

`connect-payout-reconciliation-tick` exists on the API but is **not** defined in `render.yaml` at time of writing; only add if you operate that reconciliation cron separately.

---

## Blueprint reference

See `render.yaml` service `caretip-scheduled-bank-payout-tick`. Applying the blueprint in Render does **not** happen automatically from Cursor; create or sync in the Render Dashboard.
