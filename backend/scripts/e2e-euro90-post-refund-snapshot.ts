/**
 * Post-refund read-only snapshot for the controlled €90 TEST payment.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { getStripeClient } from "../src/services/stripe.service.js";

const TARGET_PI = "pi_3U4qCC66w930Tx0A1l7ydDke";
const TARGET_CHARGE = "ch_3U4qCC66w930Tx0A1Qq0FQQ0";
const TARGET_TRANSFER = "tr_3U4qCC66w930Tx0A13eDpEMI";
const TARGET_FEE = "fee_1U4qCG66w9gjO8I0YpHHZk9o";
const TARGET_REFUND = "re_3U4qCC66w930Tx0A1iXSuzoQ";
const CHARGE_REFUNDED_EVT = "evt_3U4qCC66w930Tx0A1Ux00lwZ";
const REFUND_UPDATED_EVT = "evt_3U4qCC66w930Tx0A1URI4ujZ";

function suffix(id: string | null | undefined): string {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 8 ? "(short)" : `…${s.slice(-8)}`;
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key.startsWith("sk_test_")) {
    console.log("ABORT LIVE_KEYS_USED");
    process.exit(1);
  }
  const stripe = getStripeClient();
  const biz = await prisma.business.findFirst({
    where: { name: { contains: "Phase26", mode: "insensitive" } },
    select: { id: true, stripeAccountId: true },
  });
  if (!biz?.stripeAccountId) throw new Error("Marie missing");

  const chargeEvt = await stripe.events.retrieve(CHARGE_REFUNDED_EVT);
  const refundEvt = await stripe.events.retrieve(REFUND_UPDATED_EVT);
  console.log(
    `charge.refunded ${chargeEvt.id} pending_webhooks=${chargeEvt.pending_webhooks} type=${chargeEvt.type}`,
  );
  console.log(
    `refund.updated ${refundEvt.id} pending_webhooks=${refundEvt.pending_webhooks} type=${refundEvt.type}`,
  );

  const bal = await stripe.balance.retrieve({ stripeAccount: biz.stripeAccountId });
  console.log(`available=${bal.available.map((b) => `${b.amount} ${b.currency}`).join(",")}`);
  console.log(`pending=${bal.pending.map((b) => `${b.amount} ${b.currency}`).join(",")}`);
  const listedPayouts = await stripe.payouts.list({ limit: 5 }, { stripeAccount: biz.stripeAccountId });
  console.log(`payout_objects=${listedPayouts.data.length}`);

  const connectedBts = await stripe.balanceTransactions.list({ limit: 6 }, { stripeAccount: biz.stripeAccountId });
  for (const bt of connectedBts.data) {
    console.log(`bt ${suffix(bt.id)} type=${bt.type} amount=${bt.amount} fee=${bt.fee} net=${bt.net}`);
  }

  const dbEvents = await prisma.stripeWebhookEvent.findMany({
    where: { id: { in: [CHARGE_REFUNDED_EVT, REFUND_UPDATED_EVT] } },
  });
  for (const ev of dbEvents) {
    console.log(`db_wh ${ev.id} type=${ev.eventType} at=${ev.processedAt.toISOString()}`);
  }
  const refunds = await prisma.tipRefund.findMany({
    where: { stripePaymentIntentId: TARGET_PI },
  });
  console.log(`tipRefund_count=${refunds.length}`);
  for (const r of refunds) {
    console.log(
      `tipRefund ${suffix(r.id)} status=${r.status} amount=${r.amountEur} refund=${r.stripeRefundId} charge=${r.stripeChargeId} tip=${suffix(r.tipId)}`,
    );
  }
  const tx = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: TARGET_PI },
    select: { id: true, amount: true, status: true },
  });
  console.log(`tx ${suffix(tx?.id)} status=${tx?.status} amount=${tx?.amount}`);
  const fee = await stripe.applicationFees.retrieve(TARGET_FEE);
  const transfer = await stripe.transfers.retrieve(TARGET_TRANSFER);
  const charge = await stripe.charges.retrieve(TARGET_CHARGE);
  const refund = await stripe.refunds.retrieve(TARGET_REFUND);
  console.log(`fee refunded=${fee.refunded} amount_refunded=${fee.amount_refunded}`);
  console.log(`transfer reversed=${transfer.reversed} amount_reversed=${transfer.amount_reversed}`);
  console.log(`charge refunded=${charge.refunded} amount_refunded=${charge.amount_refunded}`);
  console.log(`refund status=${refund.status} amount=${refund.amount}`);
  console.log(`MARIE_UNCHANGED=${(await prisma.business.findUnique({ where: { id: biz.id }, select: { stripeAccountId: true } }))?.stripeAccountId === biz.stripeAccountId}`);
}

void main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
