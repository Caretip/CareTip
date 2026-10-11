# Scheduled payout operations — operator runbook

Applies to the platform admin **Scheduled payout operations** UI and Phase A/A.2 + Phase B backend behavior.

## Status semantics

| Ledger `status` | Meaning |
|-----------------|--------|
| `pending` | In-flight / awaiting processing |
| `submitted` | **Submitted to Stripe** — not bank settlement |
| `failed` | Create or policy failure |
| `skipped_zero_balance` | No payout attempted (zero balance) |

**Never** interpret `submitted` as proof that funds reached a bank account.

## Audit log failures (`audit_log_failed`)

Scheduled-payout admin mutations use `writeAuditLogStrict`. If the audit row cannot be persisted, the API returns:

```json
{
  "status": "failed",
  "message": "audit_log_failed",
  "code": "audit_log_failed",
  "ledgerMutationMayHaveOccurred": true | false,
  "auditRecorded": false
}
```

### What this does **not** mean

- **`audit_log_failed` does not prove the financial operation failed.**
- The system does **not** roll back ledger updates or Stripe payouts when audit fails.
- There is **no** transactional guarantee linking `audit_logs` and ledger tables.

### What `ledgerMutationMayHaveOccurred` means

| Value | Typical situation |
|-------|-------------------|
| `true` | Reconcile may have attached a Stripe payout (`matched` / `already_matched`), manual attach may have persisted, or run-recovery may have **created** a Stripe payout before audit failed. |
| `false` | Reconcile on a ledger that already had `po_` (validation only), or reconcile ended blocked/inconclusive/no_match without a successful `tryPersistReconcileMatch`. |

Always **refresh the ledger detail** in the UI after this response.

### Operator procedure (mandatory)

1. **Do not blindly retry** the same reconcile or run-recovery action.
2. **Refresh** the ledger in Scheduled payout operations (detail view).
3. **Compare** ledger `status`, `stripePayoutId` (masked), `reconciliationStatus`, and `blockedReason` with your expectation.
4. **Stripe (dashboard):** On the correct connected account and mode (test vs live), search payouts for the schedule window, amount, and CareTip correlation metadata when present.
5. **Run-recovery:** If `ledgerMutationMayHaveOccurred` is `true`, assume a payout **may** have been created in Stripe even though the UI showed failure. Confirm whether a `po_` exists before any further recovery.
6. **Reconcile:** If the ledger already shows `submitted` with a payout id, treat as success for ledger purposes; backfill audit via platform process if required.
7. If evidence is **inconclusive**, **stop** and escalate for manual review. Do not attach unrelated payouts.
8. Follow historical reconciliation steps below for legacy rows without correlation metadata.

### API / client behavior

The UI shows dedicated copy when `code === "audit_log_failed"`, using `ledgerMutationMayHaveOccurred` to distinguish uncertain financial outcome vs audit-only failure.

## Reconcile vs run-recovery

- **Reconcile** — Stripe list/retrieve only; **never** calls `payouts.create`.
- **Run-recovery** — Phase A policy-gated runner; may create a payout only when policy allows (current schedule window, claims, reconciliation gates).

## Known `po_` on ledger (historical path)

When the ledger already stores a Stripe payout id, reconcile **retrieves** that payout and validates **amount and currency** against the ledger. It does **not** require correlation/window metadata on the Stripe object (legacy compatibility).

Operators must still confirm in Stripe that the payout belongs to the correct schedule window and recipient. Do not use amount/currency alone as proof of attribution for **new** attaches; use correlation metadata per historical reconciliation policy.

## Historical rows without correlation metadata

For failed legacy ledgers (e.g. `stripe_create_failed`, no `correlationId`):

- Automated reconcile returns **inconclusive** (no metadata search).
- Manual attachment remains behind `PLATFORM_SCHEDULED_PAYOUT_MANUAL_ATTACHMENT_ENABLED` (default off).
- Verify Stripe manually before any manual or recovery action.

## Related documents

- `SCHEDULED_PAYOUT_TRY_PERSIST_INTEGRATION_TEST_PLAN.md` — DB integration test prerequisites (not executed in CI by default).
- `SCHEDULED_PAYOUT_RELEASE_SCOPE.md` — release file grouping (inventory).
