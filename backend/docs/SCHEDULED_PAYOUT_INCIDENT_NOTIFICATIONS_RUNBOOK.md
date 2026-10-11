# Scheduled bank payout incident notifications (Phase C)

Operational alerts for **scheduled Stripe Connect bank payouts** (employee + business `every_3_days` ledgers). This is separate from tip notifications and tip-payable payout emails.

## Incident categories and severity

| Category | Severity | When it opens |
|----------|----------|----------------|
| `retry_exhausted` | high | `blockedReason=retry_exhausted` or `attemptCount >= 5` |
| `reconciliation_required` | high | `reconciliationStatus=required` on a **failed** ledger |
| `reconciliation_inconclusive` | high | `reconciliationStatus=inconclusive` |
| `outcome_uncertain` | high | `failureClassification=outcome_uncertain` |
| `stale_pending_blocked` | high | Stale pending blocked reasons (`stale_pending_*`, pending + inconclusive block) |
| `manual_intervention_required` | high | Phase B manual intervention semantics when no more specific category matched |
| `payout_overdue` | normal | Manual intervention still required **and** `bankPayoutNextScheduledAt` older than threshold (default 24h, env `SCHEDULED_PAYOUT_INCIDENT_OVERDUE_MINUTES`) for `every_3_days` accounts |

Transient `retry_scheduled` / working automatic recovery **does not** open incidents.

## Uniqueness and lifecycle

- Durable row: unique on `(payout_type, ledger_id, category)` in `scheduled_payout_ops_incidents`.
- **Open** → update `last_observed_at` each sync; fingerprint change bumps `notify_generation`.
- **Resolved** when authoritative ledger state no longer matches that category (not when a cron tick runs or a notification sends).
- **Reopen**: same unique key moves from `resolved` → `open`, increments `notify_generation`, preserves `first_detected_at` history on the row.

## Per-recipient delivery (authoritative channel: in-app)

Table: `scheduled_payout_ops_incident_deliveries` (migration `20261011160000_scheduled_payout_ops_incident_deliveries`).

- One row per `(incident_id, notify_generation, user_id, channel)`; Phase C hardening uses **`in_app` only** as the authoritative channel.
- States: `pending` → `claimed` (leased) → `delivered` or `failed`.
- **Claim lease**: `claim_token` + `claim_expires_at` (default **10 minutes**, env `SCHEDULED_PAYOUT_INCIDENT_DELIVERY_CLAIM_LEASE_MINUTES`). Expired claims may be reclaimed; lease expiry is **not** delivery success.
- **Release / mark** require matching `claim_token` and `notify_generation` (stale workers cannot clear newer claims).
- Push is **best-effort** after in-app persist; push failure does not block `delivered` for in-app.
- Email is **not** used for this alert path by default.

### What `last_notified_generation` means

Set only when **every** eligible platform admin has an `in_app` delivery row in status `delivered` for that `notify_generation` (persisted inbox row or recognized existing row with matching incident + generation). It does **not** mean push/email provider delivery or recipient read receipts.

### Inbox dedupe crash recovery

Dedupe key: `sched_payout_inc:{incidentId}:g{generation}:{userId}`.

If inbox create returns skipped/`P2002`, the delivery worker reloads the existing `notifications` row and accepts it **only** when `incidentId` + `notifyGeneration` match (or dedupe key parses to the same triple). Unrelated `P2002` is **not** treated as success.

### Work queue fairness

Delivery work is selected **oldest `created_at` first** (bounded batch per sync). Retry throttle uses `next_attempt_at` on delivery rows (default 30 minutes, env `SCHEDULED_PAYOUT_INCIDENT_NOTIFY_RETRY_MINUTES`).

Failed delivery **does not** change ledger state, resolve incidents, or trigger payout retries.

## Admin actions

- UI: `/platform-admin/revenue/scheduled-payout-operations?detailType=employee|business&detailId={ledgerId}`
- **Inconclusive reconciliation**: use ops **Reconcile** until status is no longer inconclusive; do not assume `submitted` means bank settlement completed.
- Recipients: active `SUPER_ADMIN` platform admins with `emailVerified` (see `platformAdminIncidentRecipientWhere`).

If no eligible admins exist, the sync logs `scheduled_payout_incident_no_admin_recipients` (not silent).

## Incident vs delivery failure

| Signal | Meaning |
|--------|---------|
| Open incident, `last_notified_generation < notify_generation` | Problem still exists; notification may be pending or failed |
| Open incident, generations equal | All admins have `in_app` delivery `delivered` for current generation |
| `scheduled_payout_incident_delivery_failed` log | In-app persist error; delivery row `failed`, incident stays open |
| Inbox row exists, delivery still `pending`/`failed` | Investigate delivery row + claim lease; re-run incident sync or standalone job |
| Resolved incident | Ledger category cleared under resolution rules |

## Metrics and logs

- `scheduled_payout_incident_sync` — includes `delivery.*` counters (`deliveriesClaimed`, `deliveriesDelivered`, `claimsReclaimed`, `claimOwnershipLost`, `retryThrottled`, `generationsCompleted`, `oldestPendingAgeMs`) and `syncTrigger` (`payout_tick_ok` | `payout_tick_failed` | `standalone_job`)
- `scheduled_payout_incident_table_missing` — incident/delivery migrations not applied
- Existing D3: `[scheduled_payout_tick]` unchanged

## Incident sync triggers

1. **After every payout tick attempt** (`finally`) — runs even when business/employee stream throws (`syncTrigger=payout_tick_failed`). Payout HTTP handler still returns **500** on tick failure.
2. **Standalone job** (optional cron): `POST /api/internal/jobs/scheduled-payout-incident-sync` (same `x-cron-secret` as other internal jobs). No Stripe payout side effects.

Fire-and-forget scheduling does not survive process exit; use the standalone job on a schedule for durability across restarts.

## Limitations

- Bounded ledger/delivery/resolve batches per sync.
- No exactly-once email/push; in-app is the durable admin contract.
- PostgreSQL CAS behavior verified in production only after migrations + integration tests.

## Operational recovery

1. Apply migrations `20261011140000_*` and `20261011160000_*` when ready.
2. Fix underlying ledger via Phase B ops.
3. Stuck `claimed` delivery past `claim_expires_at` — reclaimed automatically on next sync.
4. Failed incident sync — check `scheduled_payout_incident_sync_failed` / standalone job 500; payout tick success is independent.
