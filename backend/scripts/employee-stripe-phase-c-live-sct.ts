/**
 * Live Render + Stripe TEST: platform-hold then Employee Connect SCT.
 * Release only via deployed GET /api/me/employee-connect/status.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { chromium } from "@playwright/test";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayoutMode,
  Role,
  StripeConnectStatus,
} from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { createTipCheckoutSession, getStripeClient } from "../src/services/stripe.service.js";
import { remainingPayableCents } from "../src/services/employeeTipPayable.service.js";
import { retrieveConnectCapabilitySnapshot } from "../src/services/stripeConnect.service.js";

const RENDER = "https://caretip.onrender.com";
const PASSWORD = "Testpass1!";

function suffix(id: string | null | undefined) {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 10 ? "(short)" : `…${s.slice(-8)}`;
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function isSyntheticAcct(id: string) {
  return /acct_(rt_|p\d+_|stale_|ready_|unknown_|shared_|sprint|dp_|obiz_)/i.test(id);
}

async function renderJson(path: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.set("x-caretip-client", "1");
  headers.set("Origin", "https://caretip.de");
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${RENDER}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function waitForPayable(piId: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tx = await prisma.transaction.findUnique({
      where: { stripePaymentIntentId: piId },
      select: { id: true, status: true },
    });
    if (tx) {
      const payable = await prisma.employeeTipPayable.findUnique({ where: { transactionId: tx.id } });
      if (payable) return { tx, payable, waitedMs: Date.now() - start };
    }
    await sleep(2000);
  }
  return { tx: null, payable: null, waitedMs: Date.now() - start };
}

async function fillHostedCheckout(page: import("@playwright/test").Page, card: string) {
  await page.waitForTimeout(2500);
  const email = page.locator('input[type="email"], input[name="email"]').first();
  if (await email.count()) {
    await email.fill("sct-live@caretip-test.local");
    await email.press("Tab");
  }
  const cardAccordion = page.getByRole("button", { name: /card/i }).first();
  if (await cardAccordion.count()) await cardAccordion.click().catch(() => undefined);
  await page.waitForTimeout(1200);
  const typeInto = async (selector: string, value: string) => {
    const loc = page.locator(selector);
    if ((await loc.count()) === 0) return false;
    await loc.first().click();
    await page.keyboard.type(value, { delay: 20 });
    return true;
  };
  await typeInto("#cardNumber", card);
  await typeInto('[placeholder="1234 1234 1234 1234"]', card);
  if (!(await typeInto("#cardNumber", card))) {
    for (const frame of page.frames()) {
      const number = frame.locator('input[name="cardnumber"], input[autocomplete="cc-number"]');
      if ((await number.count()) > 0) {
        await number.first().fill(card);
        break;
      }
    }
  }
  await typeInto("#cardExpiry", "1230");
  await typeInto("#cardCvc", "123");
  await typeInto("#billingName", "SCT Live");
  await typeInto("#billingPostalCode", "10115");
  const pay = page.getByRole("button", { name: /pay|zahlen|submit|complete/i }).first();
  if (await pay.count()) await pay.click();
  await page.waitForTimeout(4000);
}

async function tryStripeTestOnboarding(page: import("@playwright/test").Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const start = Date.now();
  let lastHost = "";
  while (Date.now() - start < 180000) {
    lastHost = new URL(page.url()).host;
    if (/caretip\.de|localhost/.test(lastHost) && /payouts/.test(page.url())) {
      return { done: true as const, host: lastHost, reason: "returned_to_caretip" };
    }
    const skip = page.getByRole("button", { name: /skip|test mode|use test|fill test|continue|weiter|agree|akzeptieren|submit|speichern/i });
    if (await skip.count()) {
      await skip.first().click().catch(() => undefined);
    }
    await page.waitForTimeout(2500);
  }
  return { done: false as const, host: lastHost, reason: "hosted_onboarding_timeout" };
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    console.log("BLOCKED not TEST key");
    process.exitCode = 1;
    return;
  }
  if (!process.env.FRONTEND_URL?.trim()) process.env.FRONTEND_URL = "https://caretip.de";

  const health = await fetch(`${RENDER}/api/health`).then((r) => r.json()) as {
    status?: string;
    database?: string;
    uptime?: number;
  };
  console.log(`render_health status=${health.status} db=${health.database} uptime_s=${health.uptime}`);
  if (health.status !== "ok" || health.database !== "connected") {
    console.log("STOP Render unhealthy");
    process.exitCode = 1;
    return;
  }

  const biz = await prisma.business.findFirst({
    where: {
      stripeAccountId: { startsWith: "acct_" },
      stripeConnectStatus: StripeConnectStatus.ready,
      operationalStatus: "active",
    },
    select: { id: true, name: true, stripeAccountId: true, employeeTipPayoutMode: true },
  });
  if (!biz?.stripeAccountId || isSyntheticAcct(biz.stripeAccountId)) {
    console.log("STOP no business");
    process.exitCode = 1;
    return;
  }
  const originalMode = biz.employeeTipPayoutMode;
  const tag = `sct${Date.now()}`;
  const email = `sandbox.sct.live.${tag}@caretip-test.local`;
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
      isActive: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: `Sandbox SCT Live ${tag}`,
      jobTitle: "Server",
      businessId: biz.id,
      userId: user.id,
      activationStatus: "active",
      isActive: true,
      isDeleted: false,
    },
  });
  console.log(`fixture emp=${suffix(employee.id)} user=${suffix(user.id)} biz=${suffix(biz.id)}`);

  const stripe = getStripeClient();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await prisma.business.update({
      where: { id: biz.id },
      data: { employeeTipPayoutMode: EmployeeTipPayoutMode.direct_to_employee },
    });

    const checkout = await createTipCheckoutSession({
      amount: 10,
      employeeId: employee.id,
      businessId: biz.id,
      customerName: "SCT live hold",
    });
    const session = await stripe.checkout.sessions.retrieve(checkout.sessionId);
    if (!session.url) throw new Error("no checkout url");
    await page.goto(session.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await fillHostedCheckout(page, "4242424242424242");
    let piId: string | null = null;
    const payStart = Date.now();
    while (Date.now() - payStart < 90000) {
      const again = await stripe.checkout.sessions.retrieve(checkout.sessionId, { expand: ["payment_intent"] });
      if (again.payment_status === "paid") {
        piId =
          typeof again.payment_intent === "string"
            ? again.payment_intent
            : again.payment_intent?.id ?? null;
        break;
      }
      await sleep(3000);
    }
    if (!piId) {
      console.log("STOP checkout not paid");
      process.exitCode = 1;
      return;
    }
    const pi = await stripe.paymentIntents.retrieve(piId);
    const dest = typeof pi.transfer_data?.destination === "string" ? pi.transfer_data.destination : null;
    console.log(
      `HOLD stripe amount=${pi.amount} dest=${dest ?? "none"} fee=${pi.application_fee_amount ?? "absent"} pi=${suffix(pi.id)}`,
    );
    const ledger = await waitForPayable(pi.id, 120000);
    console.log(
      `HOLD webhook waited=${ledger.waitedMs} tx=${ledger.tx?.status ?? "MISSING"} payable=${
        ledger.payable
          ? `${ledger.payable.chargeModel}:${ledger.payable.payableCents}:xfer=${ledger.payable.stripeTransferId ?? "null"}`
          : "MISSING"
      }`,
    );
    if (
      ledger.tx?.status !== "success" ||
      ledger.payable?.chargeModel !== EmployeeTipChargeModel.platform_hold ||
      ledger.payable.payableCents !== 851 ||
      ledger.payable.stripeTransferId
    ) {
      console.log("STOP platform-hold ledger unexpected");
      process.exitCode = 1;
      return;
    }

    const login = await renderJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: PASSWORD, locale: "en" }),
    });
    const token =
      login.json && typeof login.json === "object" && "token" in login.json
        ? String((login.json as { token?: unknown }).token ?? "")
        : "";
    console.log(`login_status=${login.status} token=${token ? "PRESENT" : "MISSING"}`);
    if (!token) {
      console.log("STOP cannot login to Render as employee", JSON.stringify(login.json).slice(0, 300));
      process.exitCode = 1;
      return;
    }

    const linkRes = await renderJson("/api/me/employee-connect/account-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    const linkUrl =
      linkRes.json && typeof linkRes.json === "object" && "url" in linkRes.json
        ? String((linkRes.json as { url?: unknown }).url ?? "")
        : "";
    let linkHost = "(none)";
    try {
      linkHost = new URL(linkUrl).host;
    } catch {
      linkHost = "(invalid)";
    }
    console.log(`account_link status=${linkRes.status} host=${linkHost}`);
    if (!linkUrl.startsWith("https://")) {
      console.log("STOP no Account Link from Render", JSON.stringify(linkRes.json).slice(0, 300));
      process.exitCode = 1;
      return;
    }

    const onboard = await tryStripeTestOnboarding(page, linkUrl);
    console.log(`onboarding done=${onboard.done} host=${onboard.host} reason=${onboard.reason}`);

    const acctRow = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId: employee.id },
      select: { stripeAccountId: true, stripeConnectStatus: true, stripePayoutsEnabled: true },
    });
    const acctId = acctRow?.stripeAccountId ?? "";
    console.log(
      `db_account suffix=${suffix(acctId)} db_status=${acctRow?.stripeConnectStatus} db_payouts_enabled=${acctRow?.stripePayoutsEnabled} (db is not authority)`,
    );
    if (!acctId.startsWith("acct_")) {
      console.log("STOP no Employee Stripe account created");
      process.exitCode = 1;
      return;
    }

    const snap = await retrieveConnectCapabilitySnapshot(acctId);
    const v1 = await stripe.accounts.retrieve(acctId);
    console.log(
      `STRIPE_LIVE payouts_enabled=${v1.payouts_enabled} charges_enabled=${v1.charges_enabled} type=${v1.type ?? "(none)"} country=${v1.country ?? "(none)"} snap_payouts=${snap?.payoutsEnabled ?? "(none)"} snap_ready=${snap ? `${snap.payoutsEnabled}` : "(none)"}`,
    );

    if (v1.payouts_enabled !== true) {
      console.log("STOP Stripe TEST Employee is not payouts_enabled; SCT not live-testable. Not fabricating DB flags.");
      process.exitCode = 2;
      return;
    }

    const status1 = await renderJson("/api/me/employee-connect/status", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`status1 http=${status1.status} body_keys=${status1.json && typeof status1.json === "object" ? Object.keys(status1.json as object).join(",") : "n/a"}`);
    const payoutsFromApi =
      status1.json && typeof status1.json === "object" && "payoutsEnabled" in status1.json
        ? (status1.json as { payoutsEnabled?: boolean }).payoutsEnabled
        : undefined;
    const conn =
      status1.json && typeof status1.json === "object" && "connectionState" in status1.json
        ? (status1.json as { connectionState?: string }).connectionState
        : undefined;
    console.log(`status1 connectionState=${conn} payoutsEnabled=${payoutsFromApi}`);

    const deadline = Date.now() + 120000;
    let payable = ledger.payable;
    while (Date.now() < deadline) {
      payable = (await prisma.employeeTipPayable.findUnique({ where: { id: ledger.payable.id } }))!;
      if (payable.stripeTransferId?.startsWith("tr_")) break;
      await renderJson("/api/me/employee-connect/status", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      await sleep(4000);
    }
    console.log(
      `AFTER_RELEASE status=${payable.status} transferred=${payable.transferredCents} transferId=${suffix(payable.stripeTransferId)} remaining=${remainingPayableCents(payable)} dest=${suffix(payable.stripeDestinationAccountId)}`,
    );

    if (!payable.stripeTransferId?.startsWith("tr_")) {
      console.log("STOP no Stripe Transfer id on payable after Render status/release");
      process.exitCode = 1;
      return;
    }
    const transfer = await stripe.transfers.retrieve(payable.stripeTransferId);
    const tDest = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id;
    const src =
      typeof transfer.source_transaction === "string"
        ? transfer.source_transaction
        : transfer.source_transaction && typeof transfer.source_transaction === "object"
          ? transfer.source_transaction.id
          : null;
    console.log(
      `STRIPE_TRANSFER id=${suffix(transfer.id)} amount=${transfer.amount} currency=${transfer.currency} dest=${suffix(tDest)} source_transaction=${suffix(src)} livemode=${transfer.livemode}`,
    );

    const status2 = await renderJson("/api/me/employee-connect/status", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`duplicate_status_http=${status2.status}`);
    const again = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    const list = await stripe.transfers.list({ destination: acctId, limit: 10 });
    const matching = list.data.filter((t) => t.metadata?.caretip_payable_id === payable.id);
    console.log(
      `idempotency payable_transfer=${suffix(again?.stripeTransferId)} transferredCents=${again?.transferredCents} stripe_transfers_for_payable=${matching.length}`,
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
