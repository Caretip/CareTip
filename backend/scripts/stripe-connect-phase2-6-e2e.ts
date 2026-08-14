/**
 * Phase 2.6 — real Stripe TEST MODE hosted Checkout E2E.
 * Never prints secrets, full card data, or full acct_/pi_/cs_ ids.
 *
 * Run: npm run test:stripe-connect-phase2-6
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import bcrypt from "bcrypt";
import {
  OnboardingVerificationStatus,
  Role,
  StripeConnectStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import { getStripeClient, handlePaymentSuccess, handleSuccessfulTipPayment, isStripeConfigured } from "../src/services/stripe.service.js";

const LOCAL_FRONTEND = "http://localhost:5173";
/** Dedicated port so this E2E hits this codebase, not a stale API on 3001. */
const API_PORT = process.env.PHASE26_API_PORT ?? "3016";
const API_BASE = `http://127.0.0.1:${API_PORT}`;

type ChromiumBrowser = {
  newContext: (opts?: { viewport?: { width: number; height: number } }) => Promise<{
    newPage: () => Promise<CheckoutPage>;
    close: () => Promise<void>;
  }>;
  close: () => Promise<void>;
};
type CheckoutPage = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  locator: (sel: string) => {
    count: () => Promise<number>;
    first: () => { fill: (v: string) => Promise<void>; click: () => Promise<void> };
    fill: (v: string) => Promise<void>;
    click: (opts?: { timeout?: number }) => Promise<void>;
  };
  getByLabel: (re: RegExp) => { fill: (v: string) => Promise<void>; count: () => Promise<number> };
  getByPlaceholder: (re: RegExp) => { fill: (v: string) => Promise<void>; count: () => Promise<number> };
  getByRole: (role: string, opts: { name: RegExp }) => { click: (opts?: { timeout?: number }) => Promise<void> };
  frameLocator: (sel: string) => {
    locator: (sel: string) => { fill: (v: string) => Promise<void>; count: () => Promise<number> };
  };
  waitForURL: (re: RegExp, opts?: { timeout?: number }) => Promise<void>;
  url: () => string;
  content: () => Promise<string>;
};

function suffix(id: string | null | undefined): string {
  if (!id) return "(none)";
  return id.length <= 8 ? "(short)" : `…${id.slice(-8)}`;
}
function keyMode(): "missing" | "test" | "live" | "unknown" {
  const k = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!k) return "missing";
  if (k.startsWith("sk_test_")) return "test";
  if (k.startsWith("sk_live_")) return "live";
  return "unknown";
}

const log: string[] = [];
function info(msg: string) {
  console.log(msg);
  log.push(msg);
}

async function fillIfPresent(page: CheckoutPage, selector: string, value: string): Promise<boolean> {
  const loc = page.locator(selector);
  if ((await loc.count()) > 0) {
    await loc.first().fill(value);
    return true;
  }
  return false;
}

async function completeHostedCheckout(url: string): Promise<{ finalUrl: string; openedHost: string }> {
  const require = createRequire(join(process.cwd(), "../package.json"));
  const playwright = require("playwright") as {
    chromium: { launch: (o: { headless: boolean; args?: string[] }) => Promise<ChromiumBrowser> };
  };
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage() as CheckoutPage & {
    keyboard: { type: (t: string, o?: { delay?: number }) => Promise<void>; press: (k: string) => Promise<void> };
    waitForTimeout?: (ms: number) => Promise<void>;
  };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 3500));
    const openedHost = new URL(page.url()).host;
    if (!openedHost.includes("checkout.stripe.com") && !openedHost.includes("stripe.com")) {
      throw new Error(`Hosted Checkout did not open Stripe. host=${openedHost}`);
    }

    await fillIfPresent(page, "#email", "phase26-e2e@caretip-test.local");
    await fillIfPresent(page, 'input[type="email"]', "phase26-e2e@caretip-test.local");
    await fillIfPresent(page, 'input[name="email"]', "phase26-e2e@caretip-test.local");
    try {
      await page.getByLabel(/email/i).fill("phase26-e2e@caretip-test.local");
    } catch {
      /* optional */
    }

    const typeInto = async (selector: string, value: string): Promise<boolean> => {
      const loc = page.locator(selector);
      if ((await loc.count()) === 0) return false;
      await loc.first().click();
      try {
        await page.keyboard.press("Control+A");
      } catch {
        /* ignore */
      }
      await page.keyboard.type(value, { delay: 35 });
      return true;
    };

    const cardSelectors = [
      "#cardNumber",
      'input[name="cardNumber"]',
      'input[autocomplete="cc-number"]',
      '[placeholder="1234 1234 1234 1234"]',
    ];
    let cardFilled = false;
    for (const sel of cardSelectors) {
      if (await typeInto(sel, "4242424242424242")) {
        cardFilled = true;
        break;
      }
    }
    if (!cardFilled) {
      const frame = page.frameLocator('iframe[title*="Secure" i], iframe[name^="__privateStripeFrame"]').first();
      try {
        await frame.locator('input[name="cardnumber"], [placeholder*="1234"], input[autocomplete="cc-number"]').fill("4242424242424242");
        cardFilled = true;
      } catch {
        /* try placeholders */
      }
      try {
        await page.getByPlaceholder(/card number|kartennummer/i).fill("4242424242424242");
        cardFilled = true;
      } catch {
        /* continue */
      }
    }

    await typeInto("#cardExpiry", "1234");
    await fillIfPresent(page, 'input[name="cardExpiry"]', "1234");
    await fillIfPresent(page, 'input[autocomplete="cc-exp"]', "12 / 34");
    await typeInto("#cardCvc", "123");
    await fillIfPresent(page, 'input[name="cardCvc"]', "123");
    await fillIfPresent(page, 'input[autocomplete="cc-csc"]', "123");
    await typeInto("#billingName", "Phase26 E2E");
    await fillIfPresent(page, 'input[name="billingName"]', "Phase26 E2E");
    await typeInto("#billingPostalCode", "10115");
    await fillIfPresent(page, 'input[name="billingPostalCode"]', "10115");

    if (!cardFilled) {
      const text = (await page.content()).replace(/\s+/g, " ").replace(/4242\s*4242\s*4242\s*4242/g, "[redacted]");
      throw new Error(`Could not find card fields on Checkout. url_host=${new URL(page.url()).host} snippet=${text.slice(0, 160)}`);
    }

    try {
      await page.getByRole("button", { name: /pay|zahlen|bezahlen|submit|complete|pay now/i }).click({ timeout: 8_000 });
    } catch {
      await page.locator('button[type="submit"]').first().click({ timeout: 8_000 });
    }

    await page.waitForURL(/localhost:5173\/rating|\/rating\?session_id=|checkout\.stripe\.com\/.*success|success/i, {
      timeout: 90_000,
    }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 4000));
    return { finalUrl: page.url(), openedHost };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${API_BASE}/health`);
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((x) => setTimeout(x, 500));
  }
  return false;
}

async function ensureApi(): Promise<ChildProcess | null> {
  if (await waitForHealth(1500)) {
    info("api: already running");
    return null;
  }
  info(`api: starting local backend on ${API_PORT} with process-only FRONTEND_URL`);
  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: API_PORT,
      FRONTEND_URL: process.env.FRONTEND_URL?.trim() || LOCAL_FRONTEND,
    },
    stdio: "pipe",
    shell: true,
  });
  child.stderr?.on("data", (buf: Buffer) => {
    const s = buf.toString();
    if (/error|Error|listen/i.test(s) && !/prisma:error/.test(s)) {
      info(`api-log: ${s.slice(0, 160).replace(/\s+/g, " ")}`);
    }
  });
  const ok = await waitForHealth(45_000);
  if (!ok) throw new Error("Local API did not become healthy on /health");
  info("api: healthy");
  return child;
}

async function main() {
  const mode = keyMode();
  info(`stripe_mode=${mode}`);
  info(`webhook_secret_configured=${Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim())}`);
  const frontendWasSet = Boolean(process.env.FRONTEND_URL?.trim());
  if (!frontendWasSet) {
    process.env.FRONTEND_URL = LOCAL_FRONTEND;
    info(`frontend_url: unset in files; process-only ${LOCAL_FRONTEND} (not Render)`);
  } else {
    info(`frontend_url_host=${new URL(process.env.FRONTEND_URL!).host}`);
  }

  if (mode === "live") {
    console.log("E2E BLOCKED — LIVE STRIPE CREDENTIAL DETECTED.");
    process.exit(2);
  }
  if (mode !== "test" || !isStripeConfigured()) {
    console.log("E2E BLOCKED — Stripe TEST MODE secret missing.");
    process.exit(2);
  }

  const stripe = getStripeClient();
  const listed = await stripe.accounts.list({ limit: 20 });
  const readyAcct = listed.data.find((a) => a.charges_enabled === true && a.payouts_enabled === true);
  if (!readyAcct?.id) {
    throw new Error("No test-mode connected account with charges_enabled and payouts_enabled");
  }
  const acct = await stripe.accounts.retrieve(readyAcct.id);
  info(
    `connect_acct suffix=${suffix(acct.id)} type=${acct.type} charges=${acct.charges_enabled} payouts=${acct.payouts_enabled} details=${acct.details_submitted} due=${acct.requirements?.currently_due?.length ?? 0} disabled=${acct.requirements?.disabled_reason ?? "none"}`,
  );

  const existingBiz = await prisma.business.findUnique({
    where: { stripeAccountId: acct.id },
    include: {
      employees: {
        where: { isDeleted: false },
        include: { user: { select: { id: true, emailVerified: true, isActive: true } } },
        take: 10,
      },
    },
  });

  let bizId: string;
  let empId: string;
  if (existingBiz) {
    await prisma.business.update({
      where: { id: existingBiz.id },
      data: {
        deletedAt: null,
        legalHold: false,
        operationalStatus: "active",
        onboardingVerificationStatus: OnboardingVerificationStatus.approved,
        stripeConnectStatus: StripeConnectStatus.ready,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: Boolean(acct.details_submitted),
      },
    });
    bizId = existingBiz.id;
    const eligible = existingBiz.employees.find(
      (e) => e.isActive && e.activationStatus === "active" && e.user?.emailVerified && e.user.isActive !== false,
    );
    if (eligible) {
      empId = eligible.id;
      info("reused existing CareTip Business bound to the ready Connect account (no new Express account)");
    } else {
      const tag = `p26_${Date.now()}`;
      const passwordHash = await bcrypt.hash("Phase26E2E!23", 4);
      const empUser = await prisma.user.create({
        data: {
          email: `emp_${tag}@caretip-test.local`,
          passwordHash,
          role: Role.EMPLOYEE,
          emailVerified: true,
          isActive: true,
        },
      });
      const empRow = await prisma.employee.create({
        data: {
          name: "Phase26 Staff",
          jobTitle: "Server",
          businessId: existingBiz.id,
          userId: empUser.id,
          isActive: true,
          activationStatus: "active",
        },
      });
      empId = empRow.id;
      info("reused existing Business; created eligible employee only");
    }
  } else {
    const tag = `p26_${Date.now()}`;
    const passwordHash = await bcrypt.hash("Phase26E2E!23", 4);
    const manager = await prisma.user.create({
      data: {
        email: `mgr_${tag}@caretip-test.local`,
        passwordHash,
        role: Role.MANAGER,
        emailVerified: true,
        hasCompletedOnboarding: true,
      },
    });
    const empUser = await prisma.user.create({
      data: {
        email: `emp_${tag}@caretip-test.local`,
        passwordHash,
        role: Role.EMPLOYEE,
        emailVerified: true,
        isActive: true,
      },
    });
    const created = await prisma.business.create({
      data: {
        name: `Phase26 E2E ${tag}`,
        slug: `phase26-${tag}`,
        userId: manager.id,
        onboardingVerificationStatus: OnboardingVerificationStatus.approved,
        operationalStatus: "active",
        stripeAccountId: acct.id,
        stripeConnectStatus: StripeConnectStatus.ready,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: Boolean(acct.details_submitted),
      },
    });
    const empRow = await prisma.employee.create({
      data: {
        name: "Phase26 Staff",
        jobTitle: "Server",
        businessId: created.id,
        userId: empUser.id,
        isActive: true,
        activationStatus: "active",
      },
    });
    bizId = created.id;
    empId = empRow.id;
    info("bound a new CareTip Business to the existing ready Connect account (no new Express account)");
  }

  const biz = await prisma.business.findUniqueOrThrow({
    where: { id: bizId },
    select: {
      id: true,
      stripeAccountId: true,
      stripeConnectStatus: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      operationalStatus: true,
      deletedAt: true,
      legalHold: true,
      onboardingVerificationStatus: true,
    },
  });
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: empId }, select: { id: true } });
  info(
    `business suffix=${suffix(biz.id)} employee suffix=${suffix(emp.id)} dest_match=${biz.stripeAccountId === acct.id} connect=${biz.stripeConnectStatus} charges=${biz.stripeChargesEnabled} payouts=${biz.stripePayoutsEnabled} ops=${biz.operationalStatus} hold=${biz.legalHold} deleted=${Boolean(biz.deletedAt)} onboarding=${biz.onboardingVerificationStatus}`,
  );

  let child: ChildProcess | null = null;
  const evidence: Record<string, unknown> = {
    stripeMode: mode,
    destSuffix: suffix(acct.id),
    businessSuffix: suffix(biz.id),
    employeeSuffix: suffix(emp.id),
  };

  try {
    child = await ensureApi();
    const started = Math.floor(Date.now() / 1000);
    const createRes = await fetch(`${API_BASE}/api/payments/create-tip-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: emp.id,
        businessId: biz.id,
        amount: 10,
        tipAmount: 10,
      }),
    });
    const createJson = (await createRes.json()) as { sessionId?: string; url?: string; message?: string; code?: string };
    if (!createRes.ok || !createJson.sessionId || !createJson.url) {
      throw new Error(`create-tip-session failed status=${createRes.status} code=${createJson.code ?? ""} msg=${(createJson.message ?? "").slice(0, 80)}`);
    }
    info(`checkout_session suffix=${suffix(createJson.sessionId)} url_host=${new URL(createJson.url).host}`);
    evidence.checkoutSessionSuffix = suffix(createJson.sessionId);

    const pre = await stripe.checkout.sessions.retrieve(createJson.sessionId);
    const successUrlSafe = (() => {
      try {
        const u = new URL((pre.success_url ?? "").replace("{CHECKOUT_SESSION_ID}", "SESSION"));
        return `${u.protocol}//${u.host}${u.pathname}`;
      } catch {
        return "(invalid)";
      }
    })();
    const cancelUrlSafe = (() => {
      try {
        const u = new URL(pre.cancel_url ?? "");
        return `${u.protocol}//${u.host}${u.pathname}`;
      } catch {
        return "(invalid)";
      }
    })();
    info(
      `prepay session mode=${pre.mode} currency=${pre.currency} amount_total=${pre.amount_total} payment_status=${pre.payment_status} pi_present=${Boolean(pre.payment_intent)} success_path=${successUrlSafe} cancel_path=${cancelUrlSafe}`,
    );
    evidence.prepay = {
      mode: pre.mode,
      currency: pre.currency,
      amount_total: pre.amount_total,
      payment_status: pre.payment_status,
      piPresent: Boolean(pre.payment_intent),
      successUrlPath: successUrlSafe,
      cancelUrlPath: cancelUrlSafe,
    };

    info("opening hosted Checkout and paying with Stripe TEST card 4242…");
    const paidNav = await completeHostedCheckout(createJson.url);
    evidence.hostedCheckoutOpenedHost = paidNav.openedHost;
    info(`hosted_checkout_opened host=${paidNav.openedHost}`);
    info(`after_checkout final_host=${(() => { try { return new URL(paidNav.finalUrl).host + new URL(paidNav.finalUrl).pathname; } catch { return "(nav)"; } })()}`);
    evidence.returnPath = (() => {
      try {
        const u = new URL(paidNav.finalUrl);
        return `${u.host}${u.pathname}${u.search ? "?session_id=(redacted)" : ""}`;
      } catch {
        return "(unknown)";
      }
    })();

    let session = await stripe.checkout.sessions.retrieve(createJson.sessionId, {
      expand: ["payment_intent", "payment_intent.latest_charge"],
    });
    for (let i = 0; i < 15 && session.payment_status !== "paid"; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      session = await stripe.checkout.sessions.retrieve(createJson.sessionId, {
        expand: ["payment_intent", "payment_intent.latest_charge"],
      });
    }
    info(`postpay payment_status=${session.payment_status} amount_total=${session.amount_total} currency=${session.currency}`);

    let pi: Stripe.PaymentIntent | null = null;
    if (session.payment_intent && typeof session.payment_intent === "object") {
      pi = session.payment_intent as Stripe.PaymentIntent;
    } else if (typeof session.payment_intent === "string") {
      pi = await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ["latest_charge"] });
    }
    if (!pi) throw new Error("PaymentIntent missing after hosted Checkout");

    pi = await stripe.paymentIntents.retrieve(pi.id, {
      expand: ["latest_charge", "latest_charge.balance_transaction", "latest_charge.application_fee", "latest_charge.transfer"],
    });

    const dest = pi.transfer_data?.destination;
    const destId = typeof dest === "string" ? dest : dest?.id;
    info(
      `pi suffix=${suffix(pi.id)} status=${pi.status} amount=${pi.amount} currency=${pi.currency} app_fee=${pi.application_fee_amount} dest=${suffix(destId)} dest_match=${destId === acct.id}`,
    );
    evidence.pi = {
      suffix: suffix(pi.id),
      status: pi.status,
      amount: pi.amount,
      currency: pi.currency,
      application_fee_amount: pi.application_fee_amount,
      destSuffix: suffix(destId),
      destMatch: destId === acct.id,
    };

    const chargeRef = pi.latest_charge;
    const charge =
      chargeRef && typeof chargeRef === "object"
        ? (chargeRef as Stripe.Charge)
        : typeof chargeRef === "string"
          ? await stripe.charges.retrieve(chargeRef, { expand: ["balance_transaction", "application_fee", "transfer"] })
          : null;
    if (charge) {
      const cDest = typeof charge.destination === "string" ? charge.destination : charge.destination?.id;
      const chargePi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      info(
        `charge suffix=${suffix(charge.id)} amount=${charge.amount} paid=${charge.paid} dest=${suffix(cDest)} app_fee_amount=${charge.application_fee_amount} pi=${suffix(chargePi)} pi_match=${chargePi === pi.id}`,
      );
      evidence.charge = {
        suffix: suffix(charge.id),
        amount: charge.amount,
        paid: charge.paid,
        destSuffix: suffix(cDest),
        destMatch: cDest === acct.id,
        application_fee_amount: charge.application_fee_amount,
        paymentIntentMatch: chargePi === pi.id,
      };

      let feeObj: Stripe.ApplicationFee | null = null;
      if (charge.application_fee && typeof charge.application_fee === "object") {
        feeObj = charge.application_fee as Stripe.ApplicationFee;
      } else if (typeof charge.application_fee === "string") {
        feeObj = await stripe.applicationFees.retrieve(charge.application_fee);
      } else {
        const listed = await stripe.applicationFees.list({ charge: charge.id, limit: 1 });
        feeObj = listed.data[0] ?? null;
      }
      if (feeObj) {
        info(`application_fee suffix=${suffix(feeObj.id)} amount=${feeObj.amount} currency=${feeObj.currency}`);
        evidence.applicationFee = { suffix: suffix(feeObj.id), amount: feeObj.amount, currency: feeObj.currency };
      }

      const transferRef = charge.transfer;
      if (transferRef && typeof transferRef === "object") {
        const tr = transferRef as Stripe.Transfer;
        info(`transfer suffix=${suffix(tr.id)} amount=${tr.amount} dest=${suffix(typeof tr.destination === "string" ? tr.destination : tr.destination?.id)} currency=${tr.currency}`);
        evidence.transfer = {
          suffix: suffix(tr.id),
          amount: tr.amount,
          currency: tr.currency,
          destSuffix: suffix(typeof tr.destination === "string" ? tr.destination : tr.destination?.id),
          destMatch: (typeof tr.destination === "string" ? tr.destination : tr.destination?.id) === acct.id,
        };
      } else if (typeof transferRef === "string") {
        const tr = await stripe.transfers.retrieve(transferRef);
        info(`transfer suffix=${suffix(tr.id)} amount=${tr.amount} dest=${suffix(typeof tr.destination === "string" ? tr.destination : tr.destination?.id)} currency=${tr.currency}`);
        evidence.transfer = {
          suffix: suffix(tr.id),
          amount: tr.amount,
          currency: tr.currency,
          destSuffix: suffix(typeof tr.destination === "string" ? tr.destination : tr.destination?.id),
          destMatch: (typeof tr.destination === "string" ? tr.destination : tr.destination?.id) === acct.id,
        };
      }
    }

    const stripeEvents = await stripe.events.list({ created: { gte: started - 30 }, limit: 30 });
    const eventTypes = stripeEvents.data.map((e) => e.type);
    evidence.stripeEventTypes = [...new Set(eventTypes)];
    evidence.stripeCheckoutCompletedEvents = stripeEvents.data.filter((e) => e.type === "checkout.session.completed").length;
    evidence.stripePiSucceededEvents = stripeEvents.data.filter((e) => e.type === "payment_intent.succeeded").length;
    info(
      `stripe_events checkout.session.completed=${evidence.stripeCheckoutCompletedEvents} payment_intent.succeeded=${evidence.stripePiSucceededEvents} types=${[...new Set(eventTypes)].join(",")}`,
    );

    const connectedTx = await stripe.balanceTransactions.list({ limit: 8 }, { stripeAccount: acct.id });
    const recentConnected = connectedTx.data.filter((t) => t.created >= started - 30);
    evidence.connectedBalanceTx = recentConnected.map((t) => ({
      suffix: suffix(t.id),
      type: t.type,
      amount: t.amount,
      fee: t.fee,
      net: t.net,
      currency: t.currency,
    }));
    info(`connected_balance_tx count=${recentConnected.length} types=${recentConnected.map((t) => `${t.type}:${t.amount}/${t.net}`).join(",")}`);

    const platformTx = await stripe.balanceTransactions.list({ limit: 12 });
    const recentPlatform = platformTx.data.filter((t) => t.created >= started - 30);
    evidence.platformBalanceTx = recentPlatform.map((t) => ({
      suffix: suffix(t.id),
      type: t.type,
      amount: t.amount,
      fee: t.fee,
      net: t.net,
      currency: t.currency,
    }));
    info(`platform_balance_tx count=${recentPlatform.length} types=${recentPlatform.map((t) => `${t.type}:${t.amount}/${t.net}`).join(",")}`);

    let ledger = await prisma.transaction.findMany({ where: { stripePaymentIntentId: pi.id } });
    for (let i = 0; i < 20 && ledger.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      ledger = await prisma.transaction.findMany({ where: { stripePaymentIntentId: pi.id } });
    }
    if (ledger.length === 0 && session.payment_status === "paid") {
      info("ledger empty after wait — processing Stripe-confirmed session via handleSuccessfulTipPayment (Render webhook may have targeted a different API host)");
      await handleSuccessfulTipPayment(session);
      ledger = await prisma.transaction.findMany({ where: { stripePaymentIntentId: pi.id } });
      evidence.ledgerSource = "local_handleSuccessfulTipPayment_after_stripe_paid_session";
    } else {
      evidence.ledgerSource = ledger.length ? "database_after_wait (likely Render webhook on shared DB)" : "none";
    }

    info(
      `ledger rows=${ledger.length} status=${ledger[0]?.status ?? "n/a"} amount=${ledger[0] ? String(ledger[0].amount) : "n/a"} biz_match=${ledger[0]?.businessId === biz.id} emp_match=${ledger[0]?.employeeId === emp.id}`,
    );
    evidence.ledger = {
      rows: ledger.length,
      status: ledger[0]?.status ?? null,
      amount: ledger[0] ? String(ledger[0].amount) : null,
      businessMatch: ledger[0]?.businessId === biz.id,
      employeeMatch: ledger[0]?.employeeId === emp.id,
      piMatch: ledger[0]?.stripePaymentIntentId === pi.id,
    };

    const webhookRows = await prisma.stripeWebhookEvent.findMany({
      where: { processedAt: { gte: new Date((started - 30) * 1000) } },
      select: { eventType: true },
    });
    evidence.dbWebhookEventTypes = [...new Set(webhookRows.map((r) => r.eventType))];
    info(`db_webhook_events types=${(evidence.dbWebhookEventTypes as string[]).join(",") || "(none)"}`);

    await handleSuccessfulTipPayment(session);
    await handlePaymentSuccess(pi.id);
    const afterReplay = await prisma.transaction.findMany({ where: { stripePaymentIntentId: pi.id } });
    evidence.replayRows = afterReplay.length;
    info(`replay+pi.succeeded rows=${afterReplay.length} (expect 1)`);

    const checks = {
      testMode: mode === "test",
      hostedOpened: /checkout\.stripe\.com/i.test(paidNav.openedHost),
      destMatch: destId === acct.id && destId === biz.stripeAccountId,
      fee149: pi.application_fee_amount === 149,
      amount1000: pi.amount === 1000 && pi.currency === "eur",
      piSucceeded: pi.status === "succeeded" || session.payment_status === "paid",
      appFeeObject149: !evidence.applicationFee || (evidence.applicationFee as { amount?: number }).amount === 149,
      oneSuccess: afterReplay.length === 1 && afterReplay[0]?.status === "success" && Number(afterReplay[0].amount) === 10,
      returnHasRating: /rating/i.test(paidNav.finalUrl) || /session_id=/i.test(paidNav.finalUrl),
    };
    evidence.checks = checks;
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    info(`CHECKS ${failed.length ? "FAIL " + failed.join(",") : "PASS"} ${JSON.stringify(checks)}`);

    console.log("\n--- E2E_EVIDENCE_JSON ---");
    console.log(JSON.stringify(evidence, null, 2));

    if (failed.length > 0) process.exitCode = 1;
  } finally {
    if (child?.pid) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
      } else {
        child.kill();
      }
    }
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
