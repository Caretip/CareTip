/**
 * Controlled Marie Testerin remediation E2E.
 * Reuses Marie's existing Business + Stripe account. Does not create accounts or payouts.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import { calculateTipPlatformFeeCents } from "../src/config/fees.js";
import { createTipCheckoutSession, getStripeClient } from "../src/services/stripe.service.js";
import {
  accountsV2GetRequestOptions,
  createExpressAccountOnboardingLink,
  ensureExpressConnectedAccountForBusiness,
} from "../src/services/stripeConnect.service.js";
function isAllowedConnectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "accounts.stripe.com" || parsed.hostname === "connect.stripe.com")
    );
  } catch {
    return false;
  }
}

const REQUIRED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
  "refund.updated",
  "charge.dispute.created",
  "charge.dispute.closed",
  "charge.dispute.updated",
  "account.updated",
  "payout.created",
  "payout.updated",
  "payout.paid",
  "payout.failed",
  "payout.canceled",
  "payout.reconciliation_completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
] as const;

const TEST_ENDPOINT_URL = "https://caretip.onrender.com/api/webhooks/stripe";

function suffix(id: string | null | undefined): string {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 8 ? "(short)" : `…${s.slice(-8)}`;
}

type Counts = {
  businesses: number;
  transactions: number;
  payouts: number;
  payoutLines: number;
  webhooks: number;
  tipRefunds: number;
};

async function counts(): Promise<Counts> {
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

async function findMarieBusiness() {
  const biz = await prisma.business.findFirst({
    where: { name: { contains: "Phase26", mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      stripeAccountId: true,
      stripeConnectStatus: true,
      user: { select: { email: true } },
    },
  });
  if (!biz?.stripeAccountId || !biz.user?.email) {
    throw new Error("Marie Phase26 Business not found or missing stripeAccountId/manager email");
  }
  return biz;
}

async function waitForTx(piId: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await prisma.transaction.findUnique({
      where: { stripePaymentIntentId: piId },
      select: { id: true, status: true, amount: true, businessId: true, employeeId: true },
    });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key.startsWith("sk_test_")) {
    console.log("ABORT: STRIPE_SECRET_KEY is not TEST mode");
    process.exit(1);
  }
  if (!process.env.FRONTEND_URL?.trim()) {
    process.env.FRONTEND_URL = "https://caretip.de";
    console.log("FRONTEND_URL unset locally; using https://caretip.de for this process only");
  }

  const stripe = getStripeClient();
  const before = await counts();
  const biz = await findMarieBusiness();
  const marieAcctBefore = biz.stripeAccountId!;
  console.log("=== BEFORE ===");
  console.log(JSON.stringify({ ...before, marieBiz: suffix(biz.id), marieAcct: suffix(marieAcctBefore) }));

  const v2Before = (await stripe.rawRequest(
    "GET",
    `/v2/core/accounts/${encodeURIComponent(marieAcctBefore)}`,
    null,
    { apiVersion: "2026-07-29.dahlia" },
  )) as { id?: string; applied_configurations?: string[] };
  const configsBefore = (v2Before.applied_configurations ?? []).slice().sort();
  console.log(`v2_configs_before=${configsBefore.join(",") || "(none)"}`);
  try {
    const probe = (await stripe.rawRequest(
      "GET",
      `/v2/core/accounts/${encodeURIComponent(marieAcctBefore)}`,
      null as unknown as { [key: string]: unknown },
      accountsV2GetRequestOptions(),
    )) as { applied_configurations?: string[] };
    console.log(`v2_get_options_probe_configs=${(probe.applied_configurations ?? []).join(",") || "(none)"}`);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "error";
    const status = err && typeof err === "object" && "statusCode" in err ? String((err as { statusCode?: unknown }).statusCode) : "";
    console.log(`v2_get_options_probe_failed code=${code} status=${status}`);
  }

  console.log("\n=== PHASE E ACCOUNT LINK (existing Marie account) ===");
  const ensured = await ensureExpressConnectedAccountForBusiness({
    businessId: biz.id,
    managerEmail: biz.user!.email,
  });
  console.log(`ensureExpress created=${ensured.created} account=${suffix(ensured.accountId)}`);
  if (ensured.created || ensured.accountId !== marieAcctBefore) {
    console.log("STOP: ensureExpress created or remapped Marie's account");
    process.exit(1);
  }
  const link = await createExpressAccountOnboardingLink({
    businessId: biz.id,
    managerEmail: biz.user!.email,
  });
  const linkHost = new URL(link.url).hostname;
  const linkAllowed = isAllowedConnectUrl(link.url);
  console.log(`account_link_account=${suffix(link.accountId)}`);
  console.log(`account_link_host=${linkHost}`);
  console.log(`account_link_allowed=${linkAllowed}`);
  console.log(`account_link_v2=${linkHost === "accounts.stripe.com"}`);
  console.log(`account_link_v1_fallback=${linkHost === "connect.stripe.com"}`);
  const bizAfterLink = await prisma.business.findUnique({
    where: { id: biz.id },
    select: { stripeAccountId: true },
  });
  console.log(`marie_account_unchanged_after_link=${bizAfterLink?.stripeAccountId === marieAcctBefore}`);

  const employee = await prisma.employee.findFirst({
    where: {
      businessId: biz.id,
      isActive: true,
      isDeleted: false,
      activationStatus: "active",
    },
    select: { id: true, name: true },
  });
  if (!employee) {
    console.log("STOP: no eligible employee on Marie Business");
    process.exit(1);
  }

  console.log("\n=== PHASE C PAYMENT €1.00 ===");
  const expectedFee = calculateTipPlatformFeeCents(100);
  console.log(`expected_application_fee_cents=${expectedFee}`);
  const reuseSessionId = process.env.MARIE_CHECKOUT_SESSION_ID?.trim() || "";
  const checkout = reuseSessionId
    ? { sessionId: reuseSessionId, url: null as string | null }
    : await createTipCheckoutSession({
        employeeId: employee.id,
        businessId: biz.id,
        amount: 1,
        tipAmount: 1,
      });
  console.log(`checkout_session_present=${Boolean(checkout.sessionId)} reused=${Boolean(reuseSessionId)}`);
  const session = await stripe.checkout.sessions.retrieve(checkout.sessionId, {
    expand: ["payment_intent"],
  });
  console.log(
    `session.status=${session.status} mode=${session.mode} payment_status=${session.payment_status} url_host=${session.url ? new URL(session.url).hostname : "(none)"}`,
  );
  let piId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  if (!piId) {
    await new Promise((r) => setTimeout(r, 2000));
    const again = await stripe.checkout.sessions.retrieve(checkout.sessionId);
    piId = typeof again.payment_intent === "string" ? again.payment_intent : null;
  }
  if (!piId) {
    console.log("PAYMENT_E2E = BLOCKED (Checkout session has no PaymentIntent yet; hosted page not completed)");
  } else {
  let pi = await stripe.paymentIntents.retrieve(piId);
  if (pi.status === "requires_payment_method" || pi.status === "requires_confirmation") {
    pi = await stripe.paymentIntents.confirm(piId, {
      payment_method: "pm_card_visa",
    });
  }
  console.log(`payment_intent=${suffix(pi.id)} status=${pi.status}`);
  console.log(`application_fee_amount=${pi.application_fee_amount ?? "(none)"}`);
  const dest =
    typeof pi.transfer_data?.destination === "string"
      ? pi.transfer_data.destination
      : pi.transfer_data?.destination?.id;
  console.log(`destination=${suffix(dest)} match=${dest === marieAcctBefore}`);

  if (pi.status !== "succeeded") {
    console.log(`PAYMENT_E2E=BLOCKED status=${pi.status}`);
  } else {
    const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
    let charge: Stripe.Charge | null = null;
    if (chargeId) {
      charge = await stripe.charges.retrieve(chargeId, { expand: ["application_fee", "transfer", "balance_transaction"] });
    }
    const appFee =
      charge && typeof charge.application_fee === "object" && charge.application_fee
        ? charge.application_fee
        : null;
    const transfer =
      charge && typeof charge.transfer === "object" && charge.transfer ? charge.transfer : null;
    const stripeFee =
      charge &&
      typeof charge.balance_transaction === "object" &&
      charge.balance_transaction &&
      "fee" in charge.balance_transaction
        ? charge.balance_transaction.fee
        : null;
    console.log(`charge=${suffix(charge?.id)} paid=${charge?.paid === true}`);
    console.log(`application_fee_id=${suffix(appFee && "id" in appFee ? String(appFee.id) : null)}`);
    console.log(`application_fee_amount_obj=${appFee && "amount" in appFee ? appFee.amount : "(none)"}`);
    console.log(`transfer_id=${suffix(transfer && "id" in transfer ? String(transfer.id) : typeof charge?.transfer === "string" ? charge.transfer : null)}`);
    console.log(`transfer_amount=${transfer && "amount" in transfer ? transfer.amount : "(none)"}`);
    console.log(`stripe_processing_fee_cents=${stripeFee ?? "(none)"}`);

    const tx = await waitForTx(pi.id, 90000);
    if (!tx) {
      console.log("ledger=NOT_YET (Render webhook may still be pending)");
    } else {
      console.log(
        `transaction=${suffix(tx.id)} status=${tx.status} amount=${tx.amount} biz_match=${tx.businessId === biz.id} emp_match=${tx.employeeId === employee.id}`,
      );
    }

    console.log("\n=== PHASE D REFUND (this PaymentIntent only) ===");
    const refund = await stripe.refunds.create(
      {
        payment_intent: pi.id,
        refund_application_fee: true,
        reverse_transfer: true,
        metadata: { caretip_refund_reason: "marie_remediation_e2e" },
      },
      { idempotencyKey: `marie_remediation_refund:${pi.id}` },
    );
    console.log(`refund=${suffix(refund.id)} status=${refund.status} amount=${refund.amount}`);
    const replay = await stripe.refunds.create(
      {
        payment_intent: pi.id,
        refund_application_fee: true,
        reverse_transfer: true,
        metadata: { caretip_refund_reason: "marie_remediation_e2e" },
      },
      { idempotencyKey: `marie_remediation_refund:${pi.id}` },
    );
    console.log(`refund_idempotent=${replay.id === refund.id}`);
    const piAfter = await stripe.paymentIntents.retrieve(pi.id);
    console.log(`pi_after_refund_status=${piAfter.status}`);
    if (chargeId) {
      const chargeAfter = await stripe.charges.retrieve(chargeId, { expand: ["refunds"] });
      console.log(`charge_refunded=${chargeAfter.refunded === true} amount_refunded=${chargeAfter.amount_refunded}`);
    }
  }
  }

  console.log("\n=== PHASE F PAYOUT ===");
  const payouts = await stripe.payouts.list({ limit: 5 }, { stripeAccount: marieAcctBefore });
  if (payouts.data.length === 0) {
    console.log("PAYOUT_E2E = BLOCKED (no Stripe payout object)");
  } else {
    for (const p of payouts.data) {
      console.log(`payout=${suffix(p.id)} status=${p.status} amount=${p.amount} ${p.currency} automatic=${p.automatic === true}`);
    }
  }

  console.log("\n=== WEBHOOK ENDPOINT ===");
  const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
  const destEp = endpoints.data.find((e) => e.url === TEST_ENDPOINT_URL);
  if (!destEp) {
    console.log("DASHBOARD_CHANGE_REQUIRED = YES");
    console.log(`existing_endpoint_for_render=NOT_FOUND count=${endpoints.data.length}`);
    console.log(`required_events=${REQUIRED_WEBHOOK_EVENTS.join(",")}`);
  } else {
    const current = new Set(destEp.enabled_events);
    const missing = REQUIRED_WEBHOOK_EVENTS.filter((ev) => !current.has("*") && !current.has(ev));
    console.log(`endpoint=${destEp.id} status=${destEp.status} url=${destEp.url}`);
    console.log(`enabled_count=${destEp.enabled_events.length} missing=${missing.join(",") || "(none)"}`);
    if (missing.length > 0) {
      const merged = [...new Set([...destEp.enabled_events, ...REQUIRED_WEBHOOK_EVENTS])];
      try {
        const updated = await stripe.webhookEndpoints.update(destEp.id, { enabled_events: merged });
        const afterSet = new Set(updated.enabled_events);
        const stillMissing = REQUIRED_WEBHOOK_EVENTS.filter((ev) => !afterSet.has("*") && !afterSet.has(ev));
        console.log(`webhook_update=OK still_missing=${stillMissing.join(",") || "(none)"}`);
        console.log(`DASHBOARD_CHANGE_REQUIRED = ${stillMissing.length > 0 ? "YES" : "NO"}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`webhook_update=FAILED ${msg.slice(0, 200)}`);
        console.log("DASHBOARD_CHANGE_REQUIRED = YES");
        console.log(`required_events=${REQUIRED_WEBHOOK_EVENTS.join(",")}`);
      }
    } else {
      console.log("DASHBOARD_CHANGE_REQUIRED = NO");
    }
  }

  const after = await counts();
  const bizAfter = await prisma.business.findUnique({
    where: { id: biz.id },
    select: { stripeAccountId: true, name: true },
  });
  console.log("\n=== AFTER ===");
  console.log(JSON.stringify({ ...after, marieBiz: suffix(biz.id), marieAcct: suffix(bizAfter?.stripeAccountId) }));
  console.log(`MARIE_ACCOUNT_UNCHANGED=${bizAfter?.stripeAccountId === marieAcctBefore}`);
  console.log(`BUSINESS_COUNT_UNCHANGED=${after.businesses === before.businesses}`);
  console.log(`PAYOUT_ROWS_UNCHANGED=${after.payouts === before.payouts}`);
}

void main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
