/**
 * Phase 32A — deployed Employee Instant + stripe-payouts live TEST.
 * One Instant payout create. No production money. No frontend/Netlify.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
const EXPECTED_SHA = "eb2169a2";
const EVIDENCE_DIR = join(process.cwd(), "..", "security-audit", "phase-32a-evidence");
const IDEMPOTENCY_KEY = "phase32a_jordan_instant_01";

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
    if (obj.startsWith("acct_") || obj.startsWith("ba_") || obj.startsWith("po_")) return suffix(obj);
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

async function main() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidence: Record<string, unknown> = {
    expectedSha: EXPECTED_SHA,
    minCents: EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS,
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
  };
  evidence.health = {
    status: health.status,
    database: health.database,
    environment: health.environment,
    uptime: health.uptime,
  };

  const jordanUser = await prisma.user.findUnique({ where: { email: JORDAN_EMAIL }, select: { id: true } });
  const jordan = jordanUser
    ? await prisma.employee.findFirst({
        where: { userId: jordanUser.id, isDeleted: false },
        select: {
          id: true,
          stripeAccount: { select: { stripeAccountId: true, stripePayoutsEnabled: true, stripeConnectStatus: true } },
        },
      })
    : null;
  const acct = jordan?.stripeAccount?.stripeAccountId ?? "";
  evidence.jordan = {
    employee: suffix(jordan?.id),
    acct: suffix(acct),
    status: jordan?.stripeAccount?.stripeConnectStatus,
    payoutsEnabled: jordan?.stripeAccount?.stripePayoutsEnabled,
  };

  const jordanAuth = await signin(JORDAN_EMAIL);
  const mgr = await signin(MANAGER_EMAIL);
  const samAuth = await signin(SAM_EMAIL);
  evidence.auth = {
    jordan: jordanAuth.status,
    manager: mgr.status,
    sam: samAuth.status,
    jordanHasToken: Boolean(jordanAuth.token),
  };

  const stripe = getStripeClient();
  let balanceBefore: Record<string, unknown> | null = null;
  let snapBefore: Record<string, unknown> | null = null;
  if (acct.startsWith("acct_")) {
    const cap = await retrieveConnectCapabilitySnapshot(acct);
    const bal = await stripe.balance.retrieve(
      { expand: ["instant_available.net_available"] },
      { stripeAccount: acct },
    );
    const instant = (bal.instant_available ?? []).find((x) => x.currency === "eur") ?? bal.instant_available?.[0];
    const netEntries = (
      instant as { net_available?: Array<{ amount: number; destination?: string }> } | undefined
    )?.net_available;
    const net = Array.isArray(netEntries) ? netEntries.reduce((s, n) => s + (n.amount ?? 0), 0) : 0;
    const gross = instant?.amount ?? 0;
    balanceBefore = {
      livemode: bal.livemode,
      available: bal.available.find((x) => x.currency === "eur")?.amount ?? 0,
      pending: bal.pending.find((x) => x.currency === "eur")?.amount ?? 0,
      instantGross: gross,
      instantNet: net,
      feeImplied: Math.max(0, gross - net),
      displayedFeeBps: gross > 0 ? Math.round(((gross - net) / gross) * 10_000) : null,
    };
    const evalSnap = await evaluateInstantPayoutForStripeAccount({
      stripeAccountId: acct,
      payoutsEnabledFallback: jordan?.stripeAccount?.stripePayoutsEnabled === true,
      minNetCents: EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS,
      logContext: { phase: "32a" },
    });
    snapBefore = {
      eligible: evalSnap.eligible,
      reason: evalSnap.reason,
      net: evalSnap.instantAvailableNetCents,
      gross: evalSnap.instantAvailableGrossCents,
      destLast4: evalSnap.destinationLast4,
      destKind: evalSnap.destinationKind,
      payoutsEnabled: evalSnap.payoutsEnabled,
      country: cap.country,
      livemode: cap.livemode,
    };
    evidence.capability = {
      livemode: cap.livemode,
      country: cap.country,
      payoutsEnabled: cap.payoutsEnabled,
      currentlyDue: cap.currentlyDue,
    };
  }
  evidence.balanceBefore = balanceBefore;
  evidence.snapBefore = snapBefore;

  const instantGet = await renderJson("/api/me/employee-connect/instant-payout", { token: jordanAuth.token });
  evidence.instantGet = { status: instantGet.status, body: redact(instantGet.json) };

  const guestInstant = await renderJson("/api/me/employee-connect/instant-payout", {});
  const mgrInstant = await renderJson("/api/me/employee-connect/instant-payout", { token: mgr.token });
  const mgrPayouts = await renderJson("/api/me/employee-connect/stripe-payouts", { token: mgr.token });
  const guestPayouts = await renderJson("/api/me/employee-connect/stripe-payouts", {});
  evidence.authz = {
    guestInstant: guestInstant.status,
    mgrInstant: mgrInstant.status,
    mgrPayouts: mgrPayouts.status,
    guestPayouts: guestPayouts.status,
  };

  const getBody = instantGet.json as {
    eligible?: boolean;
    instantAvailableNetCents?: number;
    instantAvailableGrossCents?: number;
    platformFeeCents?: number;
    displayedFeeBps?: number | null;
    feeConfigured?: boolean;
    feeSource?: string;
    minPayoutCents?: number;
    destinationLast4?: string | null;
  } | null;
  const netFromGet = Number(getBody?.instantAvailableNetCents ?? 0);
  const canCreate =
    instantGet.status === 200 &&
    getBody?.eligible === true &&
    netFromGet >= EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS;

  let instantPost: { status: number; json: unknown } | null = null;
  let instantReplay: { status: number; json: unknown } | null = null;
  if (canCreate) {
    instantPost = await renderJson("/api/me/employee-connect/instant-payout", {
      method: "POST",
      token: jordanAuth.token,
      body: JSON.stringify({ idempotencyKey: IDEMPOTENCY_KEY }),
    });
    instantReplay = await renderJson("/api/me/employee-connect/instant-payout", {
      method: "POST",
      token: jordanAuth.token,
      body: JSON.stringify({ idempotencyKey: IDEMPOTENCY_KEY }),
    });
  }
  evidence.instantPost = instantPost ? { status: instantPost.status, body: redact(instantPost.json) } : { skipped: true };
  evidence.instantReplay = instantReplay
    ? { status: instantReplay.status, body: redact(instantReplay.json) }
    : { skipped: true };

  const steer = await renderJson("/api/me/employee-connect/instant-payout", {
    method: "POST",
    token: jordanAuth.token,
    body: JSON.stringify({
      idempotencyKey: "phase32a_steer_denied_01",
      destination: "ba_attacker",
      employeeId: "emp_attacker",
      stripeAccountId: "acct_attacker",
      amount: 2999,
      fee: 250,
    }),
  });
  evidence.steering = { status: steer.status, body: redact(steer.json) };

  const postPayout = instantPost?.json as {
    payout?: { requestId?: string; amountCents?: number; currency?: string; status?: string };
  } | null;
  const requestId = postPayout?.payout?.requestId ?? null;
  let dbRequest: { stripePayoutId: string | null; amountCents: number; status: string } | null = null;
  if (requestId) {
    dbRequest = await prisma.employeeInstantPayoutRequest.findUnique({
      where: { id: requestId },
      select: { stripePayoutId: true, amountCents: true, status: true },
    });
  }
  evidence.dbRequest = dbRequest
    ? { payout: suffix(dbRequest.stripePayoutId), amountCents: dbRequest.amountCents, status: dbRequest.status }
    : null;

  let stripePayout: Record<string, unknown> | null = null;
  let balanceTxn: Record<string, unknown> | null = null;
  const poId = dbRequest?.stripePayoutId ?? "";
  if (poId.startsWith("po_") && acct.startsWith("acct_")) {
    const payout = await stripe.payouts.retrieve(poId, { expand: ["balance_transaction", "destination"] }, { stripeAccount: acct });
    const bt =
      payout.balance_transaction && typeof payout.balance_transaction === "object"
        ? payout.balance_transaction
        : null;
    stripePayout = {
      id: suffix(payout.id),
      livemode: payout.livemode,
      amount: payout.amount,
      currency: payout.currency,
      method: payout.method,
      status: payout.status,
      type: payout.type,
      arrivalDate: payout.arrival_date,
      applicationFee: payout.application_fee ?? null,
      dest:
        typeof payout.destination === "string"
          ? suffix(payout.destination)
          : payout.destination && typeof payout.destination === "object"
            ? suffix((payout.destination as { id?: string }).id)
            : null,
    };
    if (bt && "fee" in bt) {
      const details = Array.isArray(bt.fee_details)
        ? bt.fee_details.map((d) => ({
            type: d.type,
            amount: d.amount,
            currency: d.currency,
            description: d.description ?? null,
          }))
        : [];
      balanceTxn = {
        id: suffix(typeof bt.id === "string" ? bt.id : null),
        amount: bt.amount,
        fee: bt.fee,
        net: bt.net,
        currency: bt.currency,
        type: bt.type,
        reportingCategory: "reporting_category" in bt ? bt.reporting_category : null,
        feeDetails: details,
      };
    }
    const list = await stripe.payouts.list({ limit: 10 }, { stripeAccount: acct });
    evidence.stripePayoutList = {
      count: list.data.length,
      ids: list.data.map((p) => suffix(p.id)),
      methods: list.data.map((p) => p.method),
      amounts: list.data.map((p) => p.amount),
    };
    const bizRow = await prisma.stripeConnectPayout.findFirst({
      where: { stripePayoutId: poId },
      select: { id: true, businessId: true },
    });
    evidence.businessPayoutRowForEmployeePo = bizRow
      ? { id: suffix(bizRow.id), business: suffix(bizRow.businessId) }
      : null;
  }
  evidence.stripePayout = stripePayout;
  evidence.balanceTxn = balanceTxn;

  const history = await renderJson("/api/me/employee-connect/stripe-payouts", { token: jordanAuth.token });
  const samHistory = await renderJson("/api/me/employee-connect/stripe-payouts", { token: samAuth.token });
  const historySteer = await renderJson("/api/me/employee-connect/stripe-payouts?employeeId=x&stripeAccountId=acct_x", {
    token: jordanAuth.token,
  });
  evidence.history = { status: history.status, body: redact(history.json) };
  evidence.samHistory = { status: samHistory.status, body: redact(samHistory.json) };
  evidence.historySteer = { status: historySteer.status, body: redact(historySteer.json) };

  const bizInstant = await renderJson("/api/me/connect/instant-payout", { token: jordanAuth.token });
  evidence.employeeOnBusinessInstant = { status: bizInstant.status, body: redact(bizInstant.json) };

  if (acct.startsWith("acct_")) {
    const balAfter = await stripe.balance.retrieve(
      { expand: ["instant_available.net_available"] },
      { stripeAccount: acct },
    );
    const instant = (balAfter.instant_available ?? []).find((x) => x.currency === "eur") ?? balAfter.instant_available?.[0];
    const netEntries = (
      instant as { net_available?: Array<{ amount: number }> } | undefined
    )?.net_available;
    const net = Array.isArray(netEntries) ? netEntries.reduce((s, n) => s + (n.amount ?? 0), 0) : 0;
    evidence.balanceAfter = {
      available: balAfter.available.find((x) => x.currency === "eur")?.amount ?? 0,
      pending: balAfter.pending.find((x) => x.currency === "eur")?.amount ?? 0,
      instantGross: instant?.amount ?? 0,
      instantNet: net,
    };
  }

  const outPath = join(EVIDENCE_DIR, "phase-32a-backend-live.json");
  writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  const ok =
    health.status === "ok" &&
    instantGet.status === 200 &&
    (canCreate ? instantPost?.status === 200 && Boolean(poId.startsWith("po_")) : true);
  console.log(JSON.stringify({ ok, canCreate, outPath, instantGet: instantGet.status, post: instantPost?.status ?? null }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
