/**
 * Phase 31 — deployed API probes + Stripe TEST inspect + browser UI.
 * Does not create Instant Payouts via Stripe SDK (production API only).
 * Stripe TEST key required.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { prisma } from "../src/prisma.js";
import { getStripeClient } from "../src/services/stripe.service.js";
import { retrieveConnectCapabilitySnapshot } from "../src/services/stripeConnect.service.js";
import { evaluateInstantPayoutForStripeAccount } from "../src/services/stripeConnectInstantPayout.service.js";
import { EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS } from "../src/config/employeeInstantPayout.js";

const RENDER = "https://caretip.onrender.com";
const ORIGIN = "https://caretip.de";
const MANAGER_EMAIL = "mgr_p26_1786691378148@caretip-test.local";
const JORDAN_EMAIL = "jordan.p26_1786691378148@caretip-test.local";
const SAM_EMAIL = "sam.p26_1786691378148@caretip-test.local";
const PASSWORD = process.env.PHASE26_PASSWORD?.trim() || "Phase26E2E!23";
const EVIDENCE_DIR = join(process.cwd(), "..", "security-audit", "phase-31-evidence");

function suffix(id: string | null | undefined) {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 10 ? "(short)" : `…${s.slice(-8)}`;
}

function redact(obj: unknown): unknown {
  if (obj == null) return obj;
  if (typeof obj === "string") {
    if (obj.startsWith("eyJ")) return "(jwt omitted)";
    if (obj.startsWith("sk_") || obj.startsWith("rk_") || obj.startsWith("whsec_")) return "(secret omitted)";
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(redact);
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (lk.includes("token") || lk.includes("password") || lk.includes("secret") || lk.includes("cookie")) {
        out[k] = "(omitted)";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return obj;
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

async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept|akzeptieren|ok|got it|verstanden/i }).first();
  if (await btn.count()) await btn.click({ timeout: 2000 }).catch(() => undefined);
}

async function loginEmployeeUi(page: import("@playwright/test").Page, email: string) {
  await page.goto(`${ORIGIN}/employee/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await dismissCookies(page);
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  await emailInput.waitFor({ timeout: 20000 });
  await emailInput.fill(email);
  const pw = page.locator('input[type="password"]').first();
  await pw.fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in|anmelden|einloggen/i }).first().click();
  await page.waitForURL(/\/employee(\/|$)/, { timeout: 45000 }).catch(() => undefined);
}

async function capturePayoutsPage(opts: {
  email: string;
  lang: "en" | "de";
  viewport: { width: number; height: number };
  file: string;
}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: opts.viewport,
    locale: opts.lang === "de" ? "de-DE" : "en-US",
  });
  await context.addInitScript((lang) => {
    localStorage.setItem("caretip_i18n_language", lang);
  }, opts.lang);
  const page = await context.newPage();
  const notes: string[] = [];
  try {
    await loginEmployeeUi(page, opts.email);
    await page.goto(`${ORIGIN}/employee/payouts`, { waitUntil: "networkidle", timeout: 60000 });
    await dismissCookies(page);
    await page.waitForTimeout(1500);
    const bodyText = ((await page.locator("body").innerText()) || "").slice(0, 8000);
    notes.push(`url=${page.url()}`);
    notes.push(`langAttr=${await page.locator("html").getAttribute("lang")}`);
    notes.push(`hasAcctId=${/acct_/.test(bodyText)}`);
    notes.push(`hasSk=${/sk_(live|test)_/.test(bodyText)}`);
    notes.push(`openDashboard=${/Open Stripe Dashboard|Stripe-Dashboard öffnen/i.test(bodyText)}`);
    notes.push(`updateDetails=${/Update Stripe details|Stripe-Daten aktualisieren/i.test(bodyText)}`);
    notes.push(`continueSetup=${/Continue setup|Einrichtung fortsetzen/i.test(bodyText)}`);
    notes.push(`connectStripe=${/Connect Stripe|Stripe verbinden/i.test(bodyText)}`);
    notes.push(`completeSetup=${/Complete Stripe setup|Stripe-Einrichtung abschließen/i.test(bodyText)}`);
    notes.push(`instantCard=${/Instant Payout|Sofortauszahlung/i.test(bodyText)}`);
    notes.push(`min30=${/€\s*30|30,00\s*€|€30/i.test(bodyText)}`);
    notes.push(`payableNote=${/payable record|Zahlungsverpflichtung|not a live Stripe/i.test(bodyText)}`);
    notes.push(`bankNote=${/Bank payouts are managed by Stripe|Bankauszahlungen verwaltet Stripe/i.test(bodyText)}`);
    notes.push(`overflowX=${await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)}`);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE_DIR, opts.file), fullPage: true });
    return { notes, snippet: bodyText.slice(0, 1200) };
  } finally {
    await browser.close();
  }
}

async function main() {
  const evidence: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    employeeInstantMinCents: EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS,
  };
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    console.log(JSON.stringify({ ok: false, error: "not_test_stripe_key" }));
    process.exit(1);
  }

  const health = (await fetch(`${RENDER}/api/health`).then((r) => r.json())) as {
    status?: string;
    database?: string;
    environment?: string;
    uptime?: number;
    version?: string;
    git?: string;
    commit?: string;
  };
  evidence.health = {
    status: health.status,
    database: health.database,
    environment: health.environment,
    uptime: health.uptime,
    version: health.version ?? null,
    git: health.git ?? null,
    commit: health.commit ?? null,
  };

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
  const samUser = await prisma.user.findUnique({ where: { email: SAM_EMAIL }, select: { id: true } });
  const sam = samUser
    ? await prisma.employee.findFirst({
        where: { userId: samUser.id, isDeleted: false },
        select: {
          id: true,
          stripeAccount: { select: { stripeAccountId: true, stripeConnectStatus: true, stripePayoutsEnabled: true } },
        },
      })
    : null;

  evidence.ids = {
    jordan: suffix(jordan?.id),
    jordanAcct: suffix(jordan?.stripeAccount?.stripeAccountId),
    sam: suffix(sam?.id),
    samAcct: suffix(sam?.stripeAccount?.stripeAccountId),
  };

  const mgr = await signin(MANAGER_EMAIL);
  const jordanAuth = await signin(JORDAN_EMAIL);
  const samAuth = await signin(SAM_EMAIL);
  evidence.auth = {
    manager: mgr.status,
    jordan: jordanAuth.status,
    sam: samAuth.status,
    tokensPresent: {
      manager: Boolean(mgr.token),
      jordan: Boolean(jordanAuth.token),
      sam: Boolean(samAuth.token),
    },
  };

  const jordanStatus = await renderJson("/api/me/employee-connect/status", { token: jordanAuth.token });
  const samStatus = await renderJson("/api/me/employee-connect/status", { token: samAuth.token });
  const jordanPayables = await renderJson("/api/me/employee-connect/payables", { token: jordanAuth.token });
  const instantGet = await renderJson("/api/me/employee-connect/instant-payout", { token: jordanAuth.token });
  const instantPost = await renderJson("/api/me/employee-connect/instant-payout", {
    method: "POST",
    token: jordanAuth.token,
    body: JSON.stringify({ amountCents: 3000, destination: "ba_fake", employeeId: "steal", stripeAccountId: "acct_fake" }),
  });
  const stripePayouts = await renderJson("/api/me/employee-connect/stripe-payouts", { token: jordanAuth.token });
  const guestInstant = await renderJson("/api/me/employee-connect/instant-payout", {});
  const mgrInstant = await renderJson("/api/me/employee-connect/instant-payout", { token: mgr.token });
  const samInstant = await renderJson("/api/me/employee-connect/instant-payout", { token: samAuth.token });
  const mgrPayouts = await renderJson("/api/me/employee-connect/stripe-payouts", { token: mgr.token });
  const guestPayouts = await renderJson("/api/me/employee-connect/stripe-payouts", {});

  evidence.deployedEmployeeApis = {
    jordanStatus: { status: jordanStatus.status, body: redact(jordanStatus.json) },
    samStatus: { status: samStatus.status, body: redact(samStatus.json) },
    jordanPayablesStatus: jordanPayables.status,
    instantGet: { status: instantGet.status, body: redact(instantGet.json) },
    instantPostSteering: { status: instantPost.status, body: redact(instantPost.json) },
    stripePayouts: { status: stripePayouts.status, body: redact(stripePayouts.json) },
    guestInstant: { status: guestInstant.status, body: redact(guestInstant.json) },
    managerInstant: { status: mgrInstant.status, body: redact(mgrInstant.json) },
    samInstant: { status: samInstant.status, body: redact(samInstant.json) },
    managerPayouts: { status: mgrPayouts.status, body: redact(mgrPayouts.json) },
    guestPayouts: { status: guestPayouts.status, body: redact(guestPayouts.json) },
  };

  const stripe = getStripeClient();
  const acctId = jordan?.stripeAccount?.stripeAccountId ?? "";
  if (acctId.startsWith("acct_")) {
    const acct = await stripe.accounts.retrieve(acctId);
    const snap = await retrieveConnectCapabilitySnapshot(acctId);
    const balance = await stripe.balance.retrieve({ expand: ["instant_available.net_available"] }, { stripeAccount: acctId });
    const payouts = await stripe.payouts.list({ limit: 10 }, { stripeAccount: acctId });
    const ext = await stripe.accounts.listExternalAccounts(acctId, { limit: 10 });
    const transfersStatus = acct.capabilities?.transfers;
    evidence.jordanStripe = {
      livemode: acct.livemode === true,
      country: acct.country,
      payoutsEnabled: acct.payouts_enabled === true,
      chargesEnabled: acct.charges_enabled === true,
      currentlyDueCount: acct.requirements?.currently_due?.length ?? 0,
      currentlyDueSample: (acct.requirements?.currently_due ?? []).slice(0, 8),
      transfersCapability: transfersStatus ?? null,
      snapshotStatus: snap?.status ?? null,
      snapshotPayoutsEnabled: snap?.payoutsEnabled ?? null,
      dbStatus: jordan?.stripeAccount?.stripeConnectStatus,
      dbPayoutsEnabled: jordan?.stripeAccount?.stripePayoutsEnabled,
    };
    evidence.jordanBalance = {
      livemode: (balance as { livemode?: boolean }).livemode ?? null,
      available: (balance.available ?? []).map((b) => ({ amount: b.amount, currency: b.currency })),
      pending: (balance.pending ?? []).map((b) => ({ amount: b.amount, currency: b.currency })),
      instantAvailable: (balance.instant_available ?? []).map((b) => ({
        amount: b.amount,
        currency: b.currency,
        netAvailable: (b as { net_available?: { amount: number; destination?: string; source_types?: unknown }[] }).net_available,
      })),
    };
    evidence.jordanExternalAccounts = (ext.data ?? []).map((ea) => ({
      object: ea.object,
      last4: "last4" in ea ? (ea as { last4?: string }).last4 : null,
      currency: "currency" in ea ? (ea as { currency?: string }).currency : null,
      availablePayoutMethods:
        "available_payout_methods" in ea ? (ea as { available_payout_methods?: string[] }).available_payout_methods : null,
    }));
    evidence.jordanPayoutsList = {
      count: payouts.data.length,
      livemodeAnyTrue: payouts.data.some((p) => p.livemode === true),
      items: payouts.data.map((p) => ({
        id: suffix(p.id),
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        method: p.method,
        livemode: p.livemode,
        arrivalDate: p.arrival_date,
        created: p.created,
      })),
    };
    const snapEval = await evaluateInstantPayoutForStripeAccount({
      stripeAccountId: acctId,
      payoutsEnabledFallback: jordan?.stripeAccount?.stripePayoutsEnabled === true,
      minNetCents: EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS,
      logContext: { phase: 31 },
    });
    evidence.localInstantSnapshot = {
      ...snapEval,
      stripeAccountId: suffix(snapEval.stripeAccountId),
      destinationId: suffix(snapEval.destinationId),
    };
  }

  const bizAcct = jordan
    ? await prisma.business.findUnique({
        where: { id: jordan.businessId },
        select: { stripeAccountId: true, employeeTipPayoutMode: true },
      })
    : null;
  evidence.businessMode = bizAcct?.employeeTipPayoutMode ?? null;
  evidence.businessAcct = suffix(bizAcct?.stripeAccountId);

  evidence.ui = {};
  const uiRuns = [
    { email: JORDAN_EMAIL, lang: "en" as const, viewport: { width: 1440, height: 900 }, file: "jordan-desktop-en.png" },
    { email: JORDAN_EMAIL, lang: "de" as const, viewport: { width: 1440, height: 900 }, file: "jordan-desktop-de.png" },
    { email: JORDAN_EMAIL, lang: "en" as const, viewport: { width: 390, height: 844 }, file: "jordan-mobile-en.png" },
    { email: JORDAN_EMAIL, lang: "de" as const, viewport: { width: 390, height: 844 }, file: "jordan-mobile-de.png" },
    { email: SAM_EMAIL, lang: "en" as const, viewport: { width: 1440, height: 900 }, file: "sam-desktop-en.png" },
    { email: SAM_EMAIL, lang: "de" as const, viewport: { width: 390, height: 844 }, file: "sam-mobile-de.png" },
  ];
  for (const run of uiRuns) {
    try {
      (evidence.ui as Record<string, unknown>)[run.file] = await capturePayoutsPage(run);
    } catch (err) {
      (evidence.ui as Record<string, unknown>)[run.file] = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  evidence.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, "probe.json"), JSON.stringify(redact(evidence), null, 2));
  console.log(JSON.stringify({ ok: true, evidence: redact(evidence) }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
