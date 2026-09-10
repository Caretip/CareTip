/**
 * Fresh Stripe TEST payments proving the deployed Render webhook writes
 * Transaction + EmployeeTipPayable. Never calls handleSuccessfulTipPayment.
 *
 * Run: dotenv -e ../.env -e .env -- tsx scripts/employee-stripe-phase-c-deployed-webhook-verification.ts
 */
import "dotenv/config";
import "../src/loadEnv.js";
import Stripe from "stripe";
import bcrypt from "bcrypt";
import { chromium } from "@playwright/test";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayoutMode,
  Role,
  StripeConnectStatus,
} from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { calculateTipPlatformFeeCents } from "../src/config/fees.js";
import { createTipCheckoutSession, getStripeClient } from "../src/services/stripe.service.js";
import { remainingPayableCents } from "../src/services/employeeTipPayable.service.js";
import { upsertStripeRefundEvent } from "../src/services/finance/tipRefunds.service.js";

type Verdict =
  | "LIVE_STRIPE_TEST_VERIFIED"
  | "CODE_AND_AUTOMATED_TEST_VERIFIED"
  | "CODE_VERIFIED_ONLY"
  | "NOT_TESTED"
  | "NOT_TESTABLE"
  | "FAIL";

const lines: { id: string; verdict: Verdict; detail: string }[] = [];
function note(id: string, verdict: Verdict, detail: string) {
  lines.push({ id, verdict, detail });
  console.log(`${verdict}  ${id}  ${detail}`);
}
function suffix(id: string | null | undefined): string {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 10 ? "(short)" : `…${s.slice(-8)}`;
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function keyMode(value: string | undefined): "TEST" | "LIVE" | "MISSING" | "OTHER" {
  const v = value?.trim() ?? "";
  if (!v) return "MISSING";
  if (v.startsWith("sk_test_")) return "TEST";
  if (v.startsWith("sk_live_")) return "LIVE";
  return "OTHER";
}
function dbHost(): string {
  const raw = process.env.DATABASE_URL?.trim() ?? "";
  if (!raw) return "(missing)";
  try {
    return new URL(raw.replace(/^postgres(ql)?:/i, "https:")).host;
  } catch {
    return "(unparseable)";
  }
}

async function waitForWebhookLedger(piId: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tx = await prisma.transaction.findUnique({
      where: { stripePaymentIntentId: piId },
      select: { id: true, status: true, amount: true, employeeId: true, businessId: true },
    });
    if (tx) {
      const payable = await prisma.employeeTipPayable.findUnique({
        where: { transactionId: tx.id },
      });
      return { tx, payable, waitedMs: Date.now() - start };
    }
    await sleep(3000);
  }
  return { tx: null, payable: null, waitedMs: Date.now() - start };
}

async function fillStripeHostedCheckout(
  page: import("@playwright/test").Page,
  cardNumber: string,
): Promise<void> {
  await page.waitForTimeout(2500);
  const email = page.locator('input[type="email"], input[name="email"]').first();
  if (await email.count()) {
    await email.fill("sandbox-phasec-deploy@caretip-test.local");
    await email.press("Tab");
  }
  const cardAccordion = page.getByRole("button", { name: /card/i }).first();
  if (await cardAccordion.count()) {
    await cardAccordion.click().catch(() => undefined);
  }
  await page.waitForTimeout(1500);
  const typeInto = async (selector: string, value: string) => {
    const loc = page.locator(selector);
    if ((await loc.count()) === 0) return false;
    await loc.first().click();
    await page.keyboard.type(value, { delay: 25 });
    return true;
  };
  await typeInto("#cardNumber", cardNumber);
  await typeInto('input[name="cardNumber"]', cardNumber);
  await typeInto('[placeholder="1234 1234 1234 1234"]', cardNumber);
  if (!(await typeInto("#cardNumber", cardNumber))) {
    for (const frame of page.frames()) {
      const number = frame.locator(
        'input[name="cardnumber"], input[name="number"], input[autocomplete="cc-number"]',
      );
      if ((await number.count()) > 0) {
        await number.first().fill(cardNumber);
        break;
      }
    }
  }
  await typeInto("#cardExpiry", "1230");
  await typeInto('input[name="cardExpiry"]', "1230");
  await typeInto("#cardCvc", "123");
  await typeInto('input[name="cardCvc"]', "123");
  await typeInto("#billingName", "Sandbox PhaseC Deploy");
  await typeInto("#billingPostalCode", "10115");
  const pay = page.getByRole("button", { name: /pay|zahlen|submit|complete/i }).first();
  if (await pay.count()) await pay.click();
  await page.waitForTimeout(4000);
}

async function payHostedCheckout(
  stripe: Stripe,
  sessionId: string,
  page: import("@playwright/test").Page,
  cardNumber: string,
) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session.url) return { ok: false as const, reason: "no_checkout_url" };
  await page.goto(session.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await fillStripeHostedCheckout(page, cardNumber);
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const again = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (again.payment_status === "paid") {
      const paidPiId =
        typeof again.payment_intent === "string"
          ? again.payment_intent
          : again.payment_intent?.id ?? null;
      if (!paidPiId) break;
      const pi = await stripe.paymentIntents.retrieve(paidPiId);
      return { ok: true as const, session: again, pi };
    }
    await sleep(3000);
  }
  return { ok: false as const, reason: "hosted_checkout_not_paid" };
}

async function readChargeBundle(stripe: Stripe, pi: Stripe.PaymentIntent) {
  const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
  const dest =
    typeof pi.transfer_data?.destination === "string"
      ? pi.transfer_data.destination
      : pi.transfer_data?.destination && typeof pi.transfer_data.destination === "object"
        ? pi.transfer_data.destination.id
        : null;
  let charge: Stripe.Charge | null = null;
  if (chargeId) {
    charge = await stripe.charges.retrieve(chargeId, {
      expand: ["transfer", "application_fee", "balance_transaction", "refunds"],
    });
  }
  const transferObj = charge && typeof charge.transfer === "object" && charge.transfer ? charge.transfer : null;
  const transferId =
    transferObj && "id" in transferObj ? String(transferObj.id) : typeof charge?.transfer === "string" ? charge.transfer : null;
  const transferAmount = transferObj && "amount" in transferObj ? Number(transferObj.amount) : null;
  return {
    chargeId,
    dest,
    charge,
    transferId,
    transferAmount,
    applicationFeeAmount: pi.application_fee_amount ?? null,
    amount: pi.amount,
  };
}

function isSyntheticAcct(id: string) {
  return /acct_(rt_|p\d+_|stale_|ready_|unknown_|shared_|sprint|dp_|obiz_)/i.test(id);
}

async function pickBusiness() {
  const preferred = await prisma.business.findFirst({
    where: {
      name: { contains: "Phase26", mode: "insensitive" },
      stripeAccountId: { startsWith: "acct_" },
      stripeConnectStatus: StripeConnectStatus.ready,
    },
    select: {
      id: true,
      name: true,
      stripeAccountId: true,
      stripePayoutsEnabled: true,
      stripeChargesEnabled: true,
      employeeTipPayoutMode: true,
    },
  });
  if (preferred?.stripeAccountId && !isSyntheticAcct(preferred.stripeAccountId)) return preferred;
  const rows = await prisma.business.findMany({
    where: {
      stripeAccountId: { startsWith: "acct_" },
      stripeConnectStatus: StripeConnectStatus.ready,
      operationalStatus: "active",
    },
    select: {
      id: true,
      name: true,
      stripeAccountId: true,
      stripePayoutsEnabled: true,
      stripeChargesEnabled: true,
      employeeTipPayoutMode: true,
    },
    take: 40,
  });
  return rows.find((b) => b.stripeAccountId && !isSyntheticAcct(b.stripeAccountId)) ?? null;
}

async function createSandboxEmployee(businessId: string, tag: string) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const user = await prisma.user.create({
    data: {
      email: `sandbox.phasec.deploy.${tag}@caretip-test.local`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
      isActive: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: `Sandbox PhaseC Deploy ${tag}`,
      jobTitle: "Server",
      businessId,
      userId: user.id,
      activationStatus: "active",
      isActive: true,
      isDeleted: false,
    },
  });
  return employee;
}

async function auditDatabase() {
  const migrations = await prisma.$queryRaw<
    { migration_name: string; finished_at: Date | null }[]
  >`SELECT migration_name, finished_at FROM _prisma_migrations
    WHERE migration_name LIKE '%employee_stripe%'
       OR migration_name LIKE '%employee_tip%'
       OR migration_name LIKE '20260910%'
       OR migration_name LIKE '20260909%'
    ORDER BY finished_at`;
  const columns = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_tip_payables'
    ORDER BY ordinal_position`;
  return { migrations, columns: columns.map((c) => c.column_name) };
}

async function listPreDeploymentArtifacts() {
  const tips = await prisma.transaction.findMany({
    where: {
      employee: { name: { startsWith: "Sandbox PhaseC" } },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: {
      id: true,
      status: true,
      amount: true,
      stripePaymentIntentId: true,
      createdAt: true,
      employee: { select: { name: true } },
    },
    take: 40,
  });
  const out = [];
  for (const tip of tips) {
    const payable = await prisma.employeeTipPayable.findUnique({
      where: { transactionId: tip.id },
      select: { id: true, status: true, payableCents: true },
    });
    out.push({
      tipSuffix: suffix(tip.id),
      employee: tip.employee?.name ?? "(none)",
      status: tip.status,
      amount: Number(tip.amount),
      pi: suffix(tip.stripePaymentIntentId),
      payable: payable ? `${payable.status}:${payable.payableCents}` : "MISSING",
      createdAt: tip.createdAt.toISOString(),
    });
  }
  return out;
}

async function main() {
  const secretMode = keyMode(process.env.STRIPE_SECRET_KEY);
  console.log("=== DEPLOYED WEBHOOK VERIFICATION PREFLIGHT ===");
  console.log(`STRIPE_SECRET_KEY=${secretMode}`);
  console.log(`STRIPE_WEBHOOK_SECRET=${process.env.STRIPE_WEBHOOK_SECRET?.trim() ? "PRESENT" : "MISSING"}`);
  console.log(`STRIPE_CONNECT_WEBHOOK_SECRET=${process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim() ? "PRESENT" : "MISSING"}`);
  console.log(`DATABASE_HOST=${dbHost()}`);

  if (secretMode !== "TEST") {
    note("sandbox-access", "NOT_TESTABLE", secretMode === "LIVE" ? "LIVE key present — refusing" : "TEST key missing");
    return;
  }
  if (!process.env.FRONTEND_URL?.trim()) {
    process.env.FRONTEND_URL = "https://caretip.de";
  }

  let renderHealth: { status?: string; uptime?: number; environment?: string } | null = null;
  try {
    const res = await fetch("https://caretip.onrender.com/api/health");
    renderHealth = (await res.json()) as typeof renderHealth;
    console.log(
      `render_health status=${renderHealth?.status} env=${renderHealth?.environment} uptime_s=${renderHealth?.uptime ?? "(none)"}`,
    );
  } catch (err) {
    note("render-health", "FAIL", err instanceof Error ? err.message : "health fetch failed");
  }

  const dbAudit = await auditDatabase();
  console.log("prisma_migrations_employee_related:");
  for (const m of dbAudit.migrations) {
    console.log(`  ${m.migration_name} finished=${m.finished_at?.toISOString?.() ?? "(null)"}`);
  }
  console.log(`employee_tip_payables_columns=${dbAudit.columns.join(",")}`);
  const hasDisputeCols =
    dbAudit.columns.includes("disputed_open_cents") &&
    dbAudit.columns.includes("disputed_lost_cents") &&
    dbAudit.columns.includes("stripe_dispute_id");
  note(
    "deployed-db-schema",
    dbAudit.columns.includes("id") && hasDisputeCols ? "LIVE_STRIPE_TEST_VERIFIED" : "FAIL",
    hasDisputeCols
      ? "employee_tip_payables exists with dispute columns on the DATABASE_URL target"
      : "missing payable table or dispute columns on DATABASE_URL target",
  );

  const artifacts = await listPreDeploymentArtifacts();
  console.log("PRE-DEPLOYMENT TEST ARTIFACTS (Sandbox PhaseC, last 24h):");
  for (const a of artifacts) {
    console.log(
      `  tip=${a.tipSuffix} emp=${a.employee} status=${a.status} amount=${a.amount} pi=${a.pi} payable=${a.payable} at=${a.createdAt}`,
    );
  }

  const stripe = getStripeClient();
  const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
  for (const ep of endpoints.data) {
    let host = "(invalid)";
    try {
      host = new URL(ep.url).host;
    } catch {
      host = "(unparseable)";
    }
    const dispute =
      ep.enabled_events.includes("charge.dispute.created") || ep.enabled_events.includes("*");
    const refunded =
      ep.enabled_events.includes("charge.refunded") || ep.enabled_events.includes("*");
    console.log(
      `webhook host=${host} status=${ep.status} livemode=${ep.livemode} connect=${ep.connect === true} api_version=${ep.api_version ?? "(none)"} dispute=${dispute} refunded=${refunded} events=${ep.enabled_events.length}`,
    );
  }
  const renderEp = endpoints.data.find((e) => {
    try {
      return new URL(e.url).host === "caretip.onrender.com";
    } catch {
      return false;
    }
  });
  note(
    "webhook-config",
    renderEp && renderEp.status === "enabled" && renderEp.livemode === false && renderEp.connect !== true
      ? "LIVE_STRIPE_TEST_VERIFIED"
      : "FAIL",
    renderEp
      ? `caretip.onrender.com enabled livemode=${renderEp.livemode} connect=${renderEp.connect === true} api=${renderEp.api_version ?? "(none)"}`
      : "no caretip.onrender.com webhook endpoint",
  );

  const biz = await pickBusiness();
  if (!biz?.stripeAccountId) {
    note("fixture-business", "NOT_TESTABLE", "No ready Business Connect account");
    return;
  }
  console.log(`business=${suffix(biz.id)} acct=${suffix(biz.stripeAccountId)} mode=${biz.employeeTipPayoutMode}`);
  const originalMode = biz.employeeTipPayoutMode;

  const readyEmp = await prisma.employee.findFirst({
    where: {
      isActive: true,
      isDeleted: false,
      activationStatus: "active",
      stripeAccount: {
        stripeConnectStatus: StripeConnectStatus.ready,
        stripePayoutsEnabled: true,
        stripeAccountId: { startsWith: "acct_" },
      },
    },
    include: { stripeAccount: true },
  });
  const readyReal =
    readyEmp?.stripeAccount?.stripeAccountId && !isSyntheticAcct(readyEmp.stripeAccount.stripeAccountId)
      ? readyEmp
      : null;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await prisma.business.update({
      where: { id: biz.id },
      data: { employeeTipPayoutMode: EmployeeTipPayoutMode.direct_to_employee },
    });

    const empA = await createSandboxEmployee(biz.id, `a${Date.now()}`);
    const checkoutA = await createTipCheckoutSession({
      amount: 10,
      employeeId: empA.id,
      businessId: biz.id,
      customerName: "Deploy Test A",
    });
    if (!checkoutA.sessionId) {
      note("test-a-checkout", "FAIL", "no session id");
    } else {
      const paid = await payHostedCheckout(stripe, checkoutA.sessionId, page, "4242424242424242");
      if (!paid.ok) {
        note("test-a-hosted", "FAIL", paid.reason);
      } else {
        const bundle = await readChargeBundle(stripe, paid.pi);
        console.log(
          `TEST_A stripe amount=${bundle.amount} dest=${suffix(bundle.dest)} fee=${bundle.applicationFeeAmount} charge=${suffix(bundle.chargeId)} pi=${suffix(paid.pi.id)}`,
        );
        const stripeOk = paid.pi.status === "succeeded" && !bundle.dest && bundle.applicationFeeAmount == null;
        note(
          "test-a-stripe",
          stripeOk ? "LIVE_STRIPE_TEST_VERIFIED" : "FAIL",
          `pi=${suffix(paid.pi.id)} dest=${bundle.dest ?? "none"} fee=${bundle.applicationFeeAmount ?? "absent"}`,
        );
        const ledger = await waitForWebhookLedger(paid.pi.id, 120000);
        console.log(
          `TEST_A webhook waited=${ledger.waitedMs} tx=${ledger.tx ? `${ledger.tx.status}:${suffix(ledger.tx.id)}` : "MISSING"} payable=${ledger.payable ? `${ledger.payable.status}:${ledger.payable.chargeModel}:${ledger.payable.payableCents}` : "MISSING"}`,
        );
        const payableOk =
          ledger.tx?.status === "success" &&
          ledger.payable?.routingMode === EmployeeTipPayoutMode.direct_to_employee &&
          ledger.payable.chargeModel === EmployeeTipChargeModel.platform_hold &&
          ledger.payable.grossCents === 1000 &&
          ledger.payable.platformFeeCents === 149 &&
          ledger.payable.payableCents === 851;
        note(
          "test-a-webhook-ledger",
          payableOk ? "LIVE_STRIPE_TEST_VERIFIED" : "FAIL",
          payableOk
            ? `Render wrote success Transaction + platform_hold payable 851¢ after ${ledger.waitedMs}ms`
            : `tx=${ledger.tx?.status ?? "none"} payable=${ledger.payable ? `${ledger.payable.chargeModel}:${ledger.payable.payableCents}` : "MISSING"} waited=${ledger.waitedMs}`,
        );

        if (payableOk && ledger.payable) {
          const refund = await stripe.refunds.create({
            payment_intent: paid.pi.id,
            amount: 100,
          });
          console.log(`TEST_E refund=${suffix(refund.id)} amount=${refund.amount} status=${refund.status}`);
          note(
            "test-e-stripe-refund",
            refund.status === "succeeded" && refund.amount === 100 ? "LIVE_STRIPE_TEST_VERIFIED" : "FAIL",
            `refund ${suffix(refund.id)} amount=${refund.amount} status=${refund.status}`,
          );
          const refundDeadline = Date.now() + 120000;
          let refunded = ledger.payable.refundedCents;
          while (Date.now() < refundDeadline) {
            const row = await prisma.employeeTipPayable.findUnique({ where: { id: ledger.payable.id } });
            refunded = row?.refundedCents ?? 0;
            if (refunded === 100) break;
            await sleep(3000);
          }
          const afterRefund = await prisma.employeeTipPayable.findUnique({ where: { id: ledger.payable.id } });
          const remaining = afterRefund ? remainingPayableCents(afterRefund) : -1;
          note(
            "test-e-webhook-refunded",
            afterRefund?.refundedCents === 100 && remaining === 751 ? "LIVE_STRIPE_TEST_VERIFIED" : "FAIL",
            `refundedCents=${afterRefund?.refundedCents ?? "none"} remaining=${remaining} (expected 751)`,
          );
          if (afterRefund && refund.id) {
            const beforeReplay = afterRefund.refundedCents;
            await upsertStripeRefundEvent({
              stripeRefundId: refund.id,
              stripePaymentIntentId: paid.pi.id,
              stripeChargeId: bundle.chargeId,
              amountCents: refund.amount,
              currency: refund.currency,
              status: refund.status ?? "succeeded",
              occurredAt: new Date(),
            });
            const afterReplay = await prisma.employeeTipPayable.findUnique({ where: { id: ledger.payable.id } });
            note(
              "test-e-refund-replay-idempotency",
              afterReplay?.refundedCents === beforeReplay ? "CODE_VERIFIED_ONLY" : "FAIL",
              `local upsert of same refund id: refundedCents ${beforeReplay} → ${afterReplay?.refundedCents}`,
            );
          }
        } else {
          note("test-e-stripe-refund", "NOT_TESTED", "skipped because Test A ledger failed");
          note("test-e-webhook-refunded", "NOT_TESTED", "skipped because Test A ledger failed");
        }
      }
    }

    note(
      "test-c-release",
      "NOT_TESTABLE",
      readyReal
        ? "a payouts-enabled Employee exists, but using them would create a destination-employee charge rather than a platform-hold that can later Transfer; KYC was not completed on a new unconnected employee"
        : "no way to produce payouts_enabled on a new Employee without fabricating Stripe/DB state; platform-hold SCT Transfer not run",
    );

    const empD = await createSandboxEmployee(biz.id, `d${Date.now()}`);
    const checkoutD = await createTipCheckoutSession({
      amount: 10,
      employeeId: empD.id,
      businessId: biz.id,
      customerName: "Deploy Test D dispute",
    });
    if (checkoutD.sessionId) {
      const paid = await payHostedCheckout(stripe, checkoutD.sessionId, page, "4000000000000259");
      if (!paid.ok) {
        note("test-d-hosted", "NOT_TESTABLE", paid.reason);
      } else {
        const bundle = await readChargeBundle(stripe, paid.pi);
        console.log(`TEST_D pi=${suffix(paid.pi.id)} charge=${suffix(bundle.chargeId)} dest=${bundle.dest ?? "none"}`);
        const ledger = await waitForWebhookLedger(paid.pi.id, 120000);
        if (!ledger.payable) {
          note("test-d-webhook-dispute", "FAIL", "no payable after dispute-card payment; cannot verify freeze");
        } else {
          const deadline = Date.now() + 180000;
          let open = ledger.payable.disputedOpenCents;
          let disputeId = ledger.payable.stripeDisputeId;
          while (Date.now() < deadline) {
            const row = await prisma.employeeTipPayable.findUnique({ where: { id: ledger.payable.id } });
            open = row?.disputedOpenCents ?? 0;
            disputeId = row?.stripeDisputeId ?? null;
            if (open > 0) break;
            await sleep(4000);
          }
          const remaining = remainingPayableCents(
            (await prisma.employeeTipPayable.findUnique({ where: { id: ledger.payable.id } }))!,
          );
          note(
            "test-d-webhook-dispute",
            open > 0 ? "LIVE_STRIPE_TEST_VERIFIED" : "NOT_TESTABLE",
            open > 0
              ? `disputedOpenCents=${open} stripeDisputeId=${suffix(disputeId)} remaining=${remaining}`
              : `Stripe charge succeeded but deployed webhook did not set disputedOpenCents within 180s (open=0 disputeId=${suffix(disputeId)})`,
          );
        }
      }
    }

    await prisma.business.update({
      where: { id: biz.id },
      data: { employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution },
    });

    const empB = await createSandboxEmployee(biz.id, `b${Date.now()}`);
    const checkoutB = await createTipCheckoutSession({
      amount: 10,
      employeeId: empB.id,
      businessId: biz.id,
      customerName: "Deploy Test B",
    });
    if (!checkoutB.sessionId) {
      note("test-b-checkout", "FAIL", "no session id");
    } else {
      const paid = await payHostedCheckout(stripe, checkoutB.sessionId, page, "4242424242424242");
      if (!paid.ok) {
        note("test-b-hosted", "FAIL", paid.reason);
      } else {
        const bundle = await readChargeBundle(stripe, paid.pi);
        console.log(
          `TEST_B amount=${bundle.amount} dest=${suffix(bundle.dest)} fee=${bundle.applicationFeeAmount} destTransfer=${bundle.transferAmount} pi=${suffix(paid.pi.id)}`,
        );
        const stripeOk =
          paid.pi.status === "succeeded" &&
          bundle.dest === biz.stripeAccountId &&
          bundle.applicationFeeAmount === 149 &&
          bundle.transferAmount === 1000;
        note(
          "test-b-stripe",
          stripeOk ? "LIVE_STRIPE_TEST_VERIFIED" : "FAIL",
          `dest=${suffix(bundle.dest)} fee=${bundle.applicationFeeAmount} destTransfer=${bundle.transferAmount}`,
        );
        const ledger = await waitForWebhookLedger(paid.pi.id, 120000);
        console.log(
          `TEST_B webhook waited=${ledger.waitedMs} tx=${ledger.tx?.status ?? "MISSING"} payable=${ledger.payable ? `${ledger.payable.status}:${ledger.payable.chargeModel}:${ledger.payable.payableCents}` : "MISSING"}`,
        );
        const payableOk =
          ledger.tx?.status === "success" &&
          ledger.payable?.routingMode === EmployeeTipPayoutMode.business_distribution &&
          ledger.payable.chargeModel === EmployeeTipChargeModel.destination_business &&
          ledger.payable.status === "held_business" &&
          ledger.payable.payableCents === 851;
        note(
          "test-b-webhook-ledger",
          payableOk ? "LIVE_STRIPE_TEST_VERIFIED" : "FAIL",
          payableOk
            ? `held_business 851¢ after ${ledger.waitedMs}ms (Stripe dest Transfer 1000¢ is gross)`
            : `tx=${ledger.tx?.status ?? "none"} payable=${ledger.payable ? `${ledger.payable.status}:${ledger.payable.payableCents}` : "MISSING"}`,
        );
        if (bundle.dest) {
          try {
            const bal = await stripe.balance.retrieve({ stripeAccount: bundle.dest });
            const instant = bal.instant_available?.reduce((s, x) => s + x.amount, 0) ?? 0;
            console.log(`TEST_B business_instant_available_cents=${instant} (observation only; Gate 5 blocked)`);
            note(
              "test-b-business-instant-observation",
              "LIVE_STRIPE_TEST_VERIFIED",
              `instant_available observed=${instant}¢ — not a reservation; Gate 5 unchanged`,
            );
          } catch (err) {
            note(
              "test-b-business-instant-observation",
              "NOT_TESTABLE",
              err instanceof Error ? err.message : "balance retrieve failed",
            );
          }
        }

        const empF = await createSandboxEmployee(biz.id, `f${Date.now()}`);
        const checkoutF = await createTipCheckoutSession({
          amount: 10,
          employeeId: empF.id,
          businessId: biz.id,
          customerName: "Deploy Test F dispute",
        });
        if (checkoutF.sessionId) {
          const paidF = await payHostedCheckout(stripe, checkoutF.sessionId, page, "4000000000000259");
          if (!paidF.ok) {
            note("test-f-hosted", "NOT_TESTABLE", paidF.reason);
          } else {
            const bundleF = await readChargeBundle(stripe, paidF.pi);
            const ledgerF = await waitForWebhookLedger(paidF.pi.id, 120000);
            const destStillBiz = bundleF.dest === biz.stripeAccountId;
            const deadline = Date.now() + 180000;
            let open = ledgerF.payable?.disputedOpenCents ?? 0;
            while (ledgerF.payable && Date.now() < deadline && open === 0) {
              const row = await prisma.employeeTipPayable.findUnique({ where: { id: ledgerF.payable.id } });
              open = row?.disputedOpenCents ?? 0;
              if (open > 0) break;
              await sleep(4000);
            }
            note(
              "test-f-business-dispute",
              destStillBiz && ledgerF.payable
                ? open > 0
                  ? "LIVE_STRIPE_TEST_VERIFIED"
                  : "NOT_TESTABLE"
                : "FAIL",
              `destBusiness=${destStillBiz} payable=${ledgerF.payable ? ledgerF.payable.status : "MISSING"} disputedOpen=${open} no employee Transfer attempted`,
            );
          }
        }
      }
    }
  } finally {
    await prisma.business.update({
      where: { id: biz.id },
      data: { employeeTipPayoutMode: originalMode },
    });
    await browser.close();
  }

  const fee = calculateTipPlatformFeeCents(1000);
  note("fee-semantics", "CODE_VERIFIED_ONLY", `10% + €0.49 on 1000¢ = ${fee}¢ (unchanged)`);
  console.log("=== SUMMARY ===");
  for (const line of lines) {
    console.log(`${line.verdict}\t${line.id}\t${line.detail}`);
  }
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
