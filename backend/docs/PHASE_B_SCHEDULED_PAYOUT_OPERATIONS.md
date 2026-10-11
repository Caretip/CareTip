# Phase B — Scheduled Payout Operations Center

## Purpose

Platform administrators inspect **employee and business scheduled payout ledgers** (`employee_stripe_scheduled_payout_requests`, `stripe_connect_scheduled_payout_requests`), view recovery diagnostics, run **reconcile-only** Stripe matching, and trigger **policy-gated** recovery — without bypassing Phase A gates.

UI route: `/platform-admin/revenue/scheduled-payout-operations`

## Status semantics

| Ledger `status` | Meaning in UI |
|-----------------|---------------|
| `pending` | In-flight / awaiting processing |
| `submitted` | **Submitted to Stripe** — not bank settlement |
| `failed` | Create or policy failure |
| `skipped_zero_balance` | No payout attempted (zero balance) |

## API (platform admin only)

- `GET /api/platform/scheduled-payout-operations/summary`
- `GET /api/platform/scheduled-payout-operations`
- `GET /api/platform/scheduled-payout-operations/:payoutType/:ledgerId`
- `POST .../reconcile` — no `payouts.create`
- `POST .../run-recovery` — uses Phase A employee/business runners (current due window only)
- `POST .../manual-attachment` — **disabled** unless `PLATFORM_SCHEDULED_PAYOUT_MANUAL_ATTACHMENT_ENABLED=true`

## Audit actions

- `platform.scheduled_payout.reconcile`
- `platform.scheduled_payout.run_recovery`
- `platform.scheduled_payout.manual_attachment` / `manual_attachment_rejected`

## Authorization

Backend: `requirePlatformAdmin` (SUPER_ADMIN + `isPlatformAdmin` + verified email).

Frontend: `canAccessPlatformAdminWorkspace` (requires `user.isPlatformAdmin` from auth DTO).

## Manual attachment release gate

Enable only after ops process and Stripe validation workflow are approved. Requires correlation metadata on the Stripe payout object (no amount-only attach).

## Historical reconciliation

See `SCHEDULED_PAYOUT_HISTORICAL_RECONCILIATION_RUNBOOK.md`.

## Tests

`npm run test:platform-scheduled-payout-ops`
