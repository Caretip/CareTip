/**
 * Child process for financial-multi-instance-concurrency-runtime.ts (one simulated app instance).
 * Usage: tsx financial-multi-instance-concurrency-worker.ts <spec.json>
 *
 * Each round starts at spec.startAt + index * spec.roundGapMs so all instances race on it.
 * Disposable Postgres only (CARETIP_ISOLATED_POSTGRES_URL); Stripe is file-backed mocks.
 */
import { readFileSync } from "node:fs";
import type Stripe from "stripe";
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

export type WorkerRound =
  | { mode: "refund"; paymentIntentId: string; refundId: string; amountCents: number }
  | { mode: "dispute"; paymentIntentId: string; disputeId: string; amountCents: number; status: string }
  | {
      mode: "distribute";
      businessId: string;
      actorUserId: string;
      key: string;
      items: Array<{ employeeId: string; amountCents: number }>;
    }
  | { mode: "instant"; userId: string; key: string; termsVersion: string }
  | { mode: "billing-lease" }
  | {
      mode: "payout";
      account: string;
      payoutId: string;
      eventType: string;
      status: string;
      created: number;
      amountCents: number;
    };

export type WorkerSpec = {
  stateDir: string;
  startAt: number;
  roundGapMs: number;
  crashAfterReversal?: boolean;
  rounds: WorkerRound[];
};

export type WorkerRoundResult = { ok: boolean; value?: string | null; errorCode?: string; lateMs: number };

const specPath = process.argv[2]?.trim();
if (!specPath) {
  console.error("missing spec path");
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, "utf8")) as WorkerSpec;

await completeIsolatedPostgresBootstrap();
// loadEnv re-reads .env; keep any real key out of this process.
process.env.STRIPE_SECRET_KEY = ["sk", "test", "isolated", "placeholder", "not", "a", "real", "key"].join("_");

const { installMultiInstanceStripeMocks } = await import("./lib/multiInstanceStripeMocks.js");
await installMultiInstanceStripeMocks(spec.stateDir, { crashAfterReversal: spec.crashAfterReversal });
const { upsertStripeRefundEvent, upsertStripeDisputeEvent } = await import(
  "../src/services/finance/tipRefunds.service.js"
);
const { createTipDistributionBatch } = await import("../src/services/tipDistribution.service.js");
const { createEmployeeInstantPayoutForUser } = await import("../src/services/employeeInstantPayout.service.js");
const { handleConnectPayoutEvent } = await import("../src/services/stripeConnectPayout.service.js");
const { acquireBillingReconciliationRun } = await import("../src/services/subscriptionBillingReconciliation.service.js");
const { prisma } = await import("../src/prisma.js");

async function runRound(round: WorkerRound): Promise<string | null> {
  switch (round.mode) {
    case "refund":
      await upsertStripeRefundEvent({
        stripeRefundId: round.refundId,
        stripePaymentIntentId: round.paymentIntentId,
        amountCents: round.amountCents,
        status: "succeeded",
        occurredAt: new Date(),
      });
      return null;
    case "dispute":
      await upsertStripeDisputeEvent({
        stripeDisputeId: round.disputeId,
        stripePaymentIntentId: round.paymentIntentId,
        amountCents: round.amountCents,
        status: round.status,
        occurredAt: new Date(),
      });
      return null;
    case "distribute": {
      const batch = await createTipDistributionBatch({
        businessId: round.businessId,
        actorUserId: round.actorUserId,
        idempotencyKey: round.key,
        items: round.items,
      });
      return batch.id;
    }
    case "instant": {
      const { payout } = await createEmployeeInstantPayoutForUser({
        userId: round.userId,
        idempotencyKey: round.key,
        termsVersion: round.termsVersion,
        language: "en",
      });
      return payout.status;
    }
    case "billing-lease":
      return (await acquireBillingReconciliationRun(new Date()))?.id ?? null;
    case "payout": {
      const event = {
        id: `evt_mi_${round.payoutId}_${round.status}_${process.pid}`,
        object: "event",
        type: round.eventType,
        account: round.account,
        created: round.created,
        data: {
          object: {
            id: round.payoutId,
            object: "payout",
            amount: round.amountCents,
            currency: "eur",
            status: round.status,
            method: "standard",
            type: "bank_account",
            created: round.created - 1000,
            arrival_date: round.created,
          },
        },
      } as unknown as Stripe.Event;
      const result = await handleConnectPayoutEvent(event);
      if (!result.matched) throw Object.assign(new Error("payout not matched"), { code: result.reason });
      return result.reason ?? null;
    }
  }
}

const results: WorkerRoundResult[] = [];
try {
  for (const [index, round] of spec.rounds.entries()) {
    const at = spec.startAt + index * spec.roundGapMs;
    const wait = at - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const lateMs = Math.max(0, -wait);
    try {
      results.push({ ok: true, value: await runRound(round), lateMs });
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "unknown";
      if (code === "unknown") console.error(err);
      results.push({ ok: false, errorCode: code, lateMs });
    }
  }
  console.log(`RESULT ${JSON.stringify({ pid: process.pid, results })}`);
} finally {
  await prisma.$disconnect();
}
