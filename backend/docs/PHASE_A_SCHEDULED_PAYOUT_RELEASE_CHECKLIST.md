# Phase A — scheduled payout release checklist

## Code scope (Phase A / A.1 / A.2)

- Shared recovery, reconciliation, retries, claims, heartbeat, stable idempotency, ledger-authoritative amounts.

## Migrations (apply in order per environment)

1. `20261010180000_scheduled_payout_recovery_fields`
2. `20261010210000_scheduled_payout_claim_token`

Verify via `_prisma_migrations` and columns `processing_claim_token`, `attempt_count`, `reconciliation_status` on both scheduled ledger tables.

## Pre-deploy gates (operator)

- [ ] Confirm Supabase **project identity** in dashboard (dev/staging/prod) — do not rely on repo `.env` alone.
- [ ] Migrations applied on **target** environment before app deploy.
- [ ] Run runtime tests: `scheduled-bank-payout-recovery-runtime.ts`, `employee-scheduled-bank-payout-runtime.ts`, `business-scheduled-bank-payout-runtime.ts`, `scheduled-bank-payout-phase-a-closure-runtime.ts`.
- [ ] Local/integration DB: set `DATABASE_USE_SESSION_POOLER=true` if transaction pooler (6543) is unreachable.
- [ ] Historical blocked ledgers: follow `SCHEDULED_PAYOUT_HISTORICAL_RECONCILIATION_RUNBOOK.md`.
- [ ] No automatic retry for Charline Test or other named incidents without incident ticket.

## Phase B (operations UI)

- See `PHASE_B_SCHEDULED_PAYOUT_OPERATIONS.md` and `npm run test:platform-scheduled-payout-ops`.
- Manual Stripe payout attachment remains behind `PLATFORM_SCHEDULED_PAYOUT_MANUAL_ATTACHMENT_ENABLED`.

## Not in Phase A

- Email/push notifications, Render cron changes, production payout replay (Phase B adds admin visibility only).

## Production deploy

Phase A closure **does not** authorize production deploy. Requires separate production migration verification and ops sign-off.
