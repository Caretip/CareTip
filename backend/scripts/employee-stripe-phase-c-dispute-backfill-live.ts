/**
 * Live Render verification of dispute-before-ledger backfill.
 * Never calls handleSuccessfulTipPayment.
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
  TipRefundKind,
} from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { createTipCheckoutSession, getStripeClient } from "../src/services/stripe.service.js";
import { remainingPayableCents } from "../src/services/employeeTipPayable.service.js";
import { releaseHeldPlatformPayablesForEmployee } from "../src/services/employeeTipRelease.service.js";
import { upsertStripeDisputeEvent } from "../src/services/finance/tipRefunds.service.js";

function suffix(id: string | null | undefined): string {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 10 ? "(short)" : `…${s.slice(-8)}`;
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForRenderDeploy(maxMs: number) {
  const start = Date.now();
  let baseline: number | null = null;
  while (Date.now() - start < maxMs) {
    const res = await fetch("https://caretip.onrender.com/api/health");
    const body = (await res.json()) as { status?: string; uptime?: number; database?: string };
    console.log(
      `render_health status=${body.status} db=${body.database} uptime_s=${body.uptime ?? "(none)"}`,
    );
    if (body.status === "ok" && body.database === "connected" && typeof body.uptime === "number") {
      if (baseline == null) baseline = body.uptime;
      if (body.uptime < 900) {
        return { ok: true as const, uptime: body.uptime, restarted: true as const };
      }
      if (body.uptime + 5 < baseline) {
        return { ok: true as const, uptime: body.uptime, restarted: true as const };
      }
    }
    await sleep(15000);
  }
  const res = await fetch("https://caretip.onrender.com/api/health");
  const body = (await res.json()) as { status?: string; uptime?: number; database?: string };
  return {
    ok: body.status === "ok" && body.database === "connected",
    uptime: body.uptime ?? -1,
    restarted: false as const,
  };
}

async function waitForWebhookLedger(piId: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tx = await prisma.transaction.findUnique({
      where: { stripePaymentIntentId: piId },
      select: { id: true, status: true },
    });
    if (tx) {
      const payable = await prisma.employeeTipPayable.findUnique({ where: { transactionId: tx.id } });
      return { tx, payable, waitedMs: Date.now() - start };
    }
    await sleep(2000);
  }
  return { tx: null, payable: null, waitedMs: Date.now() - start };
}

async function fillStripeHostedCheckout(page: import("@playwright/test").Page, cardNumber: string) {
  await page.waitForTimeout(2500);
  const email = page.locator('input[type="email"], input[name="email"]').first();
  if (await email.count()) {
    await email.fill("sandbox-dispute-backfill@caretip-test.local");
    await email.press("Tab");
  }
  const cardAccordion = page.getByRole("button", { name: /card/i }).first();
  if (await cardAccordion.count()) await cardAccordion.click().catch(() => undefined);
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
  await typeInto("#billingName", "Sandbox Dispute Backfill");
  await typeInto("#billingPostalCode", "10115");
  const pay = page.getByRole("button", { name: /pay|zahlen|submit|complete/i }).first();
  if (await pay.count()) await pay.click();
  await page.waitForTimeout(4000);
}

async function payHosted(
  stripe: Stripe,
  sessionId: string,
  page: import("@playwright/test").Page,
  cardNumber: string,
) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session.url) return { ok: false as const, reason: "no_url" };
  await page.goto(session.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await fillStripeHostedCheckout(page, cardNumber);
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const again = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (again.payment_status === "paid") {
      const piId =
        typeof again.payment_intent === "string"
          ? again.payment_intent
          : again.payment_intent?.id ?? null;
      if (!piId) break;
      const pi = await stripe.paymentIntents.retrieve(piId);
      return { ok: true as const, pi };
    }
    await sleep(3000);
  }
  return { ok: false as const, reason: "not_paid" };
}

function isSyntheticAcct(id: string) {
  return /acct_(rt_|p\d+_|stale_|ready_|unknown_|shared_|sprint|dp_|obiz_)/i.test(id);
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    console.log("BLOCKED not TEST key");
    process.exitCode = 1;
    return;
  }
  if (!process.env.FRONTEND_URL?.trim()) process.env.FRONTEND_URL = "https://caretip.de";

  const migrations = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
    SELECT migration_name, finished_at FROM _prisma_migrations
    WHERE migration_name IN (
      '20260909220000_employee_stripe_accounts',
      '20260910080000_employee_tip_direct_payout_ledger',
      '20260910120000_employee_tip_payable_disputes'
    )
    ORDER BY finished_at`;
  for (const m of migrations) {
    console.log(`migration ${m.migration_name} finished=${m.finished_at?.toISOString() ?? "(null)"}`);
  }
  const cols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_tip_payables'
      AND column_name IN ('disputed_open_cents','disputed_lost_cents','stripe_dispute_id','refunded_cents','reversed_cents')`;
  console.log(`payable_cols=${cols.map((c) => c.column_name).join(",")}`);

  const stripe = getStripeClient();
  const endpoints = await stripe.webhookEndpoints.list({ limit: 10 });
  for (const ep of endpoints.data) {
    let host = "(invalid)";
    try {
      host = new URL(ep.url).host;
    } catch {
      host = "(unparseable)";
    }
    console.log(
      `webhook host=${host} status=${ep.status} livemode=${ep.livemode} connect=${ep.connect === true} dispute_created=${ep.enabled_events.includes("charge.dispute.created") || ep.enabled_events.includes("*")}`,
    );
  }

  console.log("waiting for Render restart after 3055a35c ...");
  const deploy = await waitForRenderDeploy(540000);
  console.log(`deploy_wait ok=${deploy.ok} restarted=${deploy.restarted} uptime_s=${deploy.uptime}`);
  if (!deploy.ok) {
    console.log("STOP Render not healthy");
    process.exitCode = 1;
    return;
  }
  if (!deploy.restarted) {
    console.log("STOP Render did not restart; refusing to pay against possibly old process");
    process.exitCode = 1;
    return;
  }

  let biz = await prisma.business.findFirst({
    where: {
      name: { contains: "Phase26", mode: "insensitive" },
      stripeAccountId: { startsWith: "acct_" },
      stripeConnectStatus: StripeConnectStatus.ready,
    },
    select: { id: true, stripeAccountId: true, employeeTipPayoutMode: true, name: true },
  });
  if (!biz?.stripeAccountId || isSyntheticAcct(biz.stripeAccountId)) {
    const rows = await prisma.business.findMany({
      where: {
        stripeAccountId: { startsWith: "acct_" },
        stripeConnectStatus: StripeConnectStatus.ready,
        operationalStatus: "active",
      },
      select: { id: true, stripeAccountId: true, employeeTipPayoutMode: true, name: true },
      take: 40,
    });
    biz = rows.find((b) => b.stripeAccountId && !isSyntheticAcct(b.stripeAccountId)) ?? null;
  }
  if (!biz?.stripeAccountId) {
    console.log("STOP no business fixture");
    process.exitCode = 1;
    return;
  }
  console.log(`business name=${biz.name} id=${suffix(biz.id)} acct=${suffix(biz.stripeAccountId)}`);
  const originalMode = biz.employeeTipPayoutMode;
  const tag = `bf${Date.now()}`;
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const user = await prisma.user.create({
    data: {
      email: `sandbox.dispute.backfill.${tag}@caretip-test.local`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
      isActive: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: `Sandbox Dispute Backfill ${tag}`,
      jobTitle: "Server",
      businessId: biz.id,
      userId: user.id,
      activationStatus: "active",
      isActive: true,
      isDeleted: false,
    },
  });
  console.log(`fixture employee=${suffix(employee.id)} business=${suffix(biz.id)}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await prisma.business.update({
      where: { id: biz.id },
      data: { employeeTipPayoutMode: EmployeeTipPayoutMode.direct_to_employee },
    });

    const checkoutOk = await createTipCheckoutSession({
      amount: 10,
      employeeId: employee.id,
      businessId: biz.id,
      customerName: "Backfill 4242",
    });
    const paidOk = await payHosted(stripe, checkoutOk.sessionId, page, "4242424242424242");
    if (!paidOk.ok) {
      console.log("FAIL success_path hosted", paidOk.reason);
      process.exitCode = 1;
      return;
    }
    const destOk =
      typeof paidOk.pi.transfer_data?.destination === "string"
        ? paidOk.pi.transfer_data.destination
        : null;
    console.log(
      `SUCCESS_PATH stripe amount=${paidOk.pi.amount} dest=${destOk ?? "none"} fee=${paidOk.pi.application_fee_amount ?? "absent"} pi=${suffix(paidOk.pi.id)}`,
    );
    const ledgerOk = await waitForWebhookLedger(paidOk.pi.id, 120000);
    console.log(
      `SUCCESS_PATH webhook waited=${ledgerOk.waitedMs} tx=${ledgerOk.tx?.status ?? "MISSING"} payable=${ledgerOk.payable ? `${ledgerOk.payable.chargeModel}:${ledgerOk.payable.payableCents}` : "MISSING"}`,
    );
    if (
      ledgerOk.tx?.status !== "success" ||
      ledgerOk.payable?.chargeModel !== EmployeeTipChargeModel.platform_hold ||
      ledgerOk.payable.payableCents !== 851
    ) {
      console.log("STOP success path failed on deployed webhook");
      process.exitCode = 1;
      return;
    }

    const empD = await prisma.employee.create({
      data: {
        name: `Sandbox Dispute Backfill D ${tag}`,
        jobTitle: "Server",
        businessId: biz.id,
        userId: (
          await prisma.user.create({
            data: {
              email: `sandbox.dispute.backfill.d.${tag}@caretip-test.local`,
              passwordHash,
              role: Role.EMPLOYEE,
              emailVerified: true,
              isActive: true,
            },
          })
        ).id,
        activationStatus: "active",
        isActive: true,
        isDeleted: false,
      },
    });
    const checkoutD = await createTipCheckoutSession({
      amount: 10,
      employeeId: empD.id,
      businessId: biz.id,
      customerName: "Backfill dispute 0259",
    });
    const paidD = await payHosted(stripe, checkoutD.sessionId, page, "4000000000000259");
    if (!paidD.ok) {
      console.log("FAIL dispute hosted", paidD.reason);
      process.exitCode = 1;
      return;
    }
    console.log(
      `DISPUTE_PATH stripe amount=${paidD.pi.amount} dest=${paidD.pi.transfer_data?.destination ?? "none"} fee=${paidD.pi.application_fee_amount ?? "absent"} pi=${suffix(paidD.pi.id)}`,
    );
    const ledgerD = await waitForWebhookLedger(paidD.pi.id, 120000);
    if (!ledgerD.payable) {
      console.log("STOP no payable after dispute-card payment");
      process.exitCode = 1;
      return;
    }

    const freezeDeadline = Date.now() + 120000;
    let row = ledgerD.payable;
    while (Date.now() < freezeDeadline && (row.disputedOpenCents ?? 0) === 0) {
      await sleep(3000);
      row = (await prisma.employeeTipPayable.findUnique({ where: { id: ledgerD.payable.id } }))!;
    }

    const chargeId = row.stripeChargeId;
    let stripeDisputed = false;
    let stripeDisputeId: string | null = null;
    let stripeDisputeStatus: string | null = null;
    let stripeDisputeAmount: number | null = null;
    if (chargeId) {
      const ch = await stripe.charges.retrieve(chargeId);
      stripeDisputed = ch.disputed === true;
      const list = await stripe.disputes.list({ charge: chargeId, limit: 3 });
      stripeDisputeId = list.data[0]?.id ?? null;
      stripeDisputeStatus = list.data[0]?.status ?? null;
      stripeDisputeAmount = list.data[0]?.amount ?? null;
    }
    const tipRefund = stripeDisputeId
      ? await prisma.tipRefund.findUnique({
          where: { stripeDisputeId },
          select: { kind: true, status: true, stripeDisputeId: true, amountEur: true },
        })
      : null;
    const webhookRows = await prisma.stripeWebhookEvent.findMany({
      where: { eventType: { startsWith: "charge.dispute" } },
      orderBy: { processedAt: "desc" },
      take: 5,
      select: { eventType: true, processedAt: true },
    });
    const remaining = remainingPayableCents(row);
    console.log("DISPUTE_DB", {
      chargeModel: row.chargeModel,
      payableCents: row.payableCents,
      disputedOpenCents: row.disputedOpenCents,
      disputedLostCents: row.disputedLostCents,
      stripeDisputeId: suffix(row.stripeDisputeId),
      remaining,
      payableCreated: row.createdAt.toISOString(),
    });
    console.log("DISPUTE_STRIPE", {
      disputed: stripeDisputed,
      disputeId: suffix(stripeDisputeId),
      status: stripeDisputeStatus,
      amount: stripeDisputeAmount,
    });
    console.log("DISPUTE_TIPREFUND", tipRefund);
    console.log(
      "RECENT_DISPUTE_WEBHOOKS",
      webhookRows.map((w) => `${w.eventType}@${w.processedAt.toISOString()}`),
    );

    const raceLikely =
      webhookRows[0] && webhookRows[0].processedAt.getTime() < row.createdAt.getTime();
    console.log(`TIMING race_webhook_before_payable_created=${raceLikely}`);

    if (!stripeDisputed || !stripeDisputeId) {
      console.log("STOP Stripe dispute not created");
      process.exitCode = 1;
      return;
    }
    if (!row.stripeDisputeId || row.disputedOpenCents <= 0) {
      console.log("DEPLOYED DISPUTE BACKFILL FAILED");
      process.exitCode = 1;
      return;
    }

    const released = await releaseHeldPlatformPayablesForEmployee(empD.id);
    console.log(`RELEASE attempted=${released.attempted} released=${released.released} skipped=${released.skipped}`);

    const beforeReplay = row.disputedOpenCents;
    await upsertStripeDisputeEvent({
      stripeDisputeId: stripeDisputeId,
      stripeChargeId: chargeId,
      stripePaymentIntentId: paidD.pi.id,
      amountCents: stripeDisputeAmount ?? 1000,
      status: stripeDisputeStatus ?? "needs_response",
      occurredAt: new Date(),
    });
    const afterReplay = await prisma.employeeTipPayable.findUnique({ where: { id: row.id } });
    const refundCount = await prisma.tipRefund.count({
      where: { stripeDisputeId: stripeDisputeId },
    });
    console.log(
      `REPLAY_LOCAL disputedOpen ${beforeReplay} → ${afterReplay?.disputedOpenCents} tipRefundCount=${refundCount}`,
    );
  } finally {
    await prisma.business.update({
      where: { id: biz.id },
      data: { employeeTipPayoutMode: originalMode },
    });
    await browser.close();
  }
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
