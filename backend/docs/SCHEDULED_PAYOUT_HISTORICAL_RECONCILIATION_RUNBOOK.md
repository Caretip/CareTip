# Scheduled payout — historical reconciliation runbook (Phase A)

Operator-facing procedure for ledgers blocked with `reconciliation_required`, `reconciliation_inconclusive`, or legacy `stripe_create_failed` without correlation metadata. **Do not create a second Stripe payout while investigating.**

## 1. Identify the CareTip ledger

- Table: `employee_stripe_scheduled_payout_requests` or `stripe_connect_scheduled_payout_requests`.
- Keys: `employee_id` / `business_id`, `schedule_window_key`, `idempotency_key`, `correlation_id` (if any).
- Record: `amount_cents`, `currency`, `status`, `failure_classification`, `blocked_reason`, `attempt_count`, `stripe_payout_id`.

## 2. Identify the Stripe Connect account

- Employee: `employee_stripe_accounts.stripe_account_id` for the employee.
- Business: `businesses.stripe_account_id`.
- Confirm **test vs live** mode matches the incident (Dashboard mode toggle).

## 3. Search Stripe (correct connected account)

- Payouts list filtered by amount, currency, and created time around `created_at` / window.
- If `stripe_payout_id` is already on the ledger, **retrieve** that `po_` on the connected account only.

## 4. Evidence required before attaching a payout

All must match the ledger:

| Check | Requirement |
|-------|-------------|
| Account | Same Connect `acct_…` as CareTip |
| Amount | Exact `amount_cents` |
| Currency | Exact ledger currency |
| Identity | Known `po_` **or** payout metadata `caretip_scheduled_payout_correlation_id` + `caretip_schedule_window_key` matching ledger |
| Timing | Consistent with scheduled window (supporting context only — **not** sufficient alone) |

**Never attach using amount + currency + time alone.**

## 5. Accepted vs failed vs inconclusive

- **Accepted:** Retrieve shows payout; metadata or operator-verified `po_` links to ledger → set `stripe_payout_id`, `status = submitted`, `reconciliation_status = resolved` via approved admin path or controlled SQL after dual review.
- **Definitively failed:** Stripe logs show rejection with no payout object → document; leave failed/permanent per classification.
- **Inconclusive:** Timeout/5xx/unknown → remain blocked; reconcile on next tick after evidence; **no** new `payouts.create`.

## 6. Approval and audit

- Second reviewer for production financial changes.
- Log: operator, timestamp, ledger id, window key, `po_` attached, evidence summary (no secrets).
- Do not modify unrelated schedule windows or Charline Test historical rows without explicit incident authorization.

## 7. Prevent duplicate payouts

- While blocked, cron must not pass reconciliation gate with blind create.
- If `po_` is set without `submitted`, next tick should reconcile via retrieve path.
- Do not reset idempotency keys or schedule windows to “unstick” a row.

## Phase B+ (out of scope for Phase A)

- Admin UI for reconciliation, notifications, and alerting consume `blocked_reason`, `failure_classification`, and sanitized diagnostics from these ledgers.
