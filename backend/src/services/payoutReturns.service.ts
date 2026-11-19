/**
 * Returned payouts: Stripe reported a payout as paid and the bank later sent it back
 * (payout.failed after payout.paid). Recorded as a separate, append-only audit row in
 * `stripe_payout_returns`; the payout row itself keeps its paid status and paid timestamp.
 *
 * Money: Stripe moves a failed payout's funds back to the connected account's Stripe balance
 * (the failure balance transaction). CareTip keeps no ledger of its own for bank payouts, so it
 * books nothing here: crediting anything in CareTip would double count what Stripe restores.
 * Employee balances and payout history already come from Stripe directly.
 *
 * Idempotency: one row per Stripe payout (unique stripe_payout_id, INSERT ... ON CONFLICT DO
 * NOTHING), so duplicate webhooks, sync reruns and concurrent processing record it once.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { sqlUtcTimestamp } from "../utils/sqlUtcTimestamp.js";

export type PayoutReturnInput = {
  payoutKind: "employee" | "business";
  payoutRowId: string;
  stripePayoutId: string;
  stripeAccountId: string;
  businessId: string;
  employeeId?: string | null;
  amountCents: number;
  currency: string;
  originalPaidAt: Date | null;
  returnedAt: Date;
  failureCode?: string | null;
  failureMessage?: string | null;
  failureBalanceTransactionId?: string | null;
  stripeEventId?: string | null;
  detectedVia: "webhook" | "api_sync";
};

/** Record a return once. `created` is false when it was already recorded. */
export async function recordPayoutReturn(input: PayoutReturnInput): Promise<{ id: string; created: boolean }> {
  const id = `spr_${input.stripePayoutId.slice(-20)}_${Date.now().toString(36)}`;
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO "stripe_payout_returns"
      ("id", "payout_kind", "payout_row_id", "stripe_payout_id", "stripe_account_id", "business_id",
       "employee_id", "amount_cents", "currency", "original_paid_at", "returned_at", "failure_code",
       "failure_message", "failure_balance_transaction_id", "stripe_event_id", "detected_via", "created_at")
    VALUES
      (${id}, ${input.payoutKind}, ${input.payoutRowId}, ${input.stripePayoutId.slice(0, 128)},
       ${input.stripeAccountId.slice(0, 128)}, ${input.businessId}, ${input.employeeId ?? null},
       ${input.amountCents}, ${input.currency.slice(0, 8)},
       ${input.originalPaidAt ? sqlUtcTimestamp(input.originalPaidAt) : null},
       ${sqlUtcTimestamp(input.returnedAt)}, ${input.failureCode?.slice(0, 64) ?? null},
       ${input.failureMessage?.slice(0, 255) ?? null}, ${input.failureBalanceTransactionId ?? null},
       ${input.stripeEventId?.slice(0, 128) ?? null}, ${input.detectedVia}, ${sqlUtcTimestamp(new Date())})
    ON CONFLICT ("stripe_payout_id") DO NOTHING
    RETURNING "id"
  `);
  if (rows[0]) {
    console.warn("[stripe.payoutReturn] payout returned by the bank", {
      kind: input.payoutKind,
      payoutSuffix: input.stripePayoutId.slice(-8),
      detectedVia: input.detectedVia,
      failureCode: input.failureCode ?? null,
    });
    return { id: rows[0].id, created: true };
  }
  const existing = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "stripe_payout_returns" WHERE "stripe_payout_id" = ${input.stripePayoutId} LIMIT 1
  `);
  return { id: existing[0]?.id ?? "", created: false };
}

export type PayoutReturnSummary = { returnedAt: string; failureCode: string | null };

/** Returns keyed by payout row id, for list and detail views. Empty if the table is not migrated yet. */
export async function payoutReturnsByRowId(
  payoutKind: "employee" | "business",
  rowIds: string[],
): Promise<Map<string, PayoutReturnSummary>> {
  const out = new Map<string, PayoutReturnSummary>();
  if (rowIds.length === 0) return out;
  try {
    const rows = await prisma.$queryRaw<{ payout_row_id: string; returned_at: Date; failure_code: string | null }[]>(Prisma.sql`
      SELECT "payout_row_id", "returned_at", "failure_code" FROM "stripe_payout_returns"
      WHERE "payout_kind" = ${payoutKind} AND "payout_row_id" IN (${Prisma.join(rowIds)})
    `);
    for (const r of rows) {
      out.set(r.payout_row_id, { returnedAt: new Date(r.returned_at).toISOString(), failureCode: r.failure_code });
    }
  } catch (err) {
    if (!/stripe_payout_returns/.test(String((err as Error)?.message ?? err))) throw err;
  }
  return out;
}

export type PayoutReturnRow = {
  id: string;
  payout_kind: "employee" | "business";
  payout_row_id: string;
  stripe_payout_id: string;
  business_id: string;
  employee_id: string | null;
  amount_cents: number;
  currency: string;
  returned_at: Date;
};

/** Recent returns, for the notification repair sweep. */
export async function listRecentPayoutReturns(since: Date, limit: number): Promise<PayoutReturnRow[]> {
  return prisma.$queryRaw<PayoutReturnRow[]>(Prisma.sql`
    SELECT "id", "payout_kind", "payout_row_id", "stripe_payout_id", "business_id", "employee_id",
           "amount_cents", "currency", "returned_at"
    FROM "stripe_payout_returns"
    WHERE "created_at" >= ${sqlUtcTimestamp(since)}
    ORDER BY "created_at" ASC
    LIMIT ${limit}
  `);
}
