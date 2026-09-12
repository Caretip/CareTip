/**
 * Close remaining live TEST gaps against deployed Render (de587a49).
 * TEST 1: connected DIRECT_TO_EMPLOYEE tip via Render checkout.
 * TEST 2: Employee Instant POST if Instant net >= €30.
 * Prints suffixes only. Stripe TEST key required.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { chromium } from "@playwright/test";
import { EmployeeTipChargeModel, EmployeeTipPayoutMode, StripeConnectStatus } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { getStripeClient } from "../src/services/stripe.service.js";
import { EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS } from "../src/config/employeeInstantPayout.js";

const RENDER = "https://caretip.onrender.com";
const ORIGIN = "https://caretip.de";
const MANAGER_EMAIL = "mgr_p26_1786691378148@caretip-test.local";
const JORDAN_EMAIL = "jordan.p26_1786691378148@caretip-test.local";
const SAM_EMAIL = "sam.p26_1786691378148@caretip-test.local";
const PASSWORD = process.env.PHASE26_PASSWORD?.trim() || "Phase26E2E!23";

function suffix(id: string | null | undefined) {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 10 ? "(short)" : `…${s.slice(-8)}`;
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function renderJson(path: string, init: RequestInit & { token?: string } = {}) {
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
    json = { raw: text.slice(0, 180) };
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

async function fillHostedCheckout(page: import("@playwright/test").Page) {
  await page.waitForTimeout(2500);
  const email = page.locator('input[type="email"], input[name="email"]').first();
  if (await email.count()) {
    await email.fill("close-gaps-direct@caretip-test.local");
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
  await typeInto('[placeholder="1234 1234 1234 1234"]', "4242424242424242");
  if (!(await typeInto("#cardNumber", "4242424242424242"))) {
    for (const frame of page.frames()) {
      const number = frame.locator('input[name="cardnumber"], input[autocomplete="cc-number"]');
      if ((await number.count()) > 0) {
        await number.first().fill("4242424242424242");
        break;
      }
    }
  }
  await typeInto("#cardExpiry", "1230");
  await typeInto("#cardCvc", "123");
  await typeInto("#billingName", "Close Gaps Direct");
  await typeInto("#billingPostalCode", "10115");
  const pay = page.getByRole("button", { name: /pay|zahlen|submit|complete/i }).first();
  if (await pay.count()) await pay.click();
  await page.waitForTimeout(4000);
}

async function waitForPayable(piId: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tx = await prisma.transaction.findUnique({
      where: { stripePaymentIntentId: piId },
      select: { id: true, status: true, employeeId: true, businessId: true, amount: true },
    });
    if (tx) {
      const payable = await prisma.employeeTipPayable.findUnique({ where: { transactionId: tx.id } });
      if (payable) return { tx, payable, waitedMs: Date.now() - start };
    }
    await sleep(2500);
  }
  return { tx: null, payable: null, waitedMs: Date.now() - start };
}

async function instantNetForAccount(stripe: ReturnType<typeof getStripeClient>, acct: string) {
  const bal = await stripe.balance.retrieve(
    { expand: ["instant_available.net_available"] },
    { stripeAccount: acct },
  );
  const instant = (bal.instant_available ?? []).find((x) => x.currency === "eur") ?? bal.instant_available?.[0];
  const netEntries = (instant as { net_available?: Array<{ amount: number }> } | undefined)?.net_available;
  const net = Array.isArray(netEntries) ? netEntries.reduce((s, n) => s + (n.amount ?? 0), 0) : 0;
  const gross = instant?.amount ?? 0;
  return { livemode: bal.livemode, net, gross, available: bal.available.find((x) => x.currency === "eur")?.amount ?? 0 };
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    console.log("FAIL not_test_stripe_key");
    process.exit(1);
  }
  const stripe = getStripeClient();
  const health = (await fetch(`${RENDER}/api/health`).then((r) => r.json())) as {
    status?: string;
    database?: string;
    environment?: string;
    uptime?: number;
  };
  console.log(`health status=${health.status} db=${health.database} env=${health.environment} uptime=${health.uptime}`);

  const guestInstant = await renderJson("/api/me/employee-connect/instant-payout");
  console.log(`guest instant GET=${guestInstant.status}`);

  const jordanUser = await prisma.user.findUnique({ where: { email: JORDAN_EMAIL }, select: { id: true } });
  const jordan = jordanUser
    ? await prisma.employee.findFirst({
        where: { userId: jordanUser.id, isDeleted: false },
        select: {
          id: true,
          businessId: true,
          stripeAccount: {
            select: { stripeAccountId: true, stripeConnectStatus: true, stripePayoutsEnabled: true },
          },
        },
      })
    : null;
  if (!jordan?.id || !jordan.businessId) {
    console.log("FAIL jordan_missing");
    process.exit(1);
  }
  const biz = await prisma.business.findUnique({
    where: { id: jordan.businessId },
    select: { id: true, stripeAccountId: true, employeeTipPayoutMode: true },
  });
  if (!biz) {
    console.log("FAIL business_missing");
    process.exit(1);
  }
  const originalMode = biz.employeeTipPayoutMode;
  const jordanAcct = jordan.stripeAccount?.stripeAccountId ?? "";
  console.log(
    `jordan emp=${suffix(jordan.id)} acct=${suffix(jordanAcct)} status=${jordan.stripeAccount?.stripeConnectStatus} payouts=${jordan.stripeAccount?.stripePayoutsEnabled}`,
  );
  console.log(
    `jordan_biz=${suffix(biz.id)} bizAcct=${suffix(biz.stripeAccountId)} mode=${biz.employeeTipPayoutMode}`,
  );

  const ready = await prisma.employeeStripeAccount.findMany({
    where: {
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeAccountId: { startsWith: "acct_" },
      employee: { isDeleted: false, isActive: true },
    },
    select: {
      stripeAccountId: true,
      employeeId: true,
      employee: { select: { user: { select: { email: true } } } },
    },
    take: 20,
  });
  const balances: Array<{ email: string; acct: string; net: number; gross: number; emp: string }> = [];
  for (const row of ready) {
    const acct = row.stripeAccountId.trim();
    if (!acct.startsWith("acct_") || acct.includes("synthetic") || acct.length < 12) continue;
    try {
      const b = await instantNetForAccount(stripe, acct);
      if (b.livemode) {
        console.log(`SKIP live_mode_account ${suffix(acct)}`);
        continue;
      }
      balances.push({
        email: row.employee.user?.email ?? "(no-email)",
        acct,
        net: b.net,
        gross: b.gross,
        emp: row.employeeId,
      });
    } catch (err) {
      console.log(`balance_err emp=${suffix(row.employeeId)} ${err instanceof Error ? err.message : "fail"}`);
    }
  }
  balances.sort((a, b) => b.net - a.net);
  for (const b of balances) {
    console.log(`instant_scan email_suffix=${b.email.slice(-22)} emp=${suffix(b.emp)} acct=${suffix(b.acct)} net=${b.net} gross=${b.gross}`);
  }

  const mgr = await signin(MANAGER_EMAIL);
  const jordanAuth = await signin(JORDAN_EMAIL);
  const samAuth = await signin(SAM_EMAIL);
  console.log(`auth jordan=${jordanAuth.status} mgr=${mgr.status} sam=${samAuth.status}`);

  const mgrInstant = await renderJson("/api/me/employee-connect/instant-payout", { token: mgr.token });
  console.log(`manager employee-instant GET=${mgrInstant.status}`);

  let restored = false;
  const restoreMode = async () => {
    if (restored || originalMode === EmployeeTipPayoutMode.direct_to_employee) {
      restored = true;
      return;
    }
    await renderJson("/api/me/connect/employee-tip-payout-mode", {
      method: "PATCH",
      token: mgr.token,
      body: JSON.stringify({
        mode: originalMode === EmployeeTipPayoutMode.business_distribution ? "business_distribution" : "direct_to_employee",
      }),
    });
    restored = true;
    console.log(`restored_mode=${originalMode}`);
  };

  try {
    if (originalMode !== EmployeeTipPayoutMode.direct_to_employee) {
      const setDirect = await renderJson("/api/me/connect/employee-tip-payout-mode", {
        method: "PATCH",
        token: mgr.token,
        body: JSON.stringify({ mode: "direct_to_employee" }),
      });
      console.log(`set_direct status=${setDirect.status} bodyMode=${(setDirect.json as { mode?: string } | null)?.mode}`);
    } else {
      console.log("mode already direct_to_employee — no PATCH");
    }

    const created = await renderJson("/api/payments/create-tip-session", {
      method: "POST",
      body: JSON.stringify({
        amount: 10,
        tipAmount: 10,
        employeeId: jordan.id,
        businessId: biz.id,
        customerName: "Close Gaps Direct",
      }),
    });
    const sessionId =
      created.json && typeof created.json === "object" && "sessionId" in created.json
        ? String((created.json as { sessionId?: string }).sessionId ?? "")
        : "";
    const url =
      created.json && typeof created.json === "object" && "url" in created.json
        ? String((created.json as { url?: string }).url ?? "")
        : "";
    console.log(`checkout_create status=${created.status} session=${suffix(sessionId)}`);
    if (created.status >= 400 || !sessionId) {
      console.log(`TEST1 FAIL checkout_create ${JSON.stringify(created.json)}`);
      return;
    }

    const unpaid = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    const unpaidPi =
      typeof unpaid.payment_intent === "object" && unpaid.payment_intent
        ? unpaid.payment_intent
        : unpaid.payment_intent
          ? await stripe.paymentIntents.retrieve(String(unpaid.payment_intent))
          : null;
    const unpaidDest =
      unpaidPi && typeof unpaidPi.transfer_data?.destination === "string"
        ? unpaidPi.transfer_data.destination
        : null;
    console.log(
      `unpaid dest=${suffix(unpaidDest)} fee=${unpaidPi?.application_fee_amount ?? "none"} metaMode=${unpaidPi?.metadata?.caretipRoutingMode ?? unpaid.metadata?.caretipRoutingMode} charge=${unpaidPi?.metadata?.caretipChargeModel ?? unpaid.metadata?.caretipChargeModel} livemode=${unpaid.livemode}`,
    );

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    let piId: string | null = null;
    try {
      await page.goto(url || unpaid.url || "", { waitUntil: "domcontentloaded", timeout: 60000 });
      await fillHostedCheckout(page);
      const payStart = Date.now();
      while (Date.now() - payStart < 90000) {
        const again = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
        if (again.payment_status === "paid") {
          piId =
            typeof again.payment_intent === "string"
              ? again.payment_intent
              : again.payment_intent?.id ?? null;
          break;
        }
        await sleep(3000);
      }
    } finally {
      await browser.close();
    }

    if (!piId) {
      console.log("TEST1 FAIL hosted_checkout_not_paid");
      return;
    }
    const pi = await stripe.paymentIntents.retrieve(piId);
    const dest =
      typeof pi.transfer_data?.destination === "string" ? pi.transfer_data.destination : null;
    const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    let transferAmount: number | null = null;
    let transferDest: string | null = null;
    if (chargeId) {
      const charge = await stripe.charges.retrieve(chargeId, { expand: ["transfer"] });
      const tr = charge.transfer;
      if (tr && typeof tr === "object" && "amount" in tr) {
        transferAmount = Number(tr.amount);
        transferDest = typeof tr.destination === "string" ? tr.destination : dest;
      } else if (typeof tr === "string") {
        const t = await stripe.transfers.retrieve(tr);
        transferAmount = t.amount;
        transferDest = typeof t.destination === "string" ? t.destination : dest;
      }
    }
    console.log(
      `TEST1 pi=${suffix(pi.id)} charge=${suffix(chargeId)} dest=${suffix(dest)} fee=${pi.application_fee_amount} destTransfer=${transferAmount} status=${pi.status} livemode=${pi.livemode}`,
    );
    const destOk = dest === jordanAcct && dest !== biz.stripeAccountId;
    const feeOk = pi.application_fee_amount === 149;
    console.log(`TEST1 dest_is_employee=${destOk} dest_is_business=${dest === biz.stripeAccountId} fee_ok=${feeOk}`);

    const ledger = await waitForPayable(pi.id, 120000);
    console.log(
      `TEST1 webhook waited=${ledger.waitedMs} tx=${ledger.tx?.status ?? "MISSING"} payable=${
        ledger.payable
          ? `${ledger.payable.status}:${ledger.payable.routingMode}:${ledger.payable.chargeModel}:${ledger.payable.payableCents}`
          : "MISSING"
      } destStored=${suffix(ledger.payable?.stripeDestinationAccountId)}`,
    );
    const payableOk =
      ledger.tx?.status === "success" &&
      ledger.payable?.routingMode === EmployeeTipPayoutMode.direct_to_employee &&
      ledger.payable.chargeModel === EmployeeTipChargeModel.destination_employee &&
      ledger.payable.payableCents === 851 &&
      ledger.payable.stripeDestinationAccountId === jordanAcct;
    console.log(`TEST1 RESULT ${destOk && feeOk && pi.status === "succeeded" && payableOk ? "PASS" : "FAIL"}`);

    await restoreMode();

    const jordanInstant = await renderJson("/api/me/employee-connect/instant-payout", { token: jordanAuth.token });
    const ji = jordanInstant.json as {
      eligible?: boolean;
      reason?: string;
      instantAvailableNetCents?: number;
      minPayoutCents?: number;
    } | null;
    console.log(
      `jordan instant GET=${jordanInstant.status} eligible=${ji?.eligible} reason=${ji?.reason} net=${ji?.instantAvailableNetCents} min=${ji?.minPayoutCents}`,
    );

    const jordanBal = jordanAcct.startsWith("acct_") ? await instantNetForAccount(stripe, jordanAcct) : null;
    console.log(`jordan stripe instant net=${jordanBal?.net} gross=${jordanBal?.gross}`);

    const eligibleFixture = balances.find((b) => b.net >= EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS);
    const jordanEligible =
      jordanInstant.status === 200 &&
      ji?.eligible === true &&
      Number(ji.instantAvailableNetCents ?? 0) >= EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS;

    const steer = await renderJson("/api/me/employee-connect/instant-payout", {
      token: jordanAuth.token,
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `steer_close_gaps_${Date.now()}`,
        amount: 99999,
        destination: "acct_ATTACKER",
        employeeId: "other",
        businessId: "other",
      }),
    });
    console.log(`steer POST=${steer.status}`);

    const mgrPost = await renderJson("/api/me/employee-connect/instant-payout", {
      token: mgr.token,
      method: "POST",
      body: JSON.stringify({ idempotencyKey: `mgr_denied_${Date.now()}` }),
    });
    console.log(`manager instant POST=${mgrPost.status}`);

    const guestPost = await renderJson("/api/me/employee-connect/instant-payout", {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: `guest_denied_${Date.now()}` }),
    });
    console.log(`guest instant POST=${guestPost.status}`);

    if (!jordanEligible) {
      if (eligibleFixture) {
        console.log(
          `TEST2 BLOCKED — ENVIRONMENT Jordan net below min; another account net=${eligibleFixture.net} email_suffix=${eligibleFixture.email.slice(-22)} has no known Render password in this harness`,
        );
      } else {
        console.log(
          `TEST2 BLOCKED — ENVIRONMENT no TEST employee Instant net >= ${EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS} (Jordan net=${ji?.instantAvailableNetCents ?? jordanBal?.net})`,
        );
      }
      return;
    }

    const key = `close_gaps_instant_${Date.now()}`;
    const first = await renderJson("/api/me/employee-connect/instant-payout", {
      token: jordanAuth.token,
      method: "POST",
      body: JSON.stringify({ idempotencyKey: key }),
    });
    const second = await renderJson("/api/me/employee-connect/instant-payout", {
      token: jordanAuth.token,
      method: "POST",
      body: JSON.stringify({ idempotencyKey: key }),
    });
    const p1 = first.json as {
      payout?: {
        stripePayoutId?: string;
        amountCents?: number;
        currency?: string;
        method?: string;
        status?: string;
        requestId?: string;
      };
    } | null;
    const p2 = second.json as { payout?: { stripePayoutId?: string } } | null;
    const poId = p1?.payout?.stripePayoutId ?? "";
    console.log(
      `TEST2 POST first=${first.status} po=${suffix(poId)} amount=${p1?.payout?.amountCents} currency=${p1?.payout?.currency} method=${p1?.payout?.method} status=${p1?.payout?.status}`,
    );
    console.log(
      `TEST2 replay=${second.status} po=${suffix(p2?.payout?.stripePayoutId)} same=${poId === (p2?.payout?.stripePayoutId ?? "")}`,
    );

    if (poId.startsWith("po_") && jordanAcct.startsWith("acct_")) {
      const payout = await stripe.payouts.retrieve(
        poId,
        { expand: ["balance_transaction", "destination"] },
        { stripeAccount: jordanAcct },
      );
      const bt =
        payout.balance_transaction && typeof payout.balance_transaction === "object"
          ? payout.balance_transaction
          : null;
      console.log(
        `TEST2 stripe po=${suffix(payout.id)} livemode=${payout.livemode} amount=${payout.amount} currency=${payout.currency} method=${payout.method} status=${payout.status} dest=${
          typeof payout.destination === "string"
            ? suffix(payout.destination)
            : suffix((payout.destination as { id?: string } | null)?.id)
        }`,
      );
      if (bt && "fee" in bt) {
        console.log(`TEST2 bt amount=${bt.amount} fee=${bt.fee} net=${bt.net} currency=${bt.currency}`);
      }
      const list = await stripe.payouts.list({ limit: 8 }, { stripeAccount: jordanAcct });
      const sameKeyCount = list.data.filter((p) => p.id === poId).length;
      console.log(`TEST2 list_contains_po=${sameKeyCount} list_count=${list.data.length}`);
      const bizRow = await prisma.stripeConnectPayout.findFirst({
        where: { stripePayoutId: poId },
        select: { id: true },
      });
      console.log(`TEST2 business_stripeConnectPayout=${bizRow ? "CONTAMINATED" : "none"}`);
    }

    const hist = await renderJson("/api/me/employee-connect/stripe-payouts?take=20", { token: jordanAuth.token });
    const items = (hist.json as { items?: Array<{ stripePayoutId?: string; method?: string; amountCents?: number }> } | null)
      ?.items;
    const found = items?.some((it) => it.stripePayoutId === poId);
    console.log(`TEST2 history GET=${hist.status} contains_po=${found} items=${items?.length ?? 0}`);
    const samHist = await renderJson("/api/me/employee-connect/stripe-payouts?take=20", { token: samAuth.token });
    console.log(
      `sam history GET=${samHist.status} items=${(samHist.json as { items?: unknown[] } | null)?.items?.length ?? 0}`,
    );
    console.log(
      `TEST2 RESULT ${first.status === 200 && poId.startsWith("po_") && poId === (p2?.payout?.stripePayoutId ?? poId) ? "PASS" : "FAIL"}`,
    );
  } finally {
    await restoreMode();
  }
}

void main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
