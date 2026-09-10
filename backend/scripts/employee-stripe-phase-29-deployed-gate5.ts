/**
 * Phase 29 — Deployed Render Gate 5 paid TEST.
 * Checkout MUST be created via https://caretip.onrender.com, not local createTipCheckoutSession.
 *
 * Env: PHASE26_PASSWORD (or default from seed script, not printed).
 * Stripe TEST only.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { chromium } from "@playwright/test";
import { EmployeeTipChargeModel, EmployeeTipPayoutMode } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { remainingPayableCents } from "../src/services/employeeTipPayable.service.js";
import { getStripeClient } from "../src/services/stripe.service.js";
import { retrieveConnectCapabilitySnapshot } from "../src/services/stripeConnect.service.js";

const RENDER = "https://caretip.onrender.com";
const ORIGIN = "https://caretip.de";
const MANAGER_EMAIL = "mgr_p26_1786691378148@caretip-test.local";
const JORDAN_EMAIL = "jordan.p26_1786691378148@caretip-test.local";
const SAM_EMAIL = "sam.p26_1786691378148@caretip-test.local";
const PASSWORD = process.env.PHASE26_PASSWORD?.trim() || "Phase26E2E!23";
const EXPECTED_SHA = "b562aa4f";

function suffix(id: string | null | undefined) {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 10 ? "(short)" : `…${s.slice(-8)}`;
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function renderJson(path: string, init: RequestInit & { token?: string }) {
  const headers = new Headers(init.headers);
  headers.set("x-caretip-client", "1");
  headers.set("Origin", ORIGIN);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  const { token: _t, ...rest } = init;
  const res = await fetch(`${RENDER}${path}`, { ...rest, headers });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 240) };
  }
  return { status: res.status, json };
}

async function signin(email: string) {
  const res = await renderJson("/api/auth/signin", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const token =
    res.json && typeof res.json === "object" && "token" in res.json
      ? String((res.json as { token?: string }).token ?? "")
      : "";
  return { status: res.status, token };
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

async function fillHostedCheckout(page: import("@playwright/test").Page, card: string, name: string) {
  await page.waitForTimeout(2500);
  const email = page.locator('input[type="email"], input[name="email"]').first();
  if (await email.count()) {
    await email.fill("p29-gate5@caretip-test.local");
    await email.press("Tab");
  }
  const cardAccordion = page.getByRole("button", { name: /card/i }).first();
  if (await cardAccordion.count()) await cardAccordion.click().catch(() => undefined);
  await page.waitForTimeout(1200);
  const typeInto = async (selector: string, value: string) => {
    const loc = page.locator(selector);
    if ((await loc.count()) === 0) return false;
    await loc.first().click();
    await page.keyboard.type(value, { delay: 18 });
    return true;
  };
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
  await typeInto("#billingName", name);
  await typeInto("#billingPostalCode", "10115");
  const pay = page.getByRole("button", { name: /pay|zahlen|submit|complete/i }).first();
  if (await pay.count()) await pay.click();
  await page.waitForTimeout(4000);
}

async function createRenderCheckout(employeeId: string, businessId: string) {
  return renderJson("/api/payments/create-tip-session", {
    method: "POST",
    body: JSON.stringify({
      amount: 10,
      tipAmount: 10,
      employeeId,
      businessId,
      customerName: "Phase29 Gate5",
    }),
  });
}

async function payCheckoutUrl(url: string, stripe: ReturnType<typeof getStripeClient>, sessionId: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await fillHostedCheckout(page, "4242424242424242", "Phase29 Gate5");
    const payStart = Date.now();
    while (Date.now() - payStart < 90000) {
      const again = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
      if (again.payment_status === "paid") {
        const piId =
          typeof again.payment_intent === "string"
            ? again.payment_intent
            : again.payment_intent?.id ?? null;
        return piId;
      }
      await sleep(3000);
    }
    return null;
  } finally {
    await browser.close();
  }
}

async function main() {
  const evidence: Record<string, unknown> = { expectedSha: EXPECTED_SHA };
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    console.log(JSON.stringify({ ok: false, error: "not_test_stripe_key" }));
    process.exit(1);
  }

  const health = (await fetch(`${RENDER}/api/health`).then((r) => r.json())) as {
    status?: string;
    database?: string;
    environment?: string;
    uptime?: number;
  };
  evidence.health = {
    status: health.status,
    database: health.database,
    environment: health.environment,
    uptime: health.uptime,
  };
  if (health.status !== "ok" || health.database !== "connected") {
    console.log(JSON.stringify({ ok: false, error: "render_unhealthy", evidence }));
    process.exit(1);
  }

  const jordanUser = await prisma.user.findUnique({
    where: { email: JORDAN_EMAIL },
    select: { id: true },
  });
  const jordan = jordanUser
    ? await prisma.employee.findFirst({
        where: { userId: jordanUser.id, isDeleted: false },
        select: {
          id: true,
          businessId: true,
          stripeAccount: { select: { stripeAccountId: true, stripeConnectStatus: true, stripePayoutsEnabled: true } },
        },
      })
    : null;
  const samUser = await prisma.user.findUnique({ where: { email: SAM_EMAIL }, select: { id: true } });
  const sam = samUser
    ? await prisma.employee.findFirst({
        where: { userId: samUser.id, isDeleted: false },
        select: { id: true, stripeAccount: { select: { stripePayoutsEnabled: true, stripeConnectStatus: true } } },
      })
    : null;

  if (!jordan?.id || !jordan.businessId) {
    console.log(JSON.stringify({ ok: false, error: "jordan_missing" }));
    process.exit(1);
  }

  const biz = await prisma.business.findUnique({
    where: { id: jordan.businessId },
    select: { id: true, stripeAccountId: true, employeeTipPayoutMode: true },
  });
  if (!biz) {
    console.log(JSON.stringify({ ok: false, error: "business_missing" }));
    process.exit(1);
  }
  const originalMode = biz.employeeTipPayoutMode;
  evidence.ids = {
    business: suffix(biz.id),
    jordan: suffix(jordan.id),
    jordanAcct: suffix(jordan.stripeAccount?.stripeAccountId),
    sam: suffix(sam?.id),
    businessAcct: suffix(biz.stripeAccountId),
  };

  const historical = await prisma.employeeTipPayable.findFirst({
    where: {
      businessId: biz.id,
      OR: [
        { chargeModel: EmployeeTipChargeModel.destination_business },
        { status: "held_business" },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      routingMode: true,
      chargeModel: true,
      status: true,
      stripeDestinationAccountId: true,
      updatedAt: true,
      createdAt: true,
    },
  });
  evidence.historicalBefore = historical
    ? {
        id: suffix(historical.id),
        routingMode: historical.routingMode,
        chargeModel: historical.chargeModel,
        status: historical.status,
        dest: suffix(historical.stripeDestinationAccountId),
        updatedAt: historical.updatedAt.toISOString(),
      }
    : null;

  const mgr = await signin(MANAGER_EMAIL);
  if (!mgr.token) {
    console.log(JSON.stringify({ ok: false, error: "manager_signin", status: mgr.status }));
    process.exit(1);
  }
  const empAuth = await signin(JORDAN_EMAIL);
  evidence.auth = { manager: mgr.status, jordan: empAuth.status, jordanHasToken: Boolean(empAuth.token) };

  const stripe = getStripeClient();
  let deployed = false;
  let sessionId = "";
  let checkoutUrl = "";
  const deadline = Date.now() + 18 * 60 * 1000;

  try {
    const setMode = await renderJson("/api/me/connect/employee-tip-payout-mode", {
      method: "PATCH",
      token: mgr.token,
      body: JSON.stringify({ mode: "business_distribution" }),
    });
    evidence.setGate5Mode = { status: setMode.status, body: setMode.json };

    while (Date.now() < deadline) {
      const created = await createRenderCheckout(jordan.id, biz.id);
      const url =
        created.json && typeof created.json === "object" && "url" in created.json
          ? String((created.json as { url?: string }).url ?? "")
          : "";
      const sid =
        created.json && typeof created.json === "object" && "sessionId" in created.json
          ? String((created.json as { sessionId?: string }).sessionId ?? "")
          : "";
      if (!sid || created.status >= 400) {
        evidence.lastCheckoutCreate = { status: created.status, json: created.json };
        await sleep(20000);
        continue;
      }
      const session = await stripe.checkout.sessions.retrieve(sid, { expand: ["payment_intent"] });
      const pi =
        typeof session.payment_intent === "object" && session.payment_intent
          ? session.payment_intent
          : session.payment_intent
            ? await stripe.paymentIntents.retrieve(String(session.payment_intent))
            : null;
      const dest =
        pi && typeof pi.transfer_data?.destination === "string" ? pi.transfer_data.destination : null;
      const meta = pi?.metadata ?? session.metadata ?? {};
      evidence.unpaidProbe = {
        session: suffix(sid),
        dest: dest ? suffix(dest) : null,
        fee: pi?.application_fee_amount ?? null,
        routing: meta.caretipRoutingMode ?? null,
        charge: meta.caretipChargeModel ?? null,
        livemode: session.livemode,
      };
      const isGate5 =
        !dest &&
        (pi?.application_fee_amount == null || pi.application_fee_amount === 0) &&
        meta.caretipRoutingMode === "business_distribution" &&
        meta.caretipChargeModel === "platform_hold";
      if (isGate5) {
        deployed = true;
        sessionId = sid;
        checkoutUrl = url || session.url || "";
        break;
      }
      const stillOld =
        dest === biz.stripeAccountId || meta.caretipChargeModel === "destination_business";
      if (stillOld) {
        evidence.deployedCommit = "NOT_VERIFIED_STILL_PRE_GATE5";
        await sleep(25000);
        continue;
      }
      await sleep(15000);
    }

    if (!deployed || !checkoutUrl) {
      await renderJson("/api/me/connect/employee-tip-payout-mode", {
        method: "PATCH",
        token: mgr.token,
        body: JSON.stringify({ mode: originalMode }),
      });
      console.log(JSON.stringify({ ok: false, error: "DEPLOYMENT_NOT_VERIFIED", evidence }));
      process.exit(1);
    }
    evidence.deployedCommit = `BEHAVIOR_MATCHES_${EXPECTED_SHA}_health_has_no_sha`;

    const piId = await payCheckoutUrl(checkoutUrl, stripe, sessionId);
    if (!piId) {
      console.log(JSON.stringify({ ok: false, error: "gate5_unpaid", evidence }));
      process.exit(1);
    }
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] });
    const chargeId =
      typeof pi.latest_charge === "string"
        ? pi.latest_charge
        : pi.latest_charge && typeof pi.latest_charge === "object"
          ? pi.latest_charge.id
          : null;
    const charge = chargeId ? await stripe.charges.retrieve(chargeId) : null;
    evidence.gate5Pi = {
      id: suffix(pi.id),
      amount: pi.amount,
      currency: pi.currency,
      fee: pi.application_fee_amount ?? null,
      dest: pi.transfer_data?.destination ? suffix(String(pi.transfer_data.destination)) : null,
      routing: pi.metadata?.caretipRoutingMode ?? null,
      chargeModel: pi.metadata?.caretipChargeModel ?? null,
      livemode: pi.livemode,
    };
    evidence.gate5Charge = charge
      ? {
          id: suffix(charge.id),
          amount: charge.amount,
          dest: charge.destination ? suffix(String(charge.destination)) : null,
          appFee: charge.application_fee ?? charge.application_fee_amount ?? null,
          livemode: charge.livemode,
        }
      : null;

    const ledger = await waitForPayable(pi.id, 180000);
    const remaining = ledger.payable ? remainingPayableCents(ledger.payable) : null;
    evidence.gate5Ledger = ledger.payable
      ? {
          waitedMs: ledger.waitedMs,
          gross: ledger.payable.grossCents,
          fee: ledger.payable.platformFeeCents,
          payable: ledger.payable.payableCents,
          chargeModel: ledger.payable.chargeModel,
          routingMode: ledger.payable.routingMode,
          status: ledger.payable.status,
          transferred: ledger.payable.transferredCents,
          remaining,
          transfer: ledger.payable.stripeTransferId ? suffix(ledger.payable.stripeTransferId) : null,
        }
      : { waitedMs: ledger.waitedMs, missing: true };

    const destTransfers = chargeId
      ? await stripe.transfers.list({ limit: 20, expand: [] }).then(async () => {
          const list = await stripe.transfers.list({ limit: 100 });
          return list.data.filter((t) => t.source_transaction === chargeId);
        })
      : [];
    evidence.sourceTransfers = destTransfers.map((t) => ({
      id: suffix(t.id),
      amount: t.amount,
      dest: suffix(String(t.destination)),
    }));

    if (jordan.stripeAccount?.stripeAccountId) {
      const cap = await retrieveConnectCapabilitySnapshot(jordan.stripeAccount.stripeAccountId);
      evidence.jordanStripe = {
        payoutsEnabled: cap?.payoutsEnabled,
        status: cap?.status,
      };
    }

    const release1 = empAuth.token
      ? await renderJson("/api/me/employee-connect/status", { method: "GET", token: empAuth.token })
      : { status: 0, json: null };
    evidence.release1 = { status: release1.status };
    await sleep(4000);
    const afterRelease = await prisma.employeeTipPayable.findUnique({
      where: { transactionId: ledger.tx?.id ?? "" },
    });
    evidence.afterRelease = afterRelease
      ? {
          status: afterRelease.status,
          transferred: afterRelease.transferredCents,
          remaining: remainingPayableCents(afterRelease),
          transfer: afterRelease.stripeTransferId ? suffix(afterRelease.stripeTransferId) : null,
        }
      : null;

    const release2 = empAuth.token
      ? await renderJson("/api/me/employee-connect/status", { method: "GET", token: empAuth.token })
      : { status: 0, json: null };
    const release3 = empAuth.token
      ? await Promise.all([
          renderJson("/api/me/employee-connect/status", { method: "GET", token: empAuth.token }),
          renderJson("/api/me/employee-connect/status", { method: "GET", token: empAuth.token }),
        ])
      : [];
    evidence.releaseRepeat = { status2: release2.status, concurrent: release3.map((r) => r.status) };

    if (afterRelease?.stripeTransferId) {
      const tr = await stripe.transfers.retrieve(afterRelease.stripeTransferId);
      evidence.sct = {
        id: suffix(tr.id),
        amount: tr.amount,
        currency: tr.currency,
        dest: suffix(String(tr.destination)),
        source: tr.source_transaction ? suffix(String(tr.source_transaction)) : null,
        livemode: tr.livemode,
        payableMeta: tr.metadata ?? {},
      };
    }
    const xferCount = destTransfers.length + (afterRelease?.stripeTransferId ? 1 : 0);
    const allXfers = chargeId
      ? (await stripe.transfers.list({ limit: 100 })).data.filter((t) => t.source_transaction === chargeId)
      : [];
    evidence.transferCountForCharge = allXfers.length;
    evidence.transferAmounts = allXfers.map((t) => t.amount);

    const restore = await renderJson("/api/me/connect/employee-tip-payout-mode", {
      method: "PATCH",
      token: mgr.token,
      body: JSON.stringify({ mode: "direct_to_employee" }),
    });
    evidence.restoreDirect = { status: restore.status, body: restore.json };

    const directCreated = await createRenderCheckout(jordan.id, biz.id);
    const directSid =
      directCreated.json && typeof directCreated.json === "object" && "sessionId" in directCreated.json
        ? String((directCreated.json as { sessionId?: string }).sessionId ?? "")
        : "";
    const directUrl =
      directCreated.json && typeof directCreated.json === "object" && "url" in directCreated.json
        ? String((directCreated.json as { url?: string }).url ?? "")
        : "";
    if (directSid && directUrl) {
      const dSession = await stripe.checkout.sessions.retrieve(directSid, { expand: ["payment_intent"] });
      const dpi =
        typeof dSession.payment_intent === "object" && dSession.payment_intent
          ? dSession.payment_intent
          : null;
      evidence.directUnpaid = {
        dest: dpi?.transfer_data?.destination ? suffix(String(dpi.transfer_data.destination)) : null,
        fee: dpi?.application_fee_amount ?? null,
        routing: dpi?.metadata?.caretipRoutingMode ?? null,
        charge: dpi?.metadata?.caretipChargeModel ?? null,
      };
      const dpiId = await payCheckoutUrl(directUrl, stripe, directSid);
      if (dpiId) {
        const paid = await stripe.paymentIntents.retrieve(dpiId);
        evidence.directPaid = {
          id: suffix(paid.id),
          dest: paid.transfer_data?.destination ? suffix(String(paid.transfer_data.destination)) : null,
          fee: paid.application_fee_amount ?? null,
          routing: paid.metadata?.caretipRoutingMode ?? null,
          charge: paid.metadata?.caretipChargeModel ?? null,
          amount: paid.amount,
          livemode: paid.livemode,
        };
        const dLedger = await waitForPayable(paid.id, 120000);
        evidence.directLedger = dLedger.payable
          ? {
              routingMode: dLedger.payable.routingMode,
              chargeModel: dLedger.payable.chargeModel,
              payable: dLedger.payable.payableCents,
              status: dLedger.payable.status,
            }
          : null;
      }
    }

    if (sam?.id) {
      const unconn = await createRenderCheckout(sam.id, biz.id);
      const usid =
        unconn.json && typeof unconn.json === "object" && "sessionId" in unconn.json
          ? String((unconn.json as { sessionId?: string }).sessionId ?? "")
          : "";
      const uurl =
        unconn.json && typeof unconn.json === "object" && "url" in unconn.json
          ? String((unconn.json as { url?: string }).url ?? "")
          : "";
      evidence.unconnectedCreate = { status: unconn.status };
      if (usid && uurl) {
        const uPiId = await payCheckoutUrl(uurl, stripe, usid);
        if (uPiId) {
          const upi = await stripe.paymentIntents.retrieve(uPiId);
          evidence.unconnectedPi = {
            dest: upi.transfer_data?.destination ? suffix(String(upi.transfer_data.destination)) : null,
            fee: upi.application_fee_amount ?? null,
            routing: upi.metadata?.caretipRoutingMode ?? null,
            charge: upi.metadata?.caretipChargeModel ?? null,
            livemode: upi.livemode,
          };
          const uLedger = await waitForPayable(upi.id, 120000);
          evidence.unconnectedLedger = uLedger.payable
            ? {
                routingMode: uLedger.payable.routingMode,
                chargeModel: uLedger.payable.chargeModel,
                remaining: remainingPayableCents(uLedger.payable),
                transfer: uLedger.payable.stripeTransferId,
                status: uLedger.payable.status,
                payable: uLedger.payable.payableCents,
              }
            : null;
        }
      }
    }

    if (historical) {
      const again = await prisma.employeeTipPayable.findUnique({
        where: { id: historical.id },
        select: {
          routingMode: true,
          chargeModel: true,
          status: true,
          stripeDestinationAccountId: true,
          updatedAt: true,
        },
      });
      evidence.historicalAfter = again
        ? {
            routingMode: again.routingMode,
            chargeModel: again.chargeModel,
            status: again.status,
            dest: suffix(again.stripeDestinationAccountId),
            updatedAt: again.updatedAt.toISOString(),
            updatedUnchanged: again.updatedAt.getTime() === historical.updatedAt.getTime(),
          }
        : null;
    }

    const empForbidden = await renderJson("/api/me/connect/employee-tip-payout-mode", {
      method: "GET",
      token: empAuth.token,
    });
    const guestMode = await renderJson("/api/me/connect/employee-tip-payout-mode", {
      method: "PATCH",
      body: JSON.stringify({ mode: "business_distribution" }),
    });
    const steer = await renderJson(
      `/api/me/employee-connect/status?employeeId=${encodeURIComponent(sam?.id ?? "x")}&stripeAccountId=${encodeURIComponent(biz.stripeAccountId ?? "acct_x")}`,
      {
        method: "GET",
        token: empAuth.token,
      },
    );
    evidence.security = {
      employeeModeGet: empForbidden.status,
      guestModePatch: guestMode.status,
      employeeSteer: steer.status,
    };

    const gate5Pass =
      evidence.gate5Pi &&
      (evidence.gate5Pi as { dest: string | null; fee: number | null; routing: string | null }).dest == null &&
      ((evidence.gate5Pi as { fee: number | null }).fee == null ||
        (evidence.gate5Pi as { fee: number | null }).fee === 0) &&
      (evidence.gate5Ledger as { routingMode?: string; payable?: number; remaining?: number })
        .routingMode === "business_distribution" &&
      (evidence.gate5Ledger as { payable?: number }).payable === 851 &&
      (evidence.afterRelease as { remaining?: number; transferred?: number })?.remaining === 0 &&
      (evidence.afterRelease as { transferred?: number })?.transferred === 851 &&
      (evidence.sct as { amount?: number })?.amount === 851 &&
      (evidence.transferCountForCharge as number) === 1;

    evidence.gate5Acceptance = Boolean(gate5Pass);
    console.log(JSON.stringify({ ok: Boolean(gate5Pass), evidence }, null, 2));
    process.exit(gate5Pass ? 0 : 1);
  } finally {
    await renderJson("/api/me/connect/employee-tip-payout-mode", {
      method: "PATCH",
      token: mgr.token,
      body: JSON.stringify({ mode: "direct_to_employee" }),
    }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
