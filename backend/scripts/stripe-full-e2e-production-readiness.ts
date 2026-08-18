/**
 * CareTip Stripe full production-readiness E2E (TEST/Sandbox only).
 * Never remaps Marie. Never refunds historical PIs. Never inserts fake payout rows.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { calculateTipPlatformFeeCents } from "../src/config/fees.js";
import { createTipCheckoutSession, getStripeClient } from "../src/services/stripe.service.js";
import {
  accountsV2GetRequestOptions,
  createExpressAccountOnboardingLink,
  ensureExpressConnectedAccountForBusiness,
} from "../src/services/stripeConnect.service.js";

const TEST_WEBHOOK_URL = "https://caretip.onrender.com/api/webhooks/stripe";
const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
  "refund.updated",
  "account.updated",
  "payout.created",
  "payout.updated",
  "payout.paid",
  "payout.failed",
  "payout.canceled",
  "payout.reconciliation_completed",
] as const;

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

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key.startsWith("sk_test_")) {
    console.log("ABORT LIVE_KEYS_USED");
    process.exit(1);
  }
  if (!process.env.FRONTEND_URL?.trim()) {
    process.env.FRONTEND_URL = "https://caretip.de";
    console.log("FRONTEND_URL process-only=https://caretip.de");
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
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      user: { select: { email: true } },
    },
  });
  if (!biz?.stripeAccountId || !biz.user?.email) {
    throw new Error("Marie Business not found");
  }
  const marie = biz.stripeAccountId;
  console.log("\n=== MARIE SAFETY SNAPSHOT ===");
  console.log(`business=${suffix(biz.id)} name=${biz.name} status=${biz.stripeConnectStatus}`);
  console.log(`stripeAccountId=${suffix(marie)} mapping_present=true`);
  console.log(`mirror_charges=${biz.stripeChargesEnabled} mirror_payouts=${biz.stripePayoutsEnabled}`);

  const acct = await stripe.accounts.retrieve(marie);
  console.log(`charges_enabled=${acct.charges_enabled === true}`);
  console.log(`payouts_enabled=${acct.payouts_enabled === true}`);
  console.log(`details_submitted=${acct.details_submitted === true}`);
  console.log(`type=${acct.type ?? "(none)"}`);
  console.log(`capabilities.card_payments=${acct.capabilities?.card_payments ?? "(unset)"}`);
  console.log(`capabilities.transfers=${acct.capabilities?.transfers ?? "(unset)"}`);

  const v2 = (await stripe.rawRequest(
    "GET",
    `/v2/core/accounts/${encodeURIComponent(marie)}`,
    null as unknown as { [key: string]: unknown },
    accountsV2GetRequestOptions(),
  )) as { applied_configurations?: string[]; dashboard?: string };
  console.log(`v2_dashboard=${v2.dashboard ?? "(none)"}`);
  console.log(`v2_configs=${(v2.applied_configurations ?? []).join(",") || "(none)"}`);

  const bal = await stripe.balance.retrieve({ stripeAccount: marie });
  console.log(
    `available=${bal.available.map((b) => `${b.amount} ${b.currency}`).join(",") || "0"}`,
  );
  console.log(`pending=${bal.pending.map((b) => `${b.amount} ${b.currency}`).join(",") || "0"}`);
  const settings = acct.settings?.payouts;
  console.log(
    `payout_schedule=${settings?.schedule?.interval ?? "(none)"} delay_days=${settings?.schedule?.delay_days ?? "(none)"}`,
  );
  const ext = await stripe.accounts.listExternalAccounts(marie, { object: "bank_account", limit: 5 });
  console.log(`external_bank_accounts=${ext.data.length}`);
  for (const ba of ext.data) {
    const bank = ba as { last4?: string; country?: string; currency?: string; status?: string; default_for_currency?: boolean };
    console.log(
      `bank last4=${bank.last4 ?? "(none)"} country=${bank.country ?? "(none)"} currency=${bank.currency ?? "(none)"} status=${bank.status ?? "(none)"} default=${bank.default_for_currency === true}`,
    );
  }

  console.log("\n=== WEBHOOK DESTINATION ===");
  const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
  const ep = endpoints.data.find((e) => e.url === TEST_WEBHOOK_URL);
  if (!ep) {
    console.log("TEST_WEBHOOK=NOT_FOUND");
  } else {
    const enabled = new Set(ep.enabled_events);
    const missing = REQUIRED_EVENTS.filter((ev) => !enabled.has("*") && !enabled.has(ev));
    console.log(`endpoint=${ep.id} status=${ep.status} enabled_count=${ep.enabled_events.length}`);
    console.log(`missing_required=${missing.join(",") || "(none)"}`);
    console.log(`events=${ep.enabled_events.slice().sort().join(",")}`);
  }

  console.log("\n=== CONNECT EXISTING ACCOUNT ===");
  const ensured = await ensureExpressConnectedAccountForBusiness({
    businessId: biz.id,
    managerEmail: biz.user.email,
  });
  console.log(`ensureExpress created=${ensured.created} account=${suffix(ensured.accountId)}`);
  console.log(`NEW_ACCOUNT_CREATED=${ensured.created || ensured.accountId !== marie ? "YES" : "NO"}`);
  if (ensured.created || ensured.accountId !== marie) {
    console.log("STOP: Marie account would be replaced");
    process.exit(1);
  }
  const link = await createExpressAccountOnboardingLink({
    businessId: biz.id,
    managerEmail: biz.user.email,
  });
  const linkHost = new URL(link.url).hostname;
  console.log(`account_link_host=${linkHost} account=${suffix(link.accountId)}`);
  console.log(`https=${link.url.startsWith("https://")}`);
  console.log(
    `host_allowlisted=${linkHost === "accounts.stripe.com" || linkHost === "connect.stripe.com"}`,
  );

  const employee = await prisma.employee.findFirst({
    where: { businessId: biz.id, isActive: true, isDeleted: false, activationStatus: "active" },
    select: { id: true },
  });
  if (!employee) throw new Error("No eligible Marie employee");

  const otherBiz = await prisma.business.findFirst({
    where: { id: { not: biz.id }, stripeAccountId: { not: null } },
    select: { id: true, stripeAccountId: true },
  });
  const otherEmp = otherBiz
    ? await prisma.employee.findFirst({
        where: { businessId: otherBiz.id, isActive: true, isDeleted: false },
        select: { id: true },
      })
    : null;

  console.log("\n=== TENANT ISOLATION (localhost API) ===");
  const api = "http://localhost:3001/api/payments/create-tip-session";
  async function postTip(body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
    const res = await fetch(api, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    return { status: res.status, code: json.code ?? json.message ?? "" };
  }
  const destTry = await postTip({
    employeeId: employee.id,
    businessId: biz.id,
    amount: 10,
    destination: "acct_ATTACKER",
    stripeAccountId: "acct_ATTACKER",
  });
  console.log(`client_destination=${destTry.status} ${destTry.code}`);
  const feeTry = await postTip({
    employeeId: employee.id,
    businessId: biz.id,
    amount: 10,
    application_fee_amount: 1,
  });
  console.log(`client_fee=${feeTry.status} ${feeTry.code}`);
  if (otherEmp && otherBiz) {
    const cross = await postTip({
      employeeId: otherEmp.id,
      businessId: biz.id,
      amount: 10,
    });
    console.log(`cross_employee=${cross.status} ${cross.code}`);
  } else {
    console.log("cross_employee=SKIPPED (no second business/employee)");
  }

  console.log("\n=== PAYMENT €10.00 ===");
  const expectedFee = calculateTipPlatformFeeCents(1000);
  console.log(`expected_application_fee_cents=${expectedFee}`);
  const checkout = await createTipCheckoutSession({
    employeeId: employee.id,
    businessId: biz.id,
    amount: 10,
    tipAmount: 10,
  });
  console.log(`checkout_session=${suffix(checkout.sessionId)}`);
  if (checkout.url) console.log(`checkout_host=${new URL(checkout.url).hostname}`);

  let session = await stripe.checkout.sessions.retrieve(checkout.sessionId);
  let piId = asId(session.payment_intent);
  if (!piId && checkout.url) {
    await fetch(checkout.url, { redirect: "manual" }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1500));
    session = await stripe.checkout.sessions.retrieve(checkout.sessionId);
    piId = asId(session.payment_intent);
  }
  console.log(`session.status=${session.status} payment_status=${session.payment_status} pi=${suffix(piId)}`);

  let paidPiId: string | null = null;
  if (!piId) {
    console.log("PAYMENT_E2E=BLOCKED no_payment_intent_until_hosted_checkout");
  } else {
    let pi = await stripe.paymentIntents.retrieve(piId);
    console.log(
      `pi_before_confirm status=${pi.status} amount=${pi.amount} currency=${pi.currency} fee=${pi.application_fee_amount ?? "(none)"} dest=${suffix(asId(pi.transfer_data?.destination))}`,
    );
    if (pi.status === "requires_payment_method" || pi.status === "requires_confirmation") {
      try {
        pi = await stripe.paymentIntents.confirm(piId, { payment_method: "pm_card_visa" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`pi_confirm_failed ${msg.slice(0, 240)}`);
      }
    }
    console.log(`pi_after_confirm status=${pi.status}`);
    if (pi.status !== "succeeded") {
      console.log(`PAYMENT_E2E=BLOCKED status=${pi.status}`);
    } else {
      paidPiId = pi.id;
      console.log(`THIS_E2E_PAYMENT_INTENT=${suffix(pi.id)}`);
      const dest = asId(pi.transfer_data?.destination);
      console.log(`destination_match=${dest === marie}`);
      console.log(`fee_match=${pi.application_fee_amount === expectedFee}`);
      console.log(`guest_amount_cents=${pi.amount}`);

      const chargeId = asId(pi.latest_charge);
      const charge = chargeId
        ? await stripe.charges.retrieve(chargeId, {
            expand: ["application_fee", "transfer", "balance_transaction"],
          })
        : null;
      console.log(`charge=${suffix(charge?.id)} paid=${charge?.paid === true} amount=${charge?.amount}`);
      const appFee =
        charge && typeof charge.application_fee === "object" ? charge.application_fee : null;
      const transfer = charge && typeof charge.transfer === "object" ? charge.transfer : null;
      const bt =
        charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
      console.log(`application_fee_id=${suffix(asId(appFee))} amount=${appFee && "amount" in appFee ? appFee.amount : "(none)"}`);
      console.log(`transfer_id=${suffix(asId(transfer) ?? asId(charge?.transfer))} amount=${transfer && "amount" in transfer ? transfer.amount : "(none)"}`);
      console.log(`stripe_processing_fee=${bt && "fee" in bt ? bt.fee : "(none)"}`);

      const tx = await waitFor("ledger", 90000, async () =>
        prisma.transaction.findUnique({
          where: { stripePaymentIntentId: pi.id },
          select: { id: true, status: true, amount: true, businessId: true, employeeId: true },
        }),
      );
      if (tx) {
        console.log(
          `transaction=${suffix(tx.id)} status=${tx.status} amount=${tx.amount} biz_match=${tx.businessId === biz.id} emp_match=${tx.employeeId === employee.id}`,
        );
      } else {
        console.log("ledger=NOT_RECEIVED (Render webhook)");
      }
    }
  }

  if (paidPiId) {
    console.log("\n=== REFUND THIS_E2E_PAYMENT ONLY ===");
    console.log(`refund_target_pi=${suffix(paidPiId)}`);
    const refund = await stripe.refunds.create(
      {
        payment_intent: paidPiId,
        refund_application_fee: true,
        reverse_transfer: true,
        metadata: { caretip_refund_reason: "full_e2e_audit" },
      },
      { idempotencyKey: `full_e2e_refund:${paidPiId}` },
    );
    console.log(`refund=${suffix(refund.id)} status=${refund.status} amount=${refund.amount}`);
    const replay = await stripe.refunds.create(
      {
        payment_intent: paidPiId,
        refund_application_fee: true,
        reverse_transfer: true,
        metadata: { caretip_refund_reason: "full_e2e_audit" },
      },
      { idempotencyKey: `full_e2e_refund:${paidPiId}` },
    );
    console.log(`refund_idempotent=${replay.id === refund.id}`);
    const piAfter = await stripe.paymentIntents.retrieve(paidPiId);
    console.log(`pi_after=${piAfter.status}`);
    const chargeId = asId(piAfter.latest_charge);
    if (chargeId) {
      const ch = await stripe.charges.retrieve(chargeId);
      console.log(`charge_refunded=${ch.refunded === true} amount_refunded=${ch.amount_refunded}`);
    }
    const tipRefund = await waitFor("tipRefund", 90000, async () =>
      prisma.tipRefund.findFirst({
        where: { stripeRefundId: refund.id },
        select: { id: true, status: true, amountEur: true, businessId: true },
      }),
    );
    if (tipRefund) {
      console.log(
        `tipRefund=${suffix(tipRefund.id)} status=${tipRefund.status} amountEur=${tipRefund.amountEur} biz_match=${tipRefund.businessId === biz.id}`,
      );
    } else {
      console.log("tipRefund=NOT_RECEIVED (Render webhook charge.refunded/refund.updated)");
    }
  } else {
    console.log("\n=== REFUND ===");
    console.log("REFUND_E2E=BLOCKED no_new_captured_payment");
  }

  console.log("\n=== PAYOUT OBSERVATION ===");
  const listed = await stripe.payouts.list({ limit: 10 }, { stripeAccount: marie });
  console.log(`existing_payout_objects=${listed.data.length}`);
  const availEur = bal.available.find((b) => b.currency === "eur")?.amount ?? 0;
  console.log(`available_eur_cents=${availEur}`);
  if (listed.data.length > 0) {
    for (const p of listed.data) {
      console.log(
        `payout=${suffix(p.id)} status=${p.status} amount=${p.amount} ${p.currency} automatic=${p.automatic === true}`,
      );
    }
  } else if (availEur >= 100) {
    console.log("TEST_MECHANISM=stripe.payouts.create on connected account (not CareTip production path)");
    try {
      const payout = await stripe.payouts.create(
        { amount: 100, currency: "eur", metadata: { caretip_e2e: "full_audit" } },
        { stripeAccount: marie },
      );
      console.log(`created_payout=${suffix(payout.id)} status=${payout.status} amount=${payout.amount}`);
      const dbPayout = await waitFor("stripeConnectPayout", 90000, async () =>
        prisma.stripeConnectPayout.findFirst({
          where: { stripePayoutId: payout.id },
          select: { id: true, status: true, businessId: true, amountCents: true },
        }),
      );
      if (dbPayout) {
        console.log(
          `db_payout=${suffix(dbPayout.id)} status=${dbPayout.status} cents=${dbPayout.amountCents} biz_match=${dbPayout.businessId === biz.id}`,
        );
      } else {
        console.log("db_payout=NOT_RECEIVED (Render webhook payout.*)");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`PAYOUT_E2E=BLOCKED create_failed ${msg.slice(0, 240)}`);
    }
  } else {
    console.log("PAYOUT_E2E=BLOCKED available_balance_insufficient_and_no_payout_objects");
  }
  console.log("PAYOUT_FAILURE_E2E=BLOCKED would_require_changing_Marie_external_account");

  const afterBiz = await prisma.business.findUnique({
    where: { id: biz.id },
    select: { stripeAccountId: true },
  });
  const after = await counts();
  console.log("\n=== COUNTS AFTER ===");
  console.log(JSON.stringify(after));
  console.log(`MARIE_ACCOUNT_UNCHANGED=${afterBiz?.stripeAccountId === marie}`);
  console.log(`LIVE_KEYS_USED=NO`);
}

void main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
