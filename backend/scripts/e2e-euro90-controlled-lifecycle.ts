/**
 * Controlled €90 TEST lifecycle: identify → money flow → webhooks → production-flag refund.
 * Never remaps Marie. Never refunds historical PIs. Never calls payouts.create.
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
  console.log("=== COUNTS BEFORE ===");
  console.log(JSON.stringify(before));

  const biz = await prisma.business.findFirst({
    where: { name: { contains: "Phase26", mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      stripeAccountId: true,
      stripeConnectStatus: true,
    },
  });
  if (!biz?.stripeAccountId) throw new Error("Marie Business not found");
  const marie = biz.stripeAccountId;
  console.log("\n=== MARIE ===");
  console.log(`business=${suffix(biz.id)} name=${biz.name} status=${biz.stripeConnectStatus}`);
  console.log(`stripeAccountId=${suffix(marie)}`);

  const expectedFee = calculateTipPlatformFeeCents(EXPECTED_AMOUNT_CENTS);
  console.log(`fee_policy_9000cents=${expectedFee} expected=${EXPECTED_FEE_CENTS}`);
  if (expectedFee !== EXPECTED_FEE_CENTS) {
    throw new Error("Fee policy mismatch for €90");
  }

  console.log("\n=== IDENTIFY €90 TRANSACTION ===");
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
  for (const t of recentTips) {
    console.log(
      `db_tip ${suffix(t.id)} amount=${t.amount} status=${t.status} pi=${suffix(t.stripePaymentIntentId)} created=${t.createdAt.toISOString()}`,
    );
  }

  const dbNinety = recentTips.find((t) => Number(t.amount) === 90 && t.stripePaymentIntentId);
  const sessions = await stripe.checkout.sessions.list({ limit: 30 });
  const sessionNinety = sessions.data.find((s) => {
    const amt = s.amount_total ?? s.amount_subtotal;
    return amt === EXPECTED_AMOUNT_CENTS && s.currency === "eur" && s.payment_status === "paid";
  });
  console.log(`checkout_paid_90=${suffix(sessionNinety?.id)} status=${sessionNinety?.status ?? "(none)"}`);

  const pis = await stripe.paymentIntents.list({ limit: 30 });
  const piNinety = pis.data.find(
    (p) =>
      p.amount === EXPECTED_AMOUNT_CENTS &&
      p.currency === "eur" &&
      p.status === "succeeded" &&
      asId(p.transfer_data?.destination) === marie,
  );
  const piId = piNinety?.id ?? dbNinety?.stripePaymentIntentId ?? asId(sessionNinety?.payment_intent);
  if (!piId) {
    throw new Error("Could not identify €90 PaymentIntent");
  }
  const pi = await stripe.paymentIntents.retrieve(piId, {
    expand: ["latest_charge.application_fee", "latest_charge.transfer", "latest_charge.balance_transaction"],
  });
  const dest = asId(pi.transfer_data?.destination);
  const chargeId = asId(pi.latest_charge);
  const charge =
    pi.latest_charge && typeof pi.latest_charge === "object"
      ? pi.latest_charge
      : chargeId
        ? await stripe.charges.retrieve(chargeId, {
            expand: ["application_fee", "transfer", "balance_transaction"],
          })
        : null;

  if (pi.amount !== EXPECTED_AMOUNT_CENTS || pi.currency !== "eur" || pi.status !== "succeeded") {
    throw new Error(`PI is not the controlled €90 succeeded payment amount=${pi.amount} status=${pi.status}`);
  }
  if (pi.application_fee_amount !== EXPECTED_FEE_CENTS) {
    throw new Error(`application_fee_amount=${pi.application_fee_amount} expected ${EXPECTED_FEE_CENTS}`);
  }
  if (dest !== marie) {
    throw new Error(`destination mismatch dest=${suffix(dest)} marie=${suffix(marie)}`);
  }
  if (Number(dbNinety?.amount) === 1 || pi.amount === 100 || pi.amount === 1000) {
    throw new Error("Refusing historical €1/€10 payment");
  }

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
  console.log(
    `application_fee_amount_obj=${appFeeObj && "amount" in appFeeObj ? appFeeObj.amount : "(none)"}`,
  );
  console.log(`transfer_amount=${transferObj && "amount" in transferObj ? transferObj.amount : "(none)"}`);
  console.log(
    `transfer_destination=${suffix(asId(transferObj && "destination" in transferObj ? transferObj.destination : null))}`,
  );
  console.log(
    `platform_processing_fee_cents=${platformBt && "fee" in platformBt ? platformBt.fee : "(none)"}`,
  );
  console.log(
    `platform_bt_net=${platformBt && "net" in platformBt ? platformBt.net : "(none)"} amount=${platformBt && "amount" in platformBt ? platformBt.amount : "(none)"}`,
  );
  console.log(`guest_pays_only_tip=${pi.amount === EXPECTED_AMOUNT_CENTS}`);
  console.log(`caretip_fee_cents=${EXPECTED_FEE_CENTS} business_remainder_cents=${EXPECTED_AMOUNT_CENTS - EXPECTED_FEE_CENTS}`);

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
  if (!dbTx) {
    console.log("CARETIP_TX=MISSING");
  } else {
    console.log(
      `tx=${suffix(dbTx.id)} amount=${dbTx.amount} status=${dbTx.status} biz_match=${dbTx.businessId === biz.id} receipt=${dbTx.receiptNumber ?? "(none)"} created=${dbTx.createdAt.toISOString()}`,
    );
  }

  const historicalOther = recentTips.filter(
    (t) => t.stripePaymentIntentId && t.stripePaymentIntentId !== pi.id,
  );
  console.log(`historical_marie_other_tips=${historicalOther.length}`);

  console.log("\n=== CONNECTED ACCOUNT BALANCE ===");
  const bal = await stripe.balance.retrieve({ stripeAccount: marie });
  console.log(`available=${bal.available.map((b) => `${b.amount} ${b.currency}`).join(",") || "0"}`);
  console.log(`pending=${bal.pending.map((b) => `${b.amount} ${b.currency}`).join(",") || "0"}`);
  const acct = await stripe.accounts.retrieve(marie);
  const settings = acct.settings?.payouts;
  console.log(
    `payout_schedule=${settings?.schedule?.interval ?? "(none)"} delay_days=${settings?.schedule?.delay_days ?? "(none)"}`,
  );

  if (transferId) {
    const transfer = await stripe.transfers.retrieve(transferId, { expand: ["destination_payment"] });
    console.log(`transfer_id=${transfer.id} amount=${transfer.amount} currency=${transfer.currency}`);
    console.log(`transfer_reversed=${transfer.reversed} amount_reversed=${transfer.amount_reversed}`);
    console.log(`transfer_destination=${suffix(asId(transfer.destination))}`);
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
        console.log(`connected_destination_payment_retrieve_failed ${msg.slice(0, 200)}`);
      }
    }
    const reversals = await stripe.transfers.listReversals(transferId, { limit: 5 });
    console.log(`existing_transfer_reversals=${reversals.data.length}`);
  }

  if (appFeeId) {
    const fee = await stripe.applicationFees.retrieve(appFeeId);
    console.log(
      `application_fee ${fee.id} amount=${fee.amount} currency=${fee.currency} refunded=${fee.refunded} amount_refunded=${fee.amount_refunded}`,
    );
  }

  const connectedBts = await stripe.balanceTransactions.list(
    { limit: 15, expand: ["data.source"] },
    { stripeAccount: marie },
  );
  console.log("\n=== MARIE BALANCE TRANSACTIONS (latest 8) ===");
  for (const bt of connectedBts.data.slice(0, 8)) {
    console.log(
      `bt ${suffix(bt.id)} type=${bt.type} amount=${bt.amount} fee=${bt.fee} net=${bt.net} ${bt.currency} src=${suffix(asId(bt.source))}`,
    );
  }

  console.log("\n=== WEBHOOK DESTINATION ===");
  const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
  const ep = endpoints.data.find((e) => e.url === TEST_WEBHOOK_URL);
  console.log(
    ep
      ? `endpoint=${ep.id} status=${ep.status} enabled_count=${ep.enabled_events.length}`
      : "TEST_WEBHOOK=NOT_FOUND",
  );

  const createdGte = Math.max(0, (pi.created ?? 0) - 120);
  const eventTypes = [
    "checkout.session.completed",
    "payment_intent.succeeded",
    "charge.refunded",
    "refund.updated",
    "application_fee.created",
    "transfer.created",
  ];
  console.log("\n=== STRIPE EVENTS FOR THIS PAYMENT ===");
  const relatedEventIds: string[] = [];
  for (const type of eventTypes) {
    const listed = await stripe.events.list({ type, created: { gte: createdGte }, limit: 30 });
    for (const ev of listed.data) {
      const obj = ev.data.object as {
        id?: string;
        payment_intent?: unknown;
        object?: string;
        amount?: number;
      };
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
  const paymentEventTypes = ["checkout.session.completed", "payment_intent.succeeded"];
  for (const type of paymentEventTypes) {
    const stripeEv = relatedEventIds.filter((id) => dbEvents.some((d) => d.id === id));
    const anyOfType = dbEvents.filter((d) => d.eventType === type);
    console.log(
      `webhook_${type} stripe_related=${relatedEventIds.length} db_processed_related=${anyOfType.length} db_ids=${anyOfType.map((d) => d.id).join(",") || "(none)"}`,
    );
    void stripeEv;
  }

  const alreadyRefunded = charge && "refunded" in charge && charge.refunded === true;
  if (alreadyRefunded) {
    console.log("ABORT already refunded — will not refund again");
    process.exit(1);
  }

  console.log("\n=== REFUND TARGET CONFIRMATION ===");
  console.log(`refund_target_pi=${pi.id}`);
  console.log(`refund_target_amount=${pi.amount}`);
  console.log(`refund_target_fee=${pi.application_fee_amount}`);
  console.log(`refund_target_dest_match=${dest === marie}`);
  console.log("USING_PRODUCTION_REFUND_CONTRACT refund_application_fee=true reverse_transfer=true");
  console.log(`idempotencyKey=eligibility_refund:${pi.id}`);

  const refund = await stripe.refunds.create(
    {
      payment_intent: pi.id,
      refund_application_fee: true,
      reverse_transfer: true,
      metadata: {
        caretip_refund_reason: "eligibility_failure",
        caretip_context: "e2e_euro90_controlled_lifecycle",
      },
    },
    { idempotencyKey: `eligibility_refund:${pi.id}` },
  );
  console.log(`refund=${refund.id} status=${refund.status} amount=${refund.amount} currency=${refund.currency}`);

  const replay = await stripe.refunds.create(
    {
      payment_intent: pi.id,
      refund_application_fee: true,
      reverse_transfer: true,
      metadata: {
        caretip_refund_reason: "eligibility_failure",
        caretip_context: "e2e_euro90_controlled_lifecycle",
      },
    },
    { idempotencyKey: `eligibility_refund:${pi.id}` },
  );
  console.log(`refund_idempotent=${replay.id === refund.id} replay=${replay.id}`);

  const piAfter = await stripe.paymentIntents.retrieve(pi.id);
  console.log(`pi_after=${piAfter.status} amount_received=${piAfter.amount_received}`);
  if (chargeId) {
    const ch = await stripe.charges.retrieve(chargeId);
    console.log(`charge_refunded=${ch.refunded === true} amount_refunded=${ch.amount_refunded}`);
  }
  if (appFeeId) {
    const feeAfter = await stripe.applicationFees.retrieve(appFeeId);
    console.log(
      `application_fee_after refunded=${feeAfter.refunded} amount_refunded=${feeAfter.amount_refunded} amount=${feeAfter.amount}`,
    );
  }
  if (transferId) {
    const trAfter = await stripe.transfers.retrieve(transferId);
    console.log(
      `transfer_after reversed=${trAfter.reversed} amount_reversed=${trAfter.amount_reversed} amount=${trAfter.amount}`,
    );
    const reversals = await stripe.transfers.listReversals(transferId, { limit: 5 });
    for (const rev of reversals.data) {
      console.log(`transfer_reversal=${rev.id} amount=${rev.amount} currency=${rev.currency}`);
    }
  }

  const tipRefund = await waitFor("tipRefund", 120000, async () =>
    prisma.tipRefund.findFirst({
      where: {
        OR: [{ stripeRefundId: refund.id }, { stripePaymentIntentId: pi.id }],
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
      `tipRefund=${suffix(tipRefund.id)} status=${tipRefund.status} amountEur=${tipRefund.amountEur} biz_match=${tipRefund.businessId === biz.id} tip_match=${tipRefund.tipId === dbTx?.id} refund_id_match=${tipRefund.stripeRefundId === refund.id} pi_match=${tipRefund.stripePaymentIntentId === pi.id} charge_match=${tipRefund.stripeChargeId === chargeId}`,
    );
  } else {
    console.log("tipRefund=NOT_RECEIVED (Render webhook charge.refunded/refund.updated)");
  }

  const refundCreatedGte = Math.max(0, Math.floor(Date.now() / 1000) - 300);
  console.log("\n=== REFUND STRIPE EVENTS ===");
  const refundRelated: string[] = [];
  for (const type of ["charge.refunded", "refund.updated"] as const) {
    const listed = await stripe.events.list({ type, created: { gte: refundCreatedGte }, limit: 20 });
    for (const ev of listed.data) {
      const obj = ev.data.object as { id?: string; payment_intent?: unknown; charge?: unknown };
      const related =
        obj.id === refund.id ||
        obj.id === chargeId ||
        asId(obj.payment_intent) === pi.id ||
        asId(obj.charge) === chargeId;
      if (!related) continue;
      refundRelated.push(ev.id);
      console.log(
        `stripe_event ${ev.id} type=${ev.type} pending_webhooks=${ev.pending_webhooks} livemode=${ev.livemode}`,
      );
    }
  }
  const refundDbEvents = refundRelated.length
    ? await prisma.stripeWebhookEvent.findMany({ where: { id: { in: refundRelated } } })
    : [];
  for (const ev of refundDbEvents) {
    console.log(`processed_refund_event ${ev.id} type=${ev.eventType} at=${ev.processedAt.toISOString()}`);
  }

  const duplicateRefunds = await prisma.tipRefund.findMany({
    where: { stripePaymentIntentId: pi.id },
    select: { id: true, stripeRefundId: true, status: true },
  });
  console.log(`tipRefund_rows_for_pi=${duplicateRefunds.length}`);

  console.log("\n=== PAYOUT OBSERVATION ===");
  const listedPayouts = await stripe.payouts.list({ limit: 10 }, { stripeAccount: marie });
  console.log(`existing_payout_objects=${listedPayouts.data.length}`);
  for (const p of listedPayouts.data) {
    console.log(
      `payout=${p.id} status=${p.status} amount=${p.amount} ${p.currency} automatic=${p.automatic === true} arrival=${p.arrival_date}`,
    );
  }
  const dbPayouts = await prisma.stripeConnectPayout.count({ where: { businessId: biz.id } });
  console.log(`caretip_payout_rows_marie=${dbPayouts}`);
  if (listedPayouts.data.length === 0) {
    console.log("PAYOUT_E2E=BLOCKED no_stripe_payout_object_yet");
    console.log(
      `waiting_for=Stripe automatic payout on schedule=${settings?.schedule?.interval ?? "(none)"} delay_days=${settings?.schedule?.delay_days ?? "(none)"} after available balance becomes payable`,
    );
  }

  const afterBiz = await prisma.business.findUnique({
    where: { id: biz.id },
    select: { stripeAccountId: true },
  });
  const after = await counts();
  const afterTx = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: pi.id },
    select: { id: true, amount: true, status: true },
  });
  const historicalStill = await prisma.transaction.findMany({
    where: {
      businessId: biz.id,
      stripePaymentIntentId: { not: null },
      NOT: { stripePaymentIntentId: pi.id },
    },
    select: { id: true, amount: true, status: true, stripePaymentIntentId: true },
  });
  console.log("\n=== COUNTS AFTER ===");
  console.log(JSON.stringify(after));
  console.log(`MARIE_ACCOUNT_UNCHANGED=${afterBiz?.stripeAccountId === marie}`);
  console.log(`controlled_tx_status=${afterTx?.status ?? "(none)"} amount=${afterTx?.amount ?? "(none)"}`);
  console.log(`historical_marie_tips_remaining=${historicalStill.length}`);
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
