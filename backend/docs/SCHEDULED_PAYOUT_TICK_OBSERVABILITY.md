# Scheduled bank payout tick observability (Phase D3)

## What is instrumented

Each invocation of `POST /api/internal/jobs/scheduled-bank-payout-tick` (Render cron every 5 minutes UTC) runs `tickScheduledBankPayouts`, which:

1. Processes **business** then **employee** `every_3_days` due accounts.
2. Emits one structured JSON log line: `[scheduled_payout_tick]` with schema `caretip.scheduled_payout_tick.v1`.
3. Updates an **in-process heartbeat** exposed on detailed `/health` as `observability.scheduledPayoutTick`.

There is **no** Prometheus/Datadog client in-repo. Metric names in the log payload are **conventions for log aggregation**, not proof of a deployed dashboard.

## Structured fields (per tick)

- `durationMs` — wall time for the full tick (both streams).
- `streams[]` — `business` | `employee`: `accountsScanned`, `accountsProcessed`, outcomes (`created`, `zero`, `blocked`, `notDue`, `skipped`), sanitized `blockedReasons`, `claimConflictTotal`, `reconciliationBlockedTotal`, `capReached`, `dueBacklogBefore` / `dueBacklogAfter` (exact counts).
- `metrics[]` — low-cardinality lines, e.g. `scheduled_payout_tick_duration_ms`, `scheduled_payout_outcome_total`, `scheduled_payout_blocked_reason_total`, `scheduled_payout_due_backlog_estimate`, `scheduled_payout_tick_cap_saturated`, `scheduled_payout_claim_conflict_total`.

Labels are limited to `stream`, `outcome`, `reason`, `phase`, `result`, `cap`. No account, ledger, or Stripe IDs.

## Healthy tick

- HTTP **200** with `ok: true` and `observability.success: true`.
- **Zero due accounts** (`dueBacklogBefore === 0` for both streams) is normal — not an outage.
- Some `blocked` outcomes may be expected (`retry_not_due`, `pending_stripe_payout`).

## HTTP 200 ≠ all payouts succeeded

The response aggregates account-level outcomes. A tick can return `ok: true` while `blocked > 0` or while `dueBacklogAfter > 0`. `created` means a Stripe payout create path completed for that window, not bank settlement.

## Backlog and cap saturation

- **Backlog** = `COUNT(*)` with the same predicates as the tick `findMany` (exact, not estimated).
- **Employee** stream uses index `(bank_payout_schedule, bank_payout_next_scheduled_at)`.
- **Business** stream: composite index `businesses_bank_payout_due_idx` is defined in migration `20261011120000_scheduled_payout_fairness_cursor_business_due_idx` (not applied until authorized).
- **`capReached`** when `processed >= 200` per stream (`SCHEDULED_PAYOUT_TICK_MAX_ACCOUNTS_PER_RUN`). With backlog remaining, expect multi-tick drain — not a single-tick failure.
- `accountsScanned` is the number of due rows **fetched** for processing this tick (may include the same logical account only once per tick under Phase D2 keyset rotation).
- `accountsProcessed` is the number of processing attempts (≤ cap 200 per stream).
- `fairnessWraps` / `scheduled_payout_fairness_wrap_total` — ring wrap to head after reaching tail (D2).

## Fair selection (Phase D2)

Due accounts are ordered by `(bankPayoutNextScheduledAt, accountId)` with a **durable per-stream cursor** (`scheduled_payout_tick_fairness_cursors`). Blocked accounts that remain due are not permanently pinned to the front of every tick; the cursor advances past attempted accounts and wraps to the ring start when needed. Backlog counts still include all due accounts (including blocked).

### Cursor CAS (D2 hardening)

- Each tick saves with **compare-and-swap** against the cursor snapshot loaded at tick start.
- `stale_rejected` means a concurrent tick advanced the cursor first; the stale save is dropped. The next tick loads the newer cursor and continues (log: `scheduled_payout_fairness_cursor_cas_stale`).
- CAS prevents **backward** cursor regression; it does not elect the “most advanced” worker when two ticks finish concurrently.
- `legacy_unavailable` / `scheduled_payout_fairness_cursor_legacy` (once per process): cursor table missing — head ordering per tick until migration is applied. Repeats after process restart; not a centralized alert.

### Finite due-set fairness (H2)

With a **stable finite** due set, tail exhaustion triggers wrap and earlier `(dueAt, id)` keys get another attempt. Continuously arriving new due accounts can extend the tail and delay wrap; there is no strict round-robin SLA guarantee.

## Cron failure vs cron absence

| Detection | In-app (this change) | External (required for production) |
|-----------|----------------------|-------------------------------------|
| Tick throws / HTTP 500 | `logServerError`, heartbeat `lastFailureAt`, `consecutiveFailures` | Render cron job failure alert on non-zero exit / HTTP 5xx |
| Tick succeeds | `[scheduled_payout_tick]` log + heartbeat `lastSuccessAt` | Log drain + metric alerts |
| Cron stops entirely | Heartbeat `stale: true` on **each API instance** after ~12.5 min without success on that instance | Render “job not run” alert; watchdog on `lastSuccessAt` from logs or health |

Heartbeat is **not durable** across deploys or multi-instance — treat `/health` `scheduledPayoutTick.stale` as a hint, not sole paging.

## Proposed alert conditions (not active until configured)

Defaults assume 5-minute schedule; tune for your volume.

1. **Tick failure** — HTTP 5xx from cron caller OR `consecutiveFailures >= 2`.
2. **Missing tick** — no `[scheduled_payout_tick]` with `success: true` for **> 15 minutes** (3× interval).
3. **Backlog growth** — `dueBacklogAfter` > 0 for **> 30 minutes** for either stream while `capReached` is often true.
4. **Cap saturation** — `scheduled_payout_tick_cap_saturated` in **≥ 3 consecutive** ticks per stream.
5. **Claim conflicts** — `claimConflictTotal` sum **≥ 5** per tick (investigate duplicate workers).
6. **Reconciliation pressure** — `reconciliationBlockedTotal` **≥ 10** per tick or rising over 1 hour.

Do **not** page on `accountsScanned === 0` alone.

## Investigating without blind retry

1. Open **Platform → Scheduled payout operations** (Phase B) for ledger state.
2. Read sanitized `blockedReason` / `failureMessage` — not raw Stripe errors in logs.
3. Follow historical reconciliation runbook for legacy rows (do not attach Stripe IDs unless approved).
4. `audit_log_failed` means ledger may have changed — refresh and verify Stripe before retry.
5. Inconclusive reconciliation is not proof that no payout exists.

## Production unverified

Render alert rules, log sinks, Sentry dashboards, and migration state on production are **not** verified by this document.
