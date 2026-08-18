/**
 * Read-only identifier for the controlled €90 TEST payment.
 * Does not refund, create accounts, remap Marie, or call payouts.create.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { calculateTipPlatformFeeCents } from "../src/config/fees.js";
import { getStripeClient } from "../src/services/stripe.service.js";

const TEST_WEBHOOK_URL = "https://caretip.onrender.com/api/webhooks/stripe";
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

async function counts() {
  const [businesses, transactions, payouts, payoutLines, webhooks, tipRefunds] = await Promise.all([
    prisma.business.count(),
    prisma.transaction.count(),
    prisma.stripeConnectPayout.count(),
    prisma.stripeConnectPayoutBalanceLine.count(),
    prisma.stripeWebhookEvent.count(),
    prisma.tipRefund.count(),
  ]);
  return { businesses, transactions, payouts, payoutLines, webhooks, tipRefunds };
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key.startsWith("sk_test_")) {
    console.log("ABORT LIVE_KEYS_USED");
    process.exit(1);
  }
  const stripe = getStripeClient();
  const before = await counts();
  console.log("=== COUNTS ===");
  console.log(JSON.stringify(before));

  const biz = await prisma.business.findFirst({
    where: { name: { contains: "Phase26", mode: "insensitive" } },
    select: { id: true, name: true, stripeAccountId: true, stripeConnectStatus: true },
  });
  if (!biz?.stripeAccountId) throw new Error("Marie Business not found");
  const marie = biz.stripeAccountId;
  console.log("\n=== MARIE ===");
  console.log(`business=${suffix(biz.id)} name=${biz.name} status=${biz.stripeConnectStatus}`);
  console.log(`stripeAccountId=${suffix(marie)}`);
  console.log(`fee_policy_9000=${calculateTipPlatformFeeCents(EXPECTED_AMOUNT_CENTS)}`);

  const recentTips = await prisma.transaction.findMany({
    where: { businessId: biz.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      amount: true,
      status: true,
      stripePaymentIntentId: true,
      createdAt: true,
      employeeId: true,
      receiptNumber: true,
    },
  });
  console.log("\n=== MARIE DB TIPS ===");
  for (const t of recentTips) {
    console.log(
      `db_tip ${suffix(t.id)} amount=${t.amount} status=${t.status} pi=${suffix(t.stripePaymentIntentId)} created=${t.createdAt.toISOString()} receipt=${t.receiptNumber ?? "(none)"}`,
    );
  }

  const sessions = await stripe.checkout.sessions.list({ limit: 30 });
  const pis = await stripe.paymentIntents.list({ limit: 30 });
  const sessionNinety = sessions.data.find((s) => {
    const amt = s.amount_total ?? s.amount_subtotal;
    return amt === EXPECTED_AMOUNT_CENTS && s.currency === "eur" && s.payment_status === "paid";
  });
  const piNinety = pis.data.find(
    (p) =>
      p.amount === EXPECTED_AMOUNT_CENTS &&
      p.currency === "eur" &&
      p.status === "succeeded" &&
      asId(p.transfer_data?.destination) === marie,
  );
  const dbNinety = recentTips.find((t) => Number(t.amount) === 90 && t.stripePaymentIntentId);
  const piId = piNinety?.id ?? dbNinety?.stripePaymentIntentId ?? asId(sessionNinety?.payment_intent);
  if (!piId) throw new Error("Could not identify €90 PaymentIntent");

  const pi = await stripe.paymentIntents.retrieve(piId, {
    expand: ["latest_charge.application_fee", "latest_charge.transfer", "latest_charge.balance_transaction"],
  });
  const dest = asId(pi.transfer_data?.destination);
  const chargeId = asId(pi.latest_charge);
  const charge =
    pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const appFeeObj =
    charge && typeof charge.application_fee === "object" && charge.application_fee
      ? charge.application_fee
      : null;
  const transferObj =
    charge && typeof charge.transfer === "object" && charge.transfer ? charge.transfer : null;
  const platformBt =
    charge && typeof charge.balance_transaction === "object" && charge.balance_transaction
      ? charge.balance_transaction
      : null;
  const appFeeId = asId(appFeeObj) ?? asId(charge && "application_fee" in charge ? charge.application_fee : null);
  const transferId = asId(transferObj) ?? asId(charge && "transfer" in charge ? charge.transfer : null);
  const checkoutFromList = sessions.data.find((s) => asId(s.payment_intent) === pi.id);
  const checkoutId = sessionNinety?.id ?? checkoutFromList?.id ?? null;

  console.log("\n=== CONTROLLED €90 OBJECTS ===");
  console.log(`THIS_E2E_PAYMENT_INTENT=${pi.id}`);
  console.log(`THIS_E2E_CHECKOUT=${checkoutId ?? "(none)"}`);
  console.log(`THIS_E2E_CHARGE=${chargeId ?? "(none)"}`);
  console.log(`THIS_E2E_TRANSFER=${transferId ?? "(none)"}`);
  console.log(`THIS_E2E_APPLICATION_FEE=${appFeeId ?? "(none)"}`);
  console.log(`amount=${pi.amount} currency=${pi.currency} status=${pi.status}`);
  console.log(`application_fee_amount=${pi.application_fee_amount}`);
  console.log(`destination=${suffix(dest)} destination_match=${dest === marie}`);
  console.log(`charge_paid=${charge && "paid" in charge ? charge.paid === true : "(none)"}`);
  console.log(`charge_amount=${charge && "amount" in charge ? charge.amount : "(none)"}`);
  console.log(`charge_refunded=${charge && "refunded" in charge ? charge.refunded === true : "(none)"}`);
  console.log(`application_fee_obj_amount=${appFeeObj && "amount" in appFeeObj ? appFeeObj.amount : "(none)"}`);
  console.log(`transfer_amount=${transferObj && "amount" in transferObj ? transferObj.amount : "(none)"}`);
  console.log(
    `platform_processing_fee_cents=${platformBt && "fee" in platformBt ? platformBt.fee : "(none)"}`,
  );
  console.log(
    `platform_bt_amount=${platformBt && "amount" in platformBt ? platformBt.amount : "(none)"} net=${platformBt && "net" in platformBt ? platformBt.net : "(none)"}`,
  );
  console.log(`guest_pays_only_tip=${pi.amount === EXPECTED_AMOUNT_CENTS}`);
  console.log(
    `invariants amount_ok=${pi.amount === EXPECTED_AMOUNT_CENTS} fee_ok=${pi.application_fee_amount === EXPECTED_FEE_CENTS} dest_ok=${dest === marie} succeeded=${pi.status === "succeeded"} eur=${pi.currency === "eur"}`,
  );

  const dbTx = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: pi.id },
    select: {
      id: true,
      amount: true,
      status: true,
      businessId: true,
      employeeId: true,
      receiptNumber: true,
      createdAt: true,
    },
  });
  console.log("\n=== CARETIP TRANSACTION ===");
  if (!dbTx) console.log("CARETIP_TX=MISSING");
  else {
    console.log(
      `tx=${suffix(dbTx.id)} amount=${dbTx.amount} status=${dbTx.status} biz_match=${dbTx.businessId === biz.id} receipt=${dbTx.receiptNumber ?? "(none)"} created=${dbTx.createdAt.toISOString()}`,
    );
  }

  const bal = await stripe.balance.retrieve({ stripeAccount: marie });
  console.log("\n=== MARIE BALANCE / PAYOUT SCHEDULE ===");
  console.log(`available=${bal.available.map((b) => `${b.amount} ${b.currency}`).join(",") || "0"}`);
  console.log(`pending=${bal.pending.map((b) => `${b.amount} ${b.currency}`).join(",") || "0"}`);
  const acct = await stripe.accounts.retrieve(marie);
  const settings = acct.settings?.payouts;
  console.log(
    `payout_schedule=${settings?.schedule?.interval ?? "(none)"} delay_days=${settings?.schedule?.delay_days ?? "(none)"}`,
  );

  if (transferId) {
    const transfer = await stripe.transfers.retrieve(transferId);
    console.log(
      `transfer ${transfer.id} amount=${transfer.amount} reversed=${transfer.reversed} amount_reversed=${transfer.amount_reversed} dest=${suffix(asId(transfer.destination))}`,
    );
    const destPay = asId(transfer.destination_payment);
    if (destPay) {
      try {
        const destCharge = await stripe.charges.retrieve(destPay, {
          stripeAccount: marie,
          expand: ["balance_transaction"],
        });
        const destBt =
          destCharge.balance_transaction && typeof destCharge.balance_transaction === "object"
            ? destCharge.balance_transaction
            : null;
        console.log(
          `connected_destination_payment=${suffix(destCharge.id)} amount=${destCharge.amount} bt_fee=${destBt && "fee" in destBt ? destBt.fee : "(none)"} bt_net=${destBt && "net" in destBt ? destBt.net : "(none)"}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`connected_bt_failed ${msg.slice(0, 200)}`);
      }
    }
  }
  if (appFeeId) {
    const fee = await stripe.applicationFees.retrieve(appFeeId);
    console.log(
      `application_fee ${fee.id} amount=${fee.amount} refunded=${fee.refunded} amount_refunded=${fee.amount_refunded}`,
    );
  }

  const connectedBts = await stripe.balanceTransactions.list({ limit: 10 }, { stripeAccount: marie });
  console.log("\n=== MARIE BALANCE TRANSACTIONS ===");
  for (const bt of connectedBts.data) {
    console.log(
      `bt ${suffix(bt.id)} type=${bt.type} amount=${bt.amount} fee=${bt.fee} net=${bt.net} ${bt.currency}`,
    );
  }

  const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
  const ep = endpoints.data.find((e) => e.url === TEST_WEBHOOK_URL);
  console.log("\n=== WEBHOOK DESTINATION ===");
  console.log(
    ep
      ? `endpoint=${ep.id} status=${ep.status} enabled_count=${ep.enabled_events.length}`
      : "TEST_WEBHOOK=NOT_FOUND",
  );

  const createdGte = Math.max(0, (pi.created ?? 0) - 120);
  const relatedEventIds: string[] = [];
  console.log("\n=== STRIPE EVENTS FOR THIS PAYMENT ===");
  for (const type of [
    "checkout.session.completed",
    "payment_intent.succeeded",
    "charge.refunded",
    "refund.updated",
    "application_fee.created",
    "transfer.created",
  ]) {
    const listed = await stripe.events.list({ type, created: { gte: createdGte }, limit: 30 });
    for (const ev of listed.data) {
      const obj = ev.data.object as { id?: string; payment_intent?: unknown };
      const objId = typeof obj.id === "string" ? obj.id : "";
      const objPi = asId(obj.payment_intent);
      const related =
        objId === pi.id ||
        objId === chargeId ||
        objId === checkoutId ||
        objId === transferId ||
        objId === appFeeId ||
        objPi === pi.id;
      if (!related) continue;
      relatedEventIds.push(ev.id);
      console.log(
        `stripe_event ${ev.id} type=${ev.type} pending_webhooks=${ev.pending_webhooks} livemode=${ev.livemode} obj=${suffix(objId)}`,
      );
    }
  }
  const dbEvents = relatedEventIds.length
    ? await prisma.stripeWebhookEvent.findMany({ where: { id: { in: relatedEventIds } } })
    : [];
  console.log("\n=== CARETIP WEBHOOK EVENT ROWS ===");
  for (const ev of dbEvents) {
    console.log(`processed ${ev.id} type=${ev.eventType} at=${ev.processedAt.toISOString()}`);
  }
  const paymentEventRows = await prisma.stripeWebhookEvent.findMany({
    where: {
      eventType: { in: ["checkout.session.completed", "payment_intent.succeeded"] },
      processedAt: { gte: new Date(((pi.created ?? 0) - 120) * 1000) },
    },
    orderBy: { processedAt: "desc" },
    take: 20,
  });
  for (const ev of paymentEventRows) {
    console.log(`recent_payment_wh ${ev.id} type=${ev.eventType} at=${ev.processedAt.toISOString()}`);
  }

  const listedPayouts = await stripe.payouts.list({ limit: 10 }, { stripeAccount: marie });
  console.log("\n=== PAYOUT OBSERVATION ===");
  console.log(`existing_payout_objects=${listedPayouts.data.length}`);
  for (const p of listedPayouts.data) {
    console.log(
      `payout=${p.id} status=${p.status} amount=${p.amount} ${p.currency} automatic=${p.automatic === true}`,
    );
  }
  const dbPayouts = await prisma.stripeConnectPayout.count({ where: { businessId: biz.id } });
  console.log(`caretip_payout_rows_marie=${dbPayouts}`);
  if (listedPayouts.data.length === 0) {
    console.log("PAYOUT_E2E=BLOCKED no_stripe_payout_object_yet");
  }

  const afterBiz = await prisma.business.findUnique({
    where: { id: biz.id },
    select: { stripeAccountId: true },
  });
  console.log("\n=== SAFETY ===");
  console.log(`MARIE_ACCOUNT_UNCHANGED=${afterBiz?.stripeAccountId === marie}`);
  console.log("LIVE_KEYS_USED=NO");
  console.log("READ_ONLY=YES");
  console.log("REFUND_EXECUTED=NO");
  console.log("PAYOUTS_CREATE_CALLED=NO");
}

void main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
