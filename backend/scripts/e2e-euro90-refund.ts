/**
 * Refund ONLY the controlled €90 TEST PaymentIntent using CareTip production flags.
 * Target is hardcoded after read-only identification. No payouts.create. No Marie remap.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { getStripeClient } from "../src/services/stripe.service.js";

const TARGET_PI = "pi_3U4qCC66w930Tx0A1l7ydDke";
const TARGET_CHARGE = "ch_3U4qCC66w930Tx0A1Qq0FQQ0";
const TARGET_TRANSFER = "tr_3U4qCC66w930Tx0A13eDpEMI";
const TARGET_FEE = "fee_1U4qCG66w9gjO8I0YpHHZk9o";
const TARGET_CHECKOUT = "cs_test_a1WRcZ7iZLnDNiYrokbYDnyzZsev22eWtBXkwiDi1HdGzMRIlbFvqO9DIG";
const TARGET_TX_SUFFIX = "xg77nbdk";
const EXPECTED_AMOUNT_CENTS = 9000;
const EXPECTED_FEE_CENTS = 949;

function suffix(id: string | null | undefined): string {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 8 ? "(short)" : `…${s.slice(-8)}`;
}

function asId(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (v && typeof v === "object" && "id" in v && typeof (v as { id: unknown }).id === "string") {
    return (v as { id: string }).id;
  }
  return null;
}

async function waitFor<T>(label: string, ms: number, fn: () => Promise<T | null>): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const row = await fn();
    if (row) return row;
    await new Promise((r) => setTimeout(r, 2500));
  }
  console.log(`${label}=TIMEOUT`);
  return null;
}

async function counts() {
  const [transactions, payouts, webhooks, tipRefunds] = await Promise.all([
    prisma.transaction.count(),
    prisma.stripeConnectPayout.count(),
    prisma.stripeWebhookEvent.count(),
    prisma.tipRefund.count(),
  ]);
  return { transactions, payouts, webhooks, tipRefunds };
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key.startsWith("sk_test_")) {
    console.log("ABORT LIVE_KEYS_USED");
    process.exit(1);
  }
  const stripe = getStripeClient();
  const before = await counts();
  console.log("=== COUNTS BEFORE ===");
  console.log(JSON.stringify(before));

  const biz = await prisma.business.findFirst({
    where: { name: { contains: "Phase26", mode: "insensitive" } },
    select: { id: true, stripeAccountId: true },
  });
  if (!biz?.stripeAccountId) throw new Error("Marie Business not found");
  const marie = biz.stripeAccountId;
  const marieBefore = marie;

  const historical = await prisma.transaction.findMany({
    where: { businessId: biz.id, NOT: { stripePaymentIntentId: TARGET_PI } },
    select: { id: true, amount: true, status: true, stripePaymentIntentId: true },
  });
  const historicalFingerprint = historical
    .map((t) => `${t.stripePaymentIntentId}:${t.status}:${t.amount}`)
    .sort()
    .join("|");

  const pi = await stripe.paymentIntents.retrieve(TARGET_PI);
  const dest = asId(pi.transfer_data?.destination);
  console.log("=== PRE-REFUND ASSERTIONS ===");
  console.log(`pi=${pi.id} amount=${pi.amount} currency=${pi.currency} status=${pi.status}`);
  console.log(`fee=${pi.application_fee_amount} dest=${suffix(dest)} dest_match=${dest === marie}`);
  console.log(`charge=${asId(pi.latest_charge)}`);
  if (pi.id !== TARGET_PI) throw new Error("PI mismatch");
  if (pi.amount !== EXPECTED_AMOUNT_CENTS) throw new Error("Not the €90 payment");
  if (pi.currency !== "eur") throw new Error("Not EUR");
  if (pi.status !== "succeeded") throw new Error("PI not succeeded");
  if (pi.application_fee_amount !== EXPECTED_FEE_CENTS) throw new Error("Fee is not 949");
  if (dest !== marie) throw new Error("Destination is not Marie");
  if (asId(pi.latest_charge) !== TARGET_CHARGE) throw new Error("Charge mismatch");
  const charge = await stripe.charges.retrieve(TARGET_CHARGE);
  if (charge.refunded) throw new Error("Already refunded");
  const dbTx = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: TARGET_PI },
    select: { id: true, amount: true, status: true, businessId: true },
  });
  if (!dbTx || Number(dbTx.amount) !== 90 || dbTx.businessId !== biz.id) {
    throw new Error("CareTip transaction is not the controlled €90 row");
  }
  if (!dbTx.id.endsWith(TARGET_TX_SUFFIX)) throw new Error("Transaction suffix mismatch");
  console.log(`db_tx=${suffix(dbTx.id)} status=${dbTx.status} amount=${dbTx.amount}`);
  console.log(`checkout=${TARGET_CHECKOUT}`);
  console.log("USING_PRODUCTION_REFUND_CONTRACT refund_application_fee=true reverse_transfer=true");
  console.log(`idempotencyKey=eligibility_refund:${TARGET_PI}`);

  const refund = await stripe.refunds.create(
    {
      payment_intent: TARGET_PI,
      refund_application_fee: true,
      reverse_transfer: true,
      metadata: {
        caretip_refund_reason: "eligibility_failure",
        caretip_context: "e2e_euro90_controlled_lifecycle",
      },
    },
    { idempotencyKey: `eligibility_refund:${TARGET_PI}` },
  );
  console.log(`refund=${refund.id} status=${refund.status} amount=${refund.amount} currency=${refund.currency}`);

  const replay = await stripe.refunds.create(
    {
      payment_intent: TARGET_PI,
      refund_application_fee: true,
      reverse_transfer: true,
      metadata: {
        caretip_refund_reason: "eligibility_failure",
        caretip_context: "e2e_euro90_controlled_lifecycle",
      },
    },
    { idempotencyKey: `eligibility_refund:${TARGET_PI}` },
  );
  console.log(`refund_idempotent=${replay.id === refund.id}`);

  const piAfter = await stripe.paymentIntents.retrieve(TARGET_PI);
  const chAfter = await stripe.charges.retrieve(TARGET_CHARGE);
  const feeAfter = await stripe.applicationFees.retrieve(TARGET_FEE);
  const trAfter = await stripe.transfers.retrieve(TARGET_TRANSFER);
  const reversals = await stripe.transfers.listReversals(TARGET_TRANSFER, { limit: 5 });
  console.log(`pi_after=${piAfter.status} amount_received=${piAfter.amount_received}`);
  console.log(`charge_refunded=${chAfter.refunded === true} amount_refunded=${chAfter.amount_refunded}`);
  console.log(
    `application_fee_after refunded=${feeAfter.refunded} amount_refunded=${feeAfter.amount_refunded} amount=${feeAfter.amount}`,
  );
  console.log(
    `transfer_after reversed=${trAfter.reversed} amount_reversed=${trAfter.amount_reversed} amount=${trAfter.amount}`,
  );
  for (const rev of reversals.data) {
    console.log(`transfer_reversal=${rev.id} amount=${rev.amount} currency=${rev.currency}`);
  }

  const tipRefund = await waitFor("tipRefund", 120000, async () =>
    prisma.tipRefund.findFirst({
      where: {
        OR: [{ stripeRefundId: refund.id }, { stripePaymentIntentId: TARGET_PI }],
      },
      select: {
        id: true,
        status: true,
        amountEur: true,
        businessId: true,
        tipId: true,
        stripeRefundId: true,
        stripePaymentIntentId: true,
        stripeChargeId: true,
      },
    }),
  );
  if (tipRefund) {
    console.log(
      `tipRefund=${suffix(tipRefund.id)} status=${tipRefund.status} amountEur=${tipRefund.amountEur} biz_match=${tipRefund.businessId === biz.id} tip_match=${tipRefund.tipId === dbTx.id} refund_id_match=${tipRefund.stripeRefundId === refund.id} pi_match=${tipRefund.stripePaymentIntentId === TARGET_PI} charge_match=${tipRefund.stripeChargeId === TARGET_CHARGE}`,
    );
  } else {
    console.log("tipRefund=NOT_RECEIVED");
  }

  const refundCreatedGte = Math.max(0, Math.floor(Date.now() / 1000) - 300);
  const refundRelated: string[] = [];
  for (const type of ["charge.refunded", "refund.updated"] as const) {
    const listed = await stripe.events.list({ type, created: { gte: refundCreatedGte }, limit: 20 });
    for (const ev of listed.data) {
      const obj = ev.data.object as { id?: string; payment_intent?: unknown; charge?: unknown };
      const related =
        obj.id === refund.id ||
        obj.id === TARGET_CHARGE ||
        asId(obj.payment_intent) === TARGET_PI ||
        asId(obj.charge) === TARGET_CHARGE;
      if (!related) continue;
      refundRelated.push(ev.id);
      console.log(
        `stripe_event ${ev.id} type=${ev.type} pending_webhooks=${ev.pending_webhooks} livemode=${ev.livemode}`,
      );
    }
  }
  const refundDbEvents =
    refundRelated.length > 0
      ? await prisma.stripeWebhookEvent.findMany({ where: { id: { in: refundRelated } } })
      : [];
  for (const ev of refundDbEvents) {
    console.log(`processed_refund_event ${ev.id} type=${ev.eventType} at=${ev.processedAt.toISOString()}`);
  }
  if (refundRelated.length > 0 && refundDbEvents.length === 0) {
    const late = await waitFor("refundWebhookRow", 60000, async () => {
      const rows = await prisma.stripeWebhookEvent.findMany({ where: { id: { in: refundRelated } } });
      return rows[0] ?? null;
    });
    if (late) console.log(`late_processed ${late.id} type=${late.eventType}`);
  }

  const duplicateRefunds = await prisma.tipRefund.findMany({
    where: { stripePaymentIntentId: TARGET_PI },
    select: { id: true, stripeRefundId: true, status: true, amountEur: true },
  });
  console.log(`tipRefund_rows_for_pi=${duplicateRefunds.length}`);

  const listedPayouts = await stripe.payouts.list({ limit: 10 }, { stripeAccount: marie });
  console.log(`existing_payout_objects=${listedPayouts.data.length}`);
  const afterBiz = await prisma.business.findUnique({
    where: { id: biz.id },
    select: { stripeAccountId: true },
  });
  const after = await counts();
  const historicalAfter = await prisma.transaction.findMany({
    where: { businessId: biz.id, NOT: { stripePaymentIntentId: TARGET_PI } },
    select: { id: true, amount: true, status: true, stripePaymentIntentId: true },
  });
  const historicalFingerprintAfter = historicalAfter
    .map((t) => `${t.stripePaymentIntentId}:${t.status}:${t.amount}`)
    .sort()
    .join("|");
  const controlledAfter = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: TARGET_PI },
    select: { id: true, amount: true, status: true },
  });
  console.log("=== COUNTS AFTER ===");
  console.log(JSON.stringify(after));
  console.log(`MARIE_ACCOUNT_UNCHANGED=${afterBiz?.stripeAccountId === marieBefore}`);
  console.log(`HISTORICAL_UNCHANGED=${historicalFingerprint === historicalFingerprintAfter}`);
  console.log(
    `controlled_tx_status=${controlledAfter?.status ?? "(none)"} amount=${controlledAfter?.amount ?? "(none)"}`,
  );
  console.log("LIVE_KEYS_USED=NO");
  console.log("PAYOUTS_CREATE_CALLED=NO");
  console.log("NEW_STRIPE_ACCOUNT_CREATED=NO");
}

void main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
