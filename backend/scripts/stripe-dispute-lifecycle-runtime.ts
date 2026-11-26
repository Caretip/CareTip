/**
 * Stripe dispute lifecycle: signed webhooks, projection, existing ledgers, evidence, recovery,
 * reconciliation, notifications and admin authorization — real routes, services, Stripe SDK and
 * database against a local fake Stripe server. Disposable database only:
 *   CARETIP_ISOLATED_POSTGRES_URL=... node scripts/safe-test.mjs test:stripe-dispute-lifecycle
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import Stripe from "stripe";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs with a disposable database");
  process.exit(1);
}
const WEBHOOK_SECRET = ["whsec", "dispute", "lifecycle", "test"].join("_");
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = WEBHOOK_SECRET + "_connect";
delete process.env.DISPUTE_TRANSFER_RECOVERY_ENABLED; // proves no switch is needed

// ───────────────────────── fake Stripe ─────────────────────────
type Bt = { amount: number; fee: number; currency?: string };
type FakeDispute = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  charge: string;
  payment_intent: string | null;
  reason: string;
  created: number;
  livemode: boolean;
  is_charge_refundable: boolean;
  balance_transactions: Bt[];
  evidence_details: { due_by: number | null; has_evidence: boolean; past_due: boolean; submission_count: number };
  evidence: Record<string, string>;
};
type FakeCharge = Record<string, unknown> & { id: string; amount: number };
type FakeTransfer = { id: string; amount: number; amount_reversed: number; destination?: string; currency?: string; reversals: Array<{ id: string; amount: number; metadata: Record<string, string> }> };
/** Available balance per connected account (GET /v1/balance with Stripe-Account). Default: plenty. */
const balances = new Map<string, number>();
const disputes = new Map<string, FakeDispute>();
const charges = new Map<string, FakeCharge>();
const transfers = new Map<string, FakeTransfer>();
/** Stripe saves the first result per idempotency key (success or error) and replays it; 429s are not saved. */
const idem = new Map<string, { status: number; body: unknown }>();
const idemHits: string[] = [];
const calls: Array<{ method: string; path: string }> = [];
const fault = {
  retrieveFails: 0,
  reversal: null as null | "insufficient" | "network" | "drop_before" | "unconfirmed",
  evidence: null as null | "reject" | "alter",
};
let seq = 0;
const send = (res: http.ServerResponse, status: number, body: unknown) => {
  const ck = (res as unknown as { __idem?: string }).__idem;
  if (ck && status !== 429) idem.set(ck, { status, body });
  res.writeHead(status, { "content-type": "application/json", "request-id": `req_fake_${++seq}` });
  res.end(JSON.stringify(body));
};
const err = (res: http.ServerResponse, status: number, type: string, code: string, message: string) =>
  send(res, status, { error: { type, code, message } });
function parseForm(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}
function disputeView(d: FakeDispute, expandCharge: boolean) {
  return {
    object: "dispute",
    ...d,
    charge: expandCharge ? charges.get(d.charge) ?? d.charge : d.charge,
    balance_transactions: d.balance_transactions.map((b, i) => ({ id: `txn_${d.id}_${i}`, object: "balance_transaction", currency: "eur", ...b })),
  };
}
const fake = http
  .createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname;
      const method = req.method ?? "GET";
      calls.push({ method, path });
      const parts = path.split("/").filter(Boolean); // v1, disputes, id ...
      const key = String(req.headers["idempotency-key"] ?? "");
      if (method === "POST" && key) {
        const ck = `${path} ${key}`;
        const cached = idem.get(ck);
        if (cached) {
          idemHits.push(ck);
          res.writeHead(cached.status, { "content-type": "application/json", "idempotent-replayed": "true" });
          return res.end(JSON.stringify(cached.body));
        }
        (res as unknown as { __idem?: string }).__idem = ck;
      }
      if (parts[1] === "disputes" && parts.length === 3 && method === "GET") {
        if (fault.retrieveFails > 0) {
          fault.retrieveFails--;
          return err(res, 500, "api_error", "", "temporary");
        }
        const d = disputes.get(parts[2]!);
        if (!d) return err(res, 404, "invalid_request_error", "resource_missing", "No such dispute");
        return send(res, 200, disputeView(d, url.searchParams.getAll("expand[]").includes("charge") || url.search.includes("charge")));
      }
      if (parts[1] === "disputes" && parts.length === 2 && method === "GET") {
        const data = [...disputes.values()].sort((a, b) => b.created - a.created).map((d) => disputeView(d, false));
        return send(res, 200, { object: "list", data, has_more: false });
      }
      if (parts[1] === "disputes" && parts.length === 3 && method === "POST") {
        const d = disputes.get(parts[2]!);
        if (!d) return err(res, 404, "invalid_request_error", "resource_missing", "No such dispute");
        if (fault.evidence === "reject") return err(res, 400, "invalid_request_error", "evidence_rejected", "This dispute is not accepting evidence");
        const form = parseForm(raw);
        for (const [k, v] of Object.entries(form)) {
          const m = /^evidence\[([a-z_]+)\]$/.exec(k);
          if (m) d.evidence[m[1]!] = fault.evidence === "alter" ? v.slice(0, 5) : v;
        }
        if (form.submit === "true") {
          d.evidence_details.submission_count++;
          d.evidence_details.has_evidence = true;
          d.status = d.status === "warning_needs_response" ? "warning_under_review" : "under_review";
        }
        return send(res, 200, disputeView(d, false));
      }
      if (parts[1] === "balance" && method === "GET") {
        const acct = String(req.headers["stripe-account"] ?? "");
        return send(res, 200, { object: "balance", available: [{ amount: balances.get(acct) ?? 1_000_000, currency: "eur" }], pending: [] });
      }
      if (parts[1] === "charges" && parts.length === 3 && method === "GET") {
        const c = charges.get(parts[2]!);
        if (!c) return err(res, 404, "invalid_request_error", "resource_missing", "No such charge");
        const d = [...disputes.values()].find((x) => x.charge === c.id);
        return send(res, 200, { ...c, disputed: Boolean(d), dispute: d ? disputeView(d, false) : null });
      }
      if (parts[1] === "transfers" && parts[2]) {
        const t = transfers.get(parts[2]);
        if (!t) return err(res, 404, "invalid_request_error", "resource_missing", "No such transfer");
        if (parts.length === 3 && method === "GET") {
          return send(res, 200, { id: t.id, object: "transfer", amount: t.amount, amount_reversed: t.amount_reversed, currency: t.currency ?? "eur", destination: t.destination ?? "acct_1Unknown0000" });
        }
        if (parts[3] === "reversals" && method === "GET") {
          return send(res, 200, { object: "list", data: t.reversals.map((r) => ({ object: "transfer_reversal", ...r })), has_more: false });
        }
        if (parts[3] === "reversals" && method === "POST") {
          if (fault.reversal === "drop_before") return req.socket.destroy(); // never executed, nothing saved
          if (fault.reversal === "insufficient") return err(res, 400, "invalid_request_error", "insufficient_funds", "Insufficient funds in the connected account");
          if (fault.reversal === "network") {
            const form = parseForm(raw);
            // Stripe did the reversal, but the reply never arrives.
            const amount = Number(form.amount);
            const meta: Record<string, string> = {};
            for (const [k, v] of Object.entries(form)) {
              const m = /^metadata\[(.+)\]$/.exec(k);
              if (m) meta[m[1]!] = v;
            }
            const r = { id: `trr_${t.id}_${t.reversals.length + 1}`, amount, metadata: meta };
            t.reversals.push(r);
            t.amount_reversed += amount;
            idem.set(`${path} ${key}`, { status: 200, body: { object: "transfer_reversal", transfer: t.id, ...r } });
            return req.socket.destroy();
          }
          const form = parseForm(raw);
          const amount = Number(form.amount);
          if (amount > t.amount - t.amount_reversed) return err(res, 400, "invalid_request_error", "amount_too_large", "Reversal exceeds transfer");
          const meta: Record<string, string> = {};
          for (const [k, v] of Object.entries(form)) {
            const m = /^metadata\[(.+)\]$/.exec(k);
            if (m) meta[m[1]!] = v;
          }
          const r = { id: `trr_${t.id}_${t.reversals.length + 1}`, amount, metadata: meta };
          // "unconfirmed": Stripe answers 200 but the reversal is not (yet) visible when read back.
          if (fault.reversal === "unconfirmed") return send(res, 200, { object: "transfer_reversal", transfer: t.id, ...r });
          t.reversals.push(r);
          t.amount_reversed += amount;
          return send(res, 200, { object: "transfer_reversal", transfer: t.id, ...r });
        }
      }
      return err(res, 404, "invalid_request_error", "resource_missing", `unhandled ${method} ${path}`);
    });
  })
  .listen(0, "127.0.0.1");
await new Promise((r) => fake.once("listening", r));

const { prisma } = await import("../src/prisma.js");
const { getStripeClient } = await import("../src/services/stripe.service.js");
const sdk = getStripeClient() as unknown as { _setApiField(k: string, v: unknown): void };
sdk._setApiField("host", "127.0.0.1");
sdk._setApiField("port", (fake.address() as AddressInfo).port);
sdk._setApiField("protocol", "http");
sdk._setApiField("maxNetworkRetries", 0);
sdk._setApiField("timeout", 2000);

const { default: webhookRoutes } = await import("../src/webhooks/stripe.webhook.js");
const { default: platformRoutes } = await import("../src/routes/platform.routes.js");
const { default: connectRoutes } = await import("../src/routes/connect.routes.js");
const { default: employeeConnectRoutes } = await import("../src/routes/employeeConnect.routes.js");
const { default: internalJobRoutes } = await import("../src/routes/internalJobs.routes.js");
const projection = await import("../src/services/disputes/stripeDisputeProjection.service.js");
const evidenceSvc = await import("../src/services/disputes/stripeDisputeEvidence.service.js");
const recoverySvc = await import("../src/services/disputes/stripeDisputeRecovery.service.js");
const reconcileSvc = await import("../src/services/disputes/stripeDisputeReconciliation.service.js");
const { authResultForUserId } = await import("../src/services/auth.service.js");
const { issueRefreshToken } = await import("../src/services/refreshToken.service.js");

const app = express();
app.use("/api/webhooks", express.raw({ type: "application/json" }), webhookRoutes);
app.use(express.json());
app.use("/api/platform", platformRoutes);
app.use("/api/me", connectRoutes);
app.use("/api/me", employeeConnectRoutes);
app.use("/api/internal/jobs", internalJobRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const stripeLib = new Stripe("sk_test_signing_only");

let eventSeq = 0;
async function deliver(type: string, disputeId: string, opts: { stale?: Partial<FakeDispute>; eventId?: string; signature?: string } = {}) {
  const d = disputes.get(disputeId)!;
  const payload = JSON.stringify({
    id: opts.eventId ?? `evt_${disputeId}_${++eventSeq}_${randomUUID().slice(0, 6)}`,
    object: "event",
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: { ...disputeView(d, false), ...(opts.stale ?? {}) } },
  });
  const sig = opts.signature ?? stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig }, body: payload });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

// ───────────────────────── fixtures ─────────────────────────
const tag = randomUUID().slice(0, 8);
let n = 0;
const uid = () => `${tag}${++n}`;
async function user(role: "MANAGER" | "SUPER_ADMIN" | "EMPLOYEE", extra: Record<string, unknown> = {}) {
  const u = await prisma.user.create({
    data: { email: `dl-${uid()}@test.local`, role, emailVerified: true, hasCompletedOnboarding: true, onboardingCompletedAt: new Date(), ...extra },
  });
  const rt = await issueRefreshToken(u.id);
  return { id: u.id, token: (await authResultForUserId(u.id, { refreshSessionId: rt.id })).token };
}
async function business() {
  const owner = await user("MANAGER");
  const acct = `acct_1Biz${uid()}`;
  const b = await prisma.business.create({ data: { name: `Disputed Venue ${uid()}`, slug: `dv-${uid()}`, userId: owner.id, stripeAccountId: acct, stripeCustomerId: `cus_${uid()}` } });
  return { ...b, owner, acct };
}
async function employeeOf(businessId: string, withAccount: boolean) {
  const e = await prisma.employee.create({ data: { name: `Staff ${uid()}`, jobTitle: "Server", businessId } });
  const acct = `acct_1Emp${uid()}`;
  if (withAccount) await prisma.employeeStripeAccount.create({ data: { employeeId: e.id, stripeAccountId: acct } });
  return { ...e, acct };
}
type Model = "dest_business" | "dest_employee" | "platform_hold";
async function tip(model: Model, opts: { amount?: number; fee?: number; refunded?: number; transferred?: number } = {}) {
  const b = await business();
  const e = await employeeOf(b.id, model === "dest_employee");
  const amount = opts.amount ?? 2000;
  const fee = opts.fee ?? 200;
  const pi = `pi_${uid()}`;
  const ch = `ch_${uid()}`;
  const tr = `tr_${uid()}`;
  const tx = await prisma.transaction.create({ data: { amount: amount / 100, businessId: b.id, employeeId: e.id, stripePaymentIntentId: pi, status: "success" } });
  const destination = model === "dest_business" ? b.acct : model === "dest_employee" ? e.acct : null;
  charges.set(ch, {
    id: ch,
    object: "charge",
    amount,
    amount_refunded: opts.refunded ?? 0,
    currency: "eur",
    created: Math.floor(Date.now() / 1000) - 3600,
    payment_intent: pi,
    customer: null,
    billing_details: { email: "guest@example.test", name: "Guest Name" },
    payment_method_details: { card: { brand: "visa", last4: "4242", checks: { cvc_check: "pass", address_postal_code_check: null } } },
    ...(destination ? { transfer_data: { destination }, transfer: tr, application_fee_amount: fee } : { transfer_data: null, transfer: null, application_fee_amount: null }),
  });
  if (destination) transfers.set(tr, { id: tr, amount, amount_reversed: opts.refunded ?? 0, destination, reversals: [] });
  let holdTransfer: string | null = null;
  if (model !== "dest_business") {
    const payableCents = amount - fee;
    const transferred = model === "platform_hold" ? opts.transferred ?? payableCents : 0;
    if (model === "platform_hold" && transferred > 0) {
      holdTransfer = `tr_hold_${uid()}`;
      transfers.set(holdTransfer, { id: holdTransfer, amount: transferred, amount_reversed: 0, destination: e.acct, reversals: [] });
    }
    await prisma.employeeTipPayable.create({
      data: {
        transactionId: tx.id,
        businessId: b.id,
        employeeId: e.id,
        routingMode: "direct_to_employee",
        chargeModel: model === "platform_hold" ? "platform_hold" : "destination_employee",
        status: model === "platform_hold" ? (transferred > 0 ? "transferred" : "held_platform") : "destination_settled",
        grossCents: amount,
        platformFeeCents: fee,
        payableCents,
        transferredCents: transferred,
        stripePaymentIntentId: pi,
        stripeChargeId: ch,
        stripeDestinationAccountId: model === "dest_employee" || holdTransfer ? e.acct : null,
        ...(holdTransfer ? { stripeTransferId: holdTransfer } : {}),
      },
    });
  }
  return { b, e, tx, pi, ch, tr, holdTransfer, amount, fee };
}
function openDispute(ch: string, pi: string | null, amount: number, extra: Partial<FakeDispute> = {}): FakeDispute {
  const d: FakeDispute = {
    id: `dp_${uid()}`,
    status: "needs_response",
    amount,
    currency: "eur",
    charge: ch,
    payment_intent: pi,
    reason: "fraudulent",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    is_charge_refundable: true,
    balance_transactions: [{ amount: -amount, fee: 1500 }],
    evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86400, has_evidence: false, past_due: false, submission_count: 0 },
    evidence: {},
    ...extra,
  };
  disputes.set(d.id, d);
  return d;
}
const row = (stripeDisputeId: string) => prisma.stripeDispute.findUniqueOrThrow({ where: { stripeDisputeId } });
const ledger = (stripeDisputeId: string) => prisma.tipRefund.findUnique({ where: { stripeDisputeId } });
const notes = (userId: string, like: string) =>
  prisma.notification.count({ where: { userId, dedupeKey: { contains: like } } });

const failures: string[] = [];
let count = 0;
async function test(name: string, fn: () => Promise<void>) {
  count++;
  fault.retrieveFails = 0;
  fault.reversal = null;
  fault.evidence = null;
  try {
    await fn();
    console.log(`PASS ${count}. ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL ${count}. ${name}: ${e instanceof Error ? e.message.split("\n").slice(0, 3).join(" ") : e}`);
  }
}

/** The admin approves (and the first attempt runs). Asking again when nothing is left is reported, not an error. */
const recover = (a: { disputeRowId: string; adminUserId: string; amountCents?: number }) =>
  recoverySvc.approveAndRecover(a).catch((e: { code?: string }) => {
    if (e?.code === "NOTHING_TO_APPROVE") return { attemptId: null, status: "nothing_to_recover" as const, amountCents: 0, recoveredCents: 0, targetCents: 0, outstandingCents: 0, nextRetryAt: null };
    throw e;
  });
const reversalPosts = () => calls.filter((c) => c.method === "POST" && c.path.includes("/reversals")).length;
const admin = await user("SUPER_ADMIN", { isPlatformAdmin: true, twoFactorEnabled: true, twoFactorSecret: "JBSWY3DPEHPK3PXP" });

// ───────────────────────── 1–10 webhook processing ─────────────────────────
const t1 = await tip("dest_business");
const d1 = openDispute(t1.ch, t1.pi, 2000);
await test("new dispute: signed webhook → projection from Stripe, ledger row, admin + business notified", async () => {
  const out = await deliver("charge.dispute.created", d1.id);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const r = await row(d1.id);
  assert.equal(r.stripeStatus, "needs_response");
  assert.equal(r.subjectKind, "tip_destination_business");
  assert.equal(r.businessId, t1.b.id);
  assert.equal(r.destinationTransferId, t1.tr);
  assert.equal(r.applicationFeeCents, 200);
  assert.equal(r.fundsWithdrawnCents, 2000);
  assert.equal(r.disputeFeeCents, 1500);
  assert.ok(r.evidenceDueBy);
  assert.equal((await ledger(d1.id))?.status, "needs_response");
  assert.equal(await notes(admin.id, `stripe_dispute:${r.id}:opened`), 1);
  assert.equal(await notes(t1.b.owner.id, `stripe_dispute_business:${r.id}:opened`), 1);
});
await test("duplicate dispute-created delivery (same event id) is acknowledged once, no second notification", async () => {
  const id = `evt_dup_${uid()}`;
  assert.equal((await deliver("charge.dispute.created", d1.id, { eventId: id })).status, 200);
  const again = await deliver("charge.dispute.created", d1.id, { eventId: id });
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  const r = await row(d1.id);
  assert.equal(await notes(admin.id, `stripe_dispute:${r.id}:opened`), 1);
});
await test("bad signature is refused before anything is read or written", async () => {
  const before = calls.length;
  const out = await deliver("charge.dispute.updated", d1.id, { signature: "t=1,v1=bad" });
  assert.equal(out.status, 400);
  assert.equal(calls.length, before);
});
await test("updated dispute: Stripe state wins over the event body", async () => {
  d1.evidence_details.due_by = Math.floor(Date.now() / 1000) + 3 * 86400;
  await deliver("charge.dispute.updated", d1.id, { stale: { status: "won" } as Partial<FakeDispute> });
  const r = await row(d1.id);
  assert.equal(r.stripeStatus, "needs_response", "the payload said won, Stripe says needs_response");
  assert.equal(r.evidenceDueBy?.getTime(), d1.evidence_details.due_by! * 1000);
});
const t5 = await tip("dest_business");
const d5 = openDispute(t5.ch, t5.pi, 2000);
await test("dispute won after funds were withdrawn: funds reinstated, won notification, recovery not required", async () => {
  await deliver("charge.dispute.created", d5.id);
  d5.status = "won";
  d5.balance_transactions.push({ amount: 2000, fee: -1500 });
  await deliver("charge.dispute.funds_reinstated", d5.id);
  await deliver("charge.dispute.closed", d5.id);
  const r = await row(d5.id);
  assert.equal(r.stripeStatus, "won");
  assert.equal(r.fundsReinstatedCents, 2000);
  assert.equal(r.disputeFeeCents, 0);
  assert.equal(r.recoveryStatus, "not_required");
  assert.equal((await ledger(d5.id))?.status, "won");
  assert.equal(await notes(admin.id, `stripe_dispute:${r.id}:funds_reinstated`), 1);
  assert.equal(await notes(admin.id, `stripe_dispute:${r.id}:won`), 1);
});
const t6 = await tip("dest_business");
const d6 = openDispute(t6.ch, t6.pi, 2000);
await test("dispute lost: projection + ledger lost, recovery flagged for review, nothing reversed automatically", async () => {
  await deliver("charge.dispute.created", d6.id);
  d6.status = "lost";
  await deliver("charge.dispute.closed", d6.id);
  const r = await row(d6.id);
  assert.equal(r.stripeStatus, "lost");
  assert.equal(r.recoveryStatus, "review_required");
  assert.equal(transfers.get(t6.tr)!.reversals.length, 0);
  assert.equal((await ledger(d6.id))?.status, "lost");
  assert.equal(await notes(admin.id, `stripe_dispute:${r.id}:lost`), 1);
});
await test("funds withdrawn event recorded from Stripe balance transactions", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 1500, { balance_transactions: [] });
  await deliver("charge.dispute.created", d.id);
  assert.equal((await row(d.id)).fundsWithdrawnCents, 0);
  d.balance_transactions.push({ amount: -1500, fee: 1500 });
  await deliver("charge.dispute.funds_withdrawn", d.id);
  const r = await row(d.id);
  assert.equal(r.fundsWithdrawnCents, 1500);
  assert.equal(r.balanceTransactionCount, 1);
});
await test("out-of-order: an older Stripe snapshot never overwrites newer state", async () => {
  const r0 = await row(d6.id);
  // Simulate a delayed read that returns the earlier Stripe state.
  const saved = { ...d6 };
  d6.status = "needs_response";
  const result = await projection.syncStripeDisputeFromStripe(d6.id, { source: "webhook" });
  Object.assign(d6, saved);
  assert.equal(result.outcome, "stale_ignored");
  const r = await row(d6.id);
  assert.equal(r.stripeStatus, "lost");
  assert.equal(r.updatedAt.getTime(), r0.updatedAt.getTime());
  assert.equal((await ledger(d6.id))?.status, "lost");
});
await test("temporary Stripe failure: webhook answers 500 (Stripe retries), error recorded on the dispute", async () => {
  fault.retrieveFails = 1;
  const out = await deliver("charge.dispute.updated", d1.id);
  assert.equal(out.status, 500);
  assert.ok((await row(d1.id)).lastSyncError);
});
await test("retry after the failed sync succeeds and clears the error", async () => {
  const out = await deliver("charge.dispute.updated", d1.id);
  assert.equal(out.status, 200);
  assert.equal((await row(d1.id)).lastSyncError, null);
});

// ───────────────────────── 11–17 classification ─────────────────────────
await test("destination-charge dispute (employee): associated with the employee account and tip", async () => {
  const t = await tip("dest_employee");
  const d = openDispute(t.ch, t.pi, 2000);
  await deliver("charge.dispute.created", d.id);
  const r = await row(d.id);
  assert.equal(r.subjectKind, "tip_destination_employee");
  assert.equal(r.employeeId, t.e.id);
  assert.equal(r.destinationAccountId, t.e.acct);
  assert.equal(r.transactionId, t.tx.id);
});
const t12 = await tip("platform_hold", { amount: 2000, fee: 200 });
const d12 = openDispute(t12.ch, t12.pi, 2000);
await test("separate charge and transfer: loss is recorded with its exposure, the employee transfer is NOT reversed by the webhook", async () => {
  await deliver("charge.dispute.created", d12.id);
  let r = await row(d12.id);
  assert.equal(r.subjectKind, "tip_platform_hold");
  assert.equal(r.destinationTransferId, null);
  d12.status = "lost";
  await deliver("charge.dispute.closed", d12.id);
  await deliver("charge.dispute.closed", d12.id);
  assert.equal(transfers.get(t12.holdTransfer!)!.reversals.length, 0, "no automatic reversal");
  r = await row(d12.id);
  assert.equal(r.stripeStatus, "lost");
  assert.equal(r.recoveryStatus, "review_required");
  assert.equal((await ledger(d12.id))?.status, "lost", "the loss is still recorded");
  const payable = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: t12.tx.id } });
  assert.equal(payable.disputedLostCents, 1800, "exposure recorded");
  assert.equal(payable.reversedCents, 0);
  const detail = await (await import("../src/services/disputes/stripeDisputeAdmin.service.js")).getDisputeDetailForAdmin(r.id);
  assert.equal(detail?.recoveryExposureCents, 1800);
});
await test("subscription dispute: platform sale, attributed to the subscriber, never to a tip beneficiary", async () => {
  const b = await business();
  const sub = await prisma.subscription.create({ data: { businessId: b.id, planKey: "premium", stripeCustomerId: b.stripeCustomerId } });
  const ch = `ch_sub_${uid()}`;
  charges.set(ch, { id: ch, object: "charge", amount: 2900, amount_refunded: 0, currency: "eur", created: 1, payment_intent: `pi_sub_${uid()}`, customer: b.stripeCustomerId, invoice: `in_${uid()}`, transfer_data: null, transfer: null, application_fee_amount: null });
  const d = openDispute(ch, charges.get(ch)!.payment_intent as string, 2900);
  await deliver("charge.dispute.created", d.id);
  const r = await row(d.id);
  assert.equal(r.subjectKind, "subscription");
  assert.equal(r.businessId, b.id);
  assert.equal(r.subscriptionId, sub.id);
  assert.equal(r.employeeId, null);
  assert.equal(r.recoveryStatus, "not_applicable");
  assert.equal(await notes(b.owner.id, `stripe_dispute_business:${r.id}`), 0, "the business itself disputed it: not told");
});
await test("QR print order dispute: classified as QR order and fed to the QR ledger", async () => {
  const b = await business();
  const pi = `pi_qr_${uid()}`;
  const order = await prisma.physicalQrOrder.create({
    data: { businessId: b.id, userId: b.owner.id, totalAmount: 1490, currency: "eur", placedAt: new Date(), processingClass: "SAME_DAY", processingDeadlineAt: new Date(), processingCopySnapshot: {}, businessNameSnapshot: b.name, stripePaymentIntentId: pi, paymentStatus: "PAID" },
  });
  const ch = `ch_qr_${uid()}`;
  charges.set(ch, { id: ch, object: "charge", amount: 1490, amount_refunded: 0, currency: "eur", created: 1, payment_intent: pi, customer: null, transfer_data: null, transfer: null, application_fee_amount: null });
  const d = openDispute(ch, pi, 1490);
  await deliver("charge.dispute.created", d.id);
  const r = await row(d.id);
  assert.equal(r.subjectKind, "physical_qr_order");
  assert.equal(r.physicalQrOrderId, order.id);
  assert.ok(await prisma.physicalQrPaymentAdjustment.findUnique({ where: { stripeDisputeId: d.id } }));
  assert.equal((await prisma.physicalQrOrder.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus, "DISPUTED");
});
await test("correct business association comes from the tip's PaymentIntent, not from metadata or email", async () => {
  const r = await row(d1.id);
  assert.equal(r.businessId, t1.b.id);
  assert.equal(r.transactionId, t1.tx.id);
});
await test("destination that is neither the business's nor the employee's account: kept for review, not recoverable", async () => {
  const t = await tip("dest_business");
  charges.get(t.ch)!.transfer_data = { destination: "acct_1SomeoneElse0000" };
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  const r = await row(d.id);
  assert.equal(r.subjectKind, "unattributed");
  assert.equal(r.recoveryStatus, "review_required");
  await assert.rejects(recover({ disputeRowId: r.id, adminUserId: admin.id }), /switched off|no verified/);
});
await test("tenant isolation: a business manager or employee cannot reach any dispute endpoint", async () => {
  const r = await row(d1.id);
  const employee = await user("EMPLOYEE");
  for (const token of [t1.b.owner.token, employee.token]) {
    for (const [method, path] of [["GET", "/api/platform/disputes"], ["GET", `/api/platform/disputes/${r.id}`], ["POST", `/api/platform/disputes/${r.id}/recovery`], ["POST", `/api/platform/disputes/${r.id}/evidence/submit`]] as const) {
      const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: method === "POST" ? JSON.stringify({ confirm: true }) : undefined });
      assert.ok(res.status === 401 || res.status === 403, `${method} ${path} -> ${res.status}`);
    }
  }
});

// ───────────────────────── 18–21 evidence ─────────────────────────
await test("evidence preparation: only facts from Stripe and CareTip, no claims of service or authorisation", async () => {
  const r = await row(d1.id);
  const s = await evidenceSvc.buildEvidenceSuggestion(r.id);
  assert.equal(s.draft.customer_email_address, "guest@example.test");
  assert.match(s.draft.product_description ?? "", /Voluntary tip/);
  assert.match(s.draft.uncategorized_text ?? "", /CVC check pass/);
  assert.match(s.draft.uncategorized_text ?? "", /No refund has been issued/);
  for (const v of Object.values(s.draft)) assert.doesNotMatch(String(v), /authori[sz]ed|was delivered|refund was (refused|denied)/i);
  assert.equal(s.draft.service_date, undefined);
  assert.throws(() => evidenceSvc.sanitizeEvidenceDraft({ receipt: "file_123" }), /Unsupported evidence field/);
});
await test("evidence submission: requires the reviewed version, sent to Stripe, confirmed from Stripe", async () => {
  const r = await row(d1.id);
  const saved = await evidenceSvc.saveEvidenceDraft({ disputeRowId: r.id, adminUserId: admin.id, draft: { product_description: "Voluntary tip.", uncategorized_text: "Payment facts." } });
  await assert.rejects(evidenceSvc.submitEvidence({ disputeRowId: r.id, adminUserId: admin.id, reviewedHash: "old" }), /changed since you reviewed/);
  const out = await evidenceSvc.submitEvidence({ disputeRowId: r.id, adminUserId: admin.id, reviewedHash: saved.hash });
  assert.equal(out.confirmed, true);
  assert.equal(disputes.get(d1.id)!.evidence.product_description, "Voluntary tip.");
  const after = await row(d1.id);
  assert.equal(after.stripeStatus, "under_review");
  assert.equal(after.evidenceSubmissionCount, 1);
  assert.ok(after.evidenceSubmittedAt);
  assert.equal(after.investigationStatus, "awaiting_stripe_decision");
  assert.equal(out.verified, true, "Stripe stored exactly the reviewed text");
  assert.ok(after.evidenceVerifiedAt);
  assert.deepEqual(after.evidenceVerificationMismatch, []);
});
await test("evidence deadline passed: refused locally, nothing sent", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000, { evidence_details: { due_by: Math.floor(Date.now() / 1000) - 60, has_evidence: false, past_due: true, submission_count: 0 } });
  await deliver("charge.dispute.created", d.id);
  const r = await row(d.id);
  const saved = await evidenceSvc.saveEvidenceDraft({ disputeRowId: r.id, adminUserId: admin.id, draft: { uncategorized_text: "x" } });
  const before = calls.filter((c) => c.method === "POST" && c.path.includes("/disputes/")).length;
  await assert.rejects(evidenceSvc.submitEvidence({ disputeRowId: r.id, adminUserId: admin.id, reviewedHash: saved.hash }), /deadline has passed/);
  assert.equal(calls.filter((c) => c.method === "POST" && c.path.includes("/disputes/")).length, before);
});
await test("evidence submission failure: error stored, admins notified, status unchanged", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000);
  await deliver("charge.dispute.created", d.id);
  const r = await row(d.id);
  const saved = await evidenceSvc.saveEvidenceDraft({ disputeRowId: r.id, adminUserId: admin.id, draft: { uncategorized_text: "x" } });
  fault.evidence = "reject";
  await assert.rejects(evidenceSvc.submitEvidence({ disputeRowId: r.id, adminUserId: admin.id, reviewedHash: saved.hash }), /not accepting evidence/);
  const after = await row(d.id);
  assert.ok(after.evidenceLastError);
  assert.equal(after.stripeStatus, "needs_response");
  assert.equal(after.evidenceSubmittedAt, null);
  assert.equal(await notes(admin.id, `stripe_dispute:${r.id}:evidence_failed`), 1);
});

// ───────────────────────── 22–25 destination recovery ─────────────────────────
await test("recovery is available by default (no feature switch) but only through an admin approval", async () => {
  assert.equal(process.env.DISPUTE_TRANSFER_RECOVERY_ENABLED, undefined);
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  assert.equal(transfers.get(t.tr)!.reversals.length, 0, "the loss alone moves nothing");
  const out = await recover({ disputeRowId: (await row(d.id)).id, adminUserId: admin.id });
  assert.equal(out.status, "succeeded");
  const after = await row(d.id);
  assert.equal(after.recoveryApprovedBy, admin.id);
  assert.equal(after.recoveryApprovedCents, 1800);
  assert.equal(after.recoveryPolicyVersion, "stage1-2026-11-26");
  assert.equal(after.recoveryTransferId, t.tr);
  assert.equal(after.recoveryConnectedAccountId, t.b.acct);
  assert.equal(after.recoveryStatus, "recovered");
  assert.equal(await prisma.auditLog.count({ where: { action: "stripe_dispute.recovery_approved", userId: admin.id, metadata: { contains: d.id } } }), 1);
});
await test("transfer already reversed by a refund: nothing to recover, no reversal call", async () => {
  const t = await tip("dest_business", { refunded: 2000 });
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  const r = await row(d.id);
  const out = await recover({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(out.status, "nothing_to_recover");
  assert.equal(transfers.get(t.tr)!.reversals.length, 0);
});
await test("recovery reverses only the beneficiary share (dispute minus CareTip fee); partial amounts add up", async () => {
  const r = await row(d6.id);
  balances.set(t6.b.acct, 500); // only 5 € available: partial, never below the available balance
  const first = await recover({ disputeRowId: r.id, adminUserId: admin.id });
  balances.delete(t6.b.acct);
  assert.equal(first.amountCents, 500);
  assert.equal(first.outstandingCents, 1300);
  assert.ok(first.nextRetryAt, "the rest is scheduled within the approval");
  assert.equal(first.status, "succeeded");
  assert.equal((await row(d6.id)).recoveryStatus, "partially_recovered");
  const second = await recover({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(second.amountCents, 1300);
  const t = transfers.get(t6.tr)!;
  assert.equal(t.amount_reversed, 1800);
  const after = await row(d6.id);
  assert.equal(after.recoveredCents, 1800);
  assert.equal(after.recoveryStatus, "recovered");
  const attempts = await prisma.stripeDisputeRecoveryAttempt.findMany({ where: { disputeId: r.id } });
  assert.ok(attempts.every((a) => a.status === "succeeded" && a.stripeReversalId?.startsWith("trr_")));
});
const t24 = await tip("dest_employee");
const d24 = openDispute(t24.ch, t24.pi, 2000, { status: "lost" });
await test("Stripe refuses for insufficient funds: outstanding (not success, not final), retry scheduled, admins notified once", async () => {
  await deliver("charge.dispute.closed", d24.id);
  const r = await row(d24.id);
  fault.reversal = "insufficient";
  const out = await recover({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(out.status, "failed", "the attempt itself failed");
  const after = await row(d24.id);
  assert.equal(after.recoveryStatus, "outstanding");
  assert.equal(after.recoveredCents, 0);
  assert.equal(after.recoveryLastFailureCode, "insufficient_funds");
  assert.ok(after.recoveryNextRetryAt && after.recoveryNextRetryAt > new Date());
  assert.equal(await notes(admin.id, `stripe_dispute:${r.id}:recovery_insufficient_funds`), 1);
});
await test("duplicate recovery requests (concurrent and repeated): one reversal, never above the share", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  const r = await row(d.id);
  const outs = await Promise.allSettled([1, 2, 3].map(() => recover({ disputeRowId: r.id, adminUserId: admin.id })));
  await recover({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(transfers.get(t.tr)!.reversals.length, 1, JSON.stringify(outs.map((o) => o.status)));
  assert.equal(transfers.get(t.tr)!.amount_reversed, 1800);
});

// ───────────────────────── 26–31 refunds vs disputes ─────────────────────────
await test("refund before dispute: the refund is not recovered again by the dispute", async () => {
  const t = await tip("dest_business", { refunded: 1000 });
  const d = openDispute(t.ch, t.pi, 1000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  const r = await row(d.id);
  await recover({ disputeRowId: r.id, adminUserId: admin.id });
  const tr = transfers.get(t.tr)!;
  assert.equal(tr.amount_reversed, 1000 + 900, "refund reversal + share of the disputed 10 €");
  assert.ok(tr.amount_reversed <= tr.amount);
});
await test("dispute after refund: ledgers keep refund and dispute apart", async () => {
  const t = await tip("dest_employee", { refunded: 500 });
  const d = openDispute(t.ch, t.pi, 1500);
  await deliver("charge.dispute.created", d.id);
  const l = await ledger(d.id);
  assert.equal(l?.kind, "dispute");
  assert.equal(Number(l?.amountEur), 15);
  assert.equal((await row(d.id)).chargeAmountRefundedCents, 500);
});
await test("dispute while a refund is pending: no money moves on the open dispute", async () => {
  const t = await tip("platform_hold");
  const d = openDispute(t.ch, t.pi, 2000);
  await deliver("charge.dispute.created", d.id);
  assert.equal(transfers.get(t.holdTransfer!)!.reversals.length, 0);
  const payable = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: t.tx.id } });
  assert.equal(payable.reversedCents, 0);
  assert.ok(payable.disputedOpenCents > 0);
});
await test("dispute won after withdrawal: no recovery possible", async () => {
  const r = await row(d5.id);
  await assert.rejects(recover({ disputeRowId: r.id, adminUserId: admin.id }), /only possible after Stripe closes the dispute as lost/);
  assert.equal(transfers.get(t5.tr)!.reversals.length, 0);
});
await test("dispute lost after a previous recovery: totals come from Stripe reversals, no second reversal", async () => {
  const before = transfers.get(t6.tr)!.reversals.length;
  const out = await recover({ disputeRowId: (await row(d6.id)).id, adminUserId: admin.id });
  assert.equal(out.status, "nothing_to_recover");
  assert.equal(transfers.get(t6.tr)!.reversals.length, before);
  assert.equal((await row(d6.id)).recoveredCents, 1800);
});
await test("recovery whose reply was lost: reconciliation finds the Stripe reversal; retry never doubles it", async () => {
  const r = await row(d24.id);
  fault.reversal = "network";
  const out = await recover({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(out.status, "succeeded", "the follow-up read found the reversal Stripe made");
  fault.reversal = null;
  await prisma.stripeDispute.update({ where: { id: r.id }, data: { updatedAt: new Date(Date.now() - 600_000) } });
  await recoverySvc.reconcileOpenRecoveryAttempts();
  await recover({ disputeRowId: r.id, adminUserId: admin.id });
  const tr = transfers.get(t24.tr)!;
  assert.equal(tr.reversals.length, 1);
  assert.equal(tr.amount_reversed, 1800);
  assert.equal((await row(d24.id)).recoveryStatus, "recovered");
});

// ───────────────────────── 32–35 reconciliation, concurrency, authorization ─────────────────────────
await test("Stripe/local disagreement: reconciliation re-reads and Stripe wins", async () => {
  await prisma.stripeDispute.update({ where: { stripeDisputeId: d1.id }, data: { stripeStatus: "needs_response", evidenceSubmissionCount: 0 } });
  const out = await reconcileSvc.tickStripeDisputeReconciliation();
  assert.ok(out.driftSynced >= 1, JSON.stringify(out));
  assert.equal((await row(d1.id)).stripeStatus, "under_review");
});
await test("missing webhook: a dispute only in Stripe is found by reconciliation (internal job route)", async () => {
  const t = await tip("dest_employee");
  const d = openDispute(t.ch, t.pi, 2000);
  const unauth = await fetch(`${base}/api/internal/jobs/dispute-reconciliation-tick`, { method: "POST" });
  assert.equal(unauth.status, 401);
  const out = await reconcileSvc.tickStripeDisputeReconciliation();
  assert.ok(out.missingSynced >= 1);
  assert.equal((await row(d.id)).subjectKind, "tip_destination_employee");
});
await test("concurrent deliveries of different events for one dispute: one row, consistent final state", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000);
  d.status = "lost";
  const outs = await Promise.all(["charge.dispute.created", "charge.dispute.updated", "charge.dispute.funds_withdrawn", "charge.dispute.closed"].map((ty) => deliver(ty, d.id)));
  assert.ok(outs.every((o) => o.status === 200 || o.status === 503), outs.map((o) => o.status).join());
  assert.equal(await prisma.stripeDispute.count({ where: { stripeDisputeId: d.id } }), 1);
  assert.equal((await row(d.id)).stripeStatus, "lost");
  assert.equal(await prisma.tipRefund.count({ where: { stripeDisputeId: d.id } }), 1);
});
await test("admin API: Stripe-owned fields cannot be edited; client transfer ids rejected; recovery needs confirmation and the switch", async () => {
  const r = await row(d1.id);
  const h = { authorization: `Bearer ${admin.token}`, "content-type": "application/json" };
  const edit = await fetch(`${base}/api/platform/disputes/${r.id}/internal`, { method: "PATCH", headers: h, body: JSON.stringify({ stripeStatus: "won" }) });
  assert.equal(edit.status, 400);
  assert.equal((await row(d1.id)).stripeStatus, "under_review");
  const ok = await fetch(`${base}/api/platform/disputes/${r.id}/internal`, { method: "PATCH", headers: h, body: JSON.stringify({ investigationStatus: "investigating", internalNotes: "checked receipt" }) });
  assert.equal(ok.status, 200);
  const r6 = await row(d6.id);
  const noConfirm = await fetch(`${base}/api/platform/disputes/${r6.id}/recovery`, { method: "POST", headers: h, body: "{}" });
  assert.equal(noConfirm.status, 400);
  const clientId = await fetch(`${base}/api/platform/disputes/${r6.id}/recovery`, { method: "POST", headers: h, body: JSON.stringify({ confirm: true, transferId: "tr_attacker" }) });
  assert.equal(clientId.status, 400);
  for (const p of ["recovery/retry", "recovery/cancel"]) {
    const noConfirmP = await fetch(`${base}/api/platform/disputes/${r6.id}/${p}`, { method: "POST", headers: h, body: "{}" });
    assert.equal(noConfirmP.status, 400, p);
  }
  const ctx = await fetch(`${base}/api/platform/disputes/${r6.id}/recovery/context`, { headers: h });
  assert.equal(ctx.status, 200);
  const ctxBody = (await ctx.json()) as { transferRemainingCents: number; connectedAvailableCents: number; recoveredForThisDisputeCents: number };
  assert.equal(ctxBody.recoveredForThisDisputeCents, 1800);
  const list = await fetch(`${base}/api/platform/disputes?view=lost`, { headers: h });
  assert.equal(list.status, 200);
  const body = (await list.json()) as { items: Array<{ stripeStatus: string }> };
  assert.ok(body.items.length > 0 && body.items.every((i) => i.stripeStatus === "lost"));
  const detail = (await (await fetch(`${base}/api/platform/disputes/${r.id}`, { headers: h })).json()) as Record<string, unknown>;
  assert.equal(detail.notifiedKeys, undefined);
  assert.equal(detail.internalNotes, "checked receipt");
});

// ───────────────────────── 37–48 recovery policy, D1, D3–D6 ─────────────────────────
const t37 = await tip("platform_hold");
const d37 = openDispute(t37.ch, t37.pi, 2000, { status: "lost" });
await test("reconciliation finds a missed platform-hold loss: recorded, NOT reversed", async () => {
  await reconcileSvc.tickStripeDisputeReconciliation();
  const r = await row(d37.id);
  assert.equal(r.stripeStatus, "lost");
  assert.equal(r.recoveryStatus, "review_required");
  assert.equal(transfers.get(t37.holdTransfer!)!.reversals.length, 0);
});
await test("admin sync of a lost platform-hold dispute: NOT reversed", async () => {
  const r = await row(d37.id);
  const res = await fetch(`${base}/api/platform/disputes/${r.id}/sync`, { method: "POST", headers: { authorization: `Bearer ${admin.token}`, "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 200);
  assert.equal(transfers.get(t37.holdTransfer!)!.reversals.length, 0);
});
await test("tip backfill of a lost platform-hold dispute: NOT reversed", async () => {
  const t = await tip("platform_hold");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  const { applyExistingStripeDisputeAfterSuccessfulTip } = await import("../src/services/finance/tipRefunds.service.js");
  await applyExistingStripeDisputeAfterSuccessfulTip({ paymentIntentId: t.pi, stripeChargeId: t.ch });
  assert.equal((await row(d.id)).stripeStatus, "lost");
  assert.equal(transfers.get(t.holdTransfer!)!.reversals.length, 0);
});
await test("explicit admin recovery of a platform-hold loss: one reversal, capped, recorded on the payable", async () => {
  const r = await row(d12.id);
  const out = await recover({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(out.status, "succeeded");
  const tr = transfers.get(t12.holdTransfer!)!;
  assert.equal(tr.amount_reversed, 1800);
  assert.equal(tr.reversals[0]!.metadata.caretip_stripe_dispute_id, d12.id);
  const payable = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: t12.tx.id } });
  assert.equal(payable.reversedCents, 1800);
  assert.equal((await row(d12.id)).recoveryStatus, "recovered");
  const again = await recover({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(again.status, "nothing_to_recover");
  assert.equal(tr.reversals.length, 1);
});
await test("refund reversal still automatic and kept apart from chargeback recovery", async () => {
  const t = await tip("platform_hold");
  const { upsertStripeRefundEvent } = await import("../src/services/finance/tipRefunds.service.js");
  await upsertStripeRefundEvent({ stripeRefundId: `re_${uid()}`, stripePaymentIntentId: t.pi, stripeChargeId: t.ch, amountCents: 500, status: "succeeded", occurredAt: new Date() });
  const tr = transfers.get(t.holdTransfer!)!;
  assert.equal(tr.amount_reversed, 500, "refund reversed automatically as before");
  assert.ok(tr.reversals[0]!.metadata.caretip_payable_id, "refund reversal is tagged with the payable, not a dispute");
  const d = openDispute(t.ch, t.pi, 1500, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  assert.equal(tr.reversals.length, 1, "the loss adds no automatic reversal");
  await recover({ disputeRowId: (await row(d.id)).id, adminUserId: admin.id });
  assert.equal(tr.amount_reversed, 1800, "refund 5 € + approved recovery of the remaining 13 €; never above the transfer");
  assert.equal(tr.reversals[1]!.metadata.caretip_stripe_dispute_id, d.id);
  const payable = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: t.tx.id } });
  assert.equal(payable.reversedCents, 1800);
});
await test("D1: after a definite refusal the retry uses a new key (Stripe replays the cached error for the old one)", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  const r = await row(d.id);
  fault.reversal = "insufficient";
  const first = await recover({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(first.status, "failed");
  fault.reversal = null;
  const failedKey = (await prisma.stripeDisputeRecoveryAttempt.findFirstOrThrow({ where: { disputeId: r.id } })).idempotencyKey;
  // Proof that the fake models Stripe: the old key still replays the error.
  await assert.rejects(getStripeClient().transfers.createReversal(t.tr, { amount: 1800, metadata: {} }, { idempotencyKey: failedKey }));
  const second = await recover({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(second.status, "succeeded");
  const attempts = await prisma.stripeDisputeRecoveryAttempt.findMany({ where: { disputeId: r.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(attempts.map((a) => a.status), ["failed", "succeeded"]);
  assert.equal(attempts[1]!.idempotencyKey, `${failedKey}:r1`);
  assert.equal(transfers.get(t.tr)!.amount_reversed, 1800);
});
await test("D1: uncertain outcome never Stripe-executed: reconciliation finds nothing, retry reuses the SAME key, one reversal", async () => {
  const t = await tip("dest_employee");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  const r = await row(d.id);
  fault.reversal = "drop_before";
  const first = await recover({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(first.status, "unknown");
  fault.reversal = null;
  await prisma.stripeDispute.update({ where: { id: r.id }, data: { updatedAt: new Date(Date.now() - 600_000) } });
  await recoverySvc.reconcileOpenRecoveryAttempts();
  assert.equal(transfers.get(t.tr)!.reversals.length, 0, "reconciliation never creates a reversal");
  assert.equal((await prisma.stripeDisputeRecoveryAttempt.findFirstOrThrow({ where: { disputeId: r.id } })).status, "unknown");
  // Another worker holds the claim: refused. An expired claim (crashed worker) may be taken over.
  await prisma.stripeDispute.update({ where: { id: r.id }, data: { recoveryClaimedAt: new Date() } });
  await assert.rejects(recoverySvc.retryApprovedRecovery({ disputeRowId: r.id, adminUserId: admin.id }), /in progress/);
  await prisma.stripeDispute.update({ where: { id: r.id }, data: { recoveryClaimedAt: new Date(Date.now() - 10 * 60_000) } });
  const retry = await recoverySvc.retryApprovedRecovery({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(retry.status, "succeeded");
  const attempts = await prisma.stripeDisputeRecoveryAttempt.findMany({ where: { disputeId: r.id } });
  assert.equal(attempts.length, 1, "the uncertain attempt was retried, not replaced");
  assert.equal(transfers.get(t.tr)!.reversals.length, 1);
});
await test("D1: uncertain outcome Stripe DID execute: found by reading reversals, a retry never doubles it", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  const r = await row(d.id);
  fault.reversal = "network";
  await recover({ disputeRowId: r.id, adminUserId: admin.id });
  fault.reversal = null;
  await prisma.stripeDispute.update({ where: { id: r.id }, data: { recoveryClaimedAt: new Date(Date.now() - 10 * 60_000) } });
  await recover({ disputeRowId: r.id, adminUserId: admin.id });
  assert.equal(transfers.get(t.tr)!.reversals.length, 1);
  assert.equal((await row(d.id)).recoveryStatus, "recovered");
});
await test("D3: an invalid amount or refused retry keeps the meaningful status", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  const r = await row(d.id);
  balances.set(t.b.acct, 300);
  await recover({ disputeRowId: r.id, adminUserId: admin.id });
  balances.delete(t.b.acct);
  assert.equal((await row(d.id)).recoveryStatus, "partially_recovered");
  await assert.rejects(recover({ disputeRowId: r.id, adminUserId: admin.id, amountCents: -5 }), /whole positive amount/);
  assert.equal((await row(d.id)).recoveryStatus, "partially_recovered");
  const res = await fetch(`${base}/api/platform/disputes/${r.id}/recovery`, { method: "POST", headers: { authorization: `Bearer ${admin.token}`, "content-type": "application/json" }, body: JSON.stringify({ confirm: true, amountCents: 1.5 }) });
  assert.equal(res.status, 400);
  assert.equal((await row(d.id)).recoveryStatus, "partially_recovered");
});
await test("D4: a sync without connected-account context never clears a stored account reference", async () => {
  const r = await row(d1.id);
  await prisma.stripeDispute.update({ where: { id: r.id }, data: { stripeEventAccountId: "acct_1StoredRef00001" } });
  await projection.syncStripeDisputeFromStripe(d1.id, { source: "reconciliation" });
  await projection.syncStripeDisputeFromStripe(d1.id, { source: "tip_backfill" });
  assert.equal((await row(d1.id)).stripeEventAccountId, "acct_1StoredRef00001");
});
await test("D5: businesses with a dispute (subscription or other) cannot be hard-deleted; records kept", async () => {
  const { deleteBusinessCascadeUsers, BusinessHardDeleteBlockedError } = await import("../src/services/business.service.js");
  for (const kind of ["subscription", "unattributed"] as const) {
    const b = await business();
    await prisma.stripeDispute.create({
      data: { stripeDisputeId: `dp_del_${uid()}`, stripeStatus: "lost", amountCents: 2900, currency: "eur", stripeCreatedAt: new Date(), lastStripeSyncAt: new Date(), subjectKind: kind, businessId: b.id },
    });
    await assert.rejects(deleteBusinessCascadeUsers(b.id), (e: unknown) => e instanceof BusinessHardDeleteBlockedError && (e as InstanceType<typeof BusinessHardDeleteBlockedError>).blocker === "stripe_disputes");
    assert.ok(await prisma.business.findUnique({ where: { id: b.id } }));
    assert.equal(await prisma.stripeDispute.count({ where: { businessId: b.id } }), 1);
  }
  const res = await fetch(`${base}/api/platform/businesses/${(await business()).id}`, { method: "GET", headers: { authorization: `Bearer ${admin.token}` } });
  assert.ok(res.status < 500);
});
await test("D6: when Stripe stores different evidence text, the mismatch is recorded and shown", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000);
  await deliver("charge.dispute.created", d.id);
  const r = await row(d.id);
  const saved = await evidenceSvc.saveEvidenceDraft({ disputeRowId: r.id, adminUserId: admin.id, draft: { product_description: "Voluntary tip at the venue." } });
  fault.evidence = "alter";
  const out = await evidenceSvc.submitEvidence({ disputeRowId: r.id, adminUserId: admin.id, reviewedHash: saved.hash });
  assert.equal(out.confirmed, true);
  assert.equal(out.verified, false);
  const after = await row(d.id);
  assert.deepEqual(after.evidenceVerificationMismatch, ["product_description"]);
  assert.match(after.evidenceLastError ?? "", /different text/);
});

// ───────────────────────── 49–62 Stage 1: approvals, retries, outcome changes, visibility ─────────────────────────
await test("no available funds at approval: nothing sent to Stripe, outstanding with a scheduled retry", async () => {
  const t = await tip("dest_employee");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  balances.set(t.e.acct, 0);
  const before = reversalPosts();
  const out = await recover({ disputeRowId: (await row(d.id)).id, adminUserId: admin.id });
  assert.equal(out.status, "deferred");
  assert.equal(out.reason, "insufficient_available_balance");
  assert.equal(reversalPosts(), before, "a request known to be impossible is not sent");
  const r = await row(d.id);
  assert.equal(r.recoveryStatus, "outstanding");
  assert.ok(r.recoveryNextRetryAt);
  // the scheduled retry while the balance is still 0: no request, retry count grows, next retry later
  await prisma.stripeDispute.update({ where: { id: r.id }, data: { recoveryNextRetryAt: new Date(Date.now() - 1000) } });
  await recoverySvc.tickApprovedRecoveryRetries();
  assert.equal(reversalPosts(), before);
  const r2 = await row(d.id);
  assert.equal(r2.recoveryRetryCount, 1);
  assert.ok(r2.recoveryNextRetryAt! > new Date());
  // funds arrive (for example a later tip) and the retry is due: one reversal within the approval
  balances.delete(t.e.acct);
  await prisma.stripeDispute.update({ where: { id: r.id }, data: { recoveryNextRetryAt: new Date(Date.now() - 1000) } });
  const ticks = await Promise.all([recoverySvc.tickApprovedRecoveryRetries(), recoverySvc.tickApprovedRecoveryRetries()]);
  assert.equal(transfers.get(t.tr)!.reversals.length, 1, JSON.stringify(ticks));
  assert.equal(transfers.get(t.tr)!.amount_reversed, 1800);
  const r3 = await row(d.id);
  assert.equal(r3.recoveryStatus, "recovered");
  assert.equal(r3.recoveryNextRetryAt, null);
  const attempts = await prisma.stripeDisputeRecoveryAttempt.findMany({ where: { disputeId: r.id } });
  assert.deepEqual(attempts.map((a) => a.trigger), ["scheduled_retry"]);
  assert.equal(attempts[0]!.connectedAvailableCents, 1_000_000);
  assert.equal(await notes(admin.id, `stripe_dispute:${r.id}:recovery_insufficient_funds`), 1, "one 'waiting for funds' notice, not one per retry");
});
await test("scheduled retries touch only approved recoveries: an unapproved loss and a new tip move nothing", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  await prisma.stripeDispute.update({ where: { stripeDisputeId: d.id }, data: { recoveryNextRetryAt: new Date(Date.now() - 1000) } });
  const t2 = await tip("dest_business"); // a new tip and transfer for another business
  transfers.get(t2.tr)!.destination = t.b.acct;
  const before = reversalPosts();
  await recoverySvc.tickApprovedRecoveryRetries();
  await reconcileSvc.tickStripeDisputeReconciliation();
  assert.equal(reversalPosts(), before);
  assert.equal((await row(d.id)).recoveryStatus, "review_required");
});
await test("a retry never targets another transfer: the approval's transfer is the only one reversed", async () => {
  const r = await row(d24.id);
  balances.delete(t24.e.acct);
  await prisma.stripeDispute.update({ where: { id: r.id }, data: { recoveryNextRetryAt: new Date(Date.now() - 1000) } });
  await recoverySvc.tickApprovedRecoveryRetries();
  const tr = transfers.get(t24.tr)!;
  assert.equal(tr.reversals.length, 1);
  assert.equal((await row(d24.id)).recoveryStatus, "recovered");
  for (const [id, other] of transfers) if (id !== t24.tr) assert.ok(other.reversals.every((x) => x.metadata.caretip_stripe_dispute_id !== d24.id));
});
await test("funds reinstated after approval: recovery cancelled, no further retries, beneficiary told", async () => {
  const t = await tip("dest_employee");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  balances.set(t.e.acct, 0);
  await recover({ disputeRowId: (await row(d.id)).id, adminUserId: admin.id });
  d.balance_transactions.push({ amount: 2000, fee: -1500 });
  await deliver("charge.dispute.funds_reinstated", d.id);
  const r = await row(d.id);
  assert.equal(r.recoveryStatus, "cancelled");
  assert.match(r.recoveryCancelReason ?? "", /funds_reinstated/);
  assert.equal(r.recoveryNextRetryAt, null);
  balances.delete(t.e.acct);
  await prisma.stripeDispute.update({ where: { id: r.id }, data: { recoveryNextRetryAt: new Date(Date.now() - 1000) } });
  const before = reversalPosts();
  await recoverySvc.tickApprovedRecoveryRetries();
  await assert.rejects(recoverySvc.retryApprovedRecovery({ disputeRowId: r.id, adminUserId: admin.id }), /not been approved/);
  assert.equal(reversalPosts(), before);
});
await test("dispute closed in CareTip's favour after approval: recovery cancelled; money already recovered is flagged, not returned automatically", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  balances.set(t.b.acct, 600);
  await recover({ disputeRowId: (await row(d.id)).id, adminUserId: admin.id });
  balances.delete(t.b.acct);
  d.status = "won"; // Stripe changed the outcome
  await projection.syncStripeDisputeFromStripe(d.id, { source: "reconciliation" }).catch(() => undefined);
  await prisma.stripeDispute.update({ where: { stripeDisputeId: d.id }, data: { stripeStatus: "lost" } }); // simulate stale local
  await projection.syncStripeDisputeFromStripe(d.id, { source: "reconciliation" }).catch(() => undefined);
  const r = await row(d.id);
  assert.equal(r.recoveryStatus, "cancelled");
  assert.equal(r.recoveredCents, 600);
  assert.match(r.recoveryNote ?? "", /admin decides/);
  assert.equal(transfers.get(t.tr)!.reversals.length, 1, "nothing transferred back automatically");
});
await test("retries are bounded: after the limit the recovery needs an admin", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  balances.set(t.b.acct, 0);
  await recover({ disputeRowId: (await row(d.id)).id, adminUserId: admin.id });
  await prisma.stripeDispute.update({ where: { stripeDisputeId: d.id }, data: { recoveryRetryCount: recoverySvc.RECOVERY_MAX_SCHEDULED_RETRIES - 1, recoveryNextRetryAt: new Date(Date.now() - 1000) } });
  await recoverySvc.tickApprovedRecoveryRetries();
  const r = await row(d.id);
  assert.equal(r.recoveryStatus, "failed");
  assert.equal(r.recoveryLastFailureCode, "retries_exhausted");
  assert.equal(r.recoveryNextRetryAt, null);
  assert.equal(await notes(admin.id, `stripe_dispute:${r.id}:recovery_retries_exhausted`), 1);
  balances.delete(t.b.acct);
});
await test("admin cancellation stops an approval; a definite non-funds refusal is not retried automatically", async () => {
  const t = await tip("dest_business");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  balances.set(t.b.acct, 0);
  const r = await row(d.id);
  await recover({ disputeRowId: r.id, adminUserId: admin.id });
  const h = { authorization: `Bearer ${admin.token}`, "content-type": "application/json" };
  const res = await fetch(`${base}/api/platform/disputes/${r.id}/recovery/cancel`, { method: "POST", headers: h, body: JSON.stringify({ confirm: true, reason: "agreed repayment plan" }) });
  assert.equal(res.status, 200);
  assert.equal((await row(d.id)).recoveryStatus, "cancelled");
  balances.delete(t.b.acct);
});
await test("refund + chargeback recovery never exceed the transferred amount", async () => {
  const t = await tip("dest_business", { refunded: 1500 });
  const d = openDispute(t.ch, t.pi, 500, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  await recover({ disputeRowId: (await row(d.id)).id, adminUserId: admin.id });
  const tr = transfers.get(t.tr)!;
  assert.ok(tr.amount_reversed <= tr.amount);
  assert.equal(tr.amount_reversed, 1500 + 450, "refund 15 € + beneficiary share of the disputed 5 €");
});
await test("business and employee views: each sees only their own disputes, no admin data", async () => {
  const t = await tip("dest_employee");
  const empUser = await user("EMPLOYEE");
  await prisma.employee.update({ where: { id: t.e.id }, data: { userId: empUser.id } });
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  const rid = (await row(d.id)).id;
  const other = await business();
  const get = async (path: string, token: string) => {
    const res = await fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { items?: Array<Record<string, unknown>> } };
  };
  const mine = await get("/api/me/connect/disputes", t.b.owner.token);
  assert.equal(mine.status, 200);
  assert.ok(mine.body.items!.some((i) => i.id === rid), "own business sees it");
  const theirs = await get("/api/me/connect/disputes", other.owner.token);
  assert.ok(!theirs.body.items!.some((i) => i.id === rid), "another business does not");
  const emp = await get("/api/me/employee-connect/disputes", empUser.token);
  assert.equal(emp.status, 200, JSON.stringify(emp.body));
  assert.equal(emp.body.items!.length, 1);
  assert.equal(emp.body.items![0]!.outcome, "lost");
  for (const item of [...mine.body.items!, ...emp.body.items!]) {
    for (const k of ["internalNotes", "evidenceDraft", "stripeChargeId", "destinationAccountId", "recoveryApprovedBy"]) assert.equal(item[k], undefined, k);
  }
  const forbidden = await get("/api/me/connect/disputes", empUser.token);
  assert.ok(forbidden.status === 403 || forbidden.status === 401);
});
await test("notifications: employee told in their language, deduplicated across repeated syncs", async () => {
  const t = await tip("dest_employee");
  const empUser = await user("EMPLOYEE", { preferredLocale: "de" });
  await prisma.employee.update({ where: { id: t.e.id }, data: { userId: empUser.id } });
  const d = openDispute(t.ch, t.pi, 2000);
  await deliver("charge.dispute.created", d.id);
  await deliver("charge.dispute.updated", d.id);
  await projection.syncStripeDisputeFromStripe(d.id, { source: "reconciliation" });
  const rows = await prisma.notification.findMany({ where: { userId: empUser.id, dedupeKey: { contains: "stripe_dispute_employee" } } });
  assert.equal(rows.length, 1, "one notice despite three syncs");
  assert.equal(rows[0]!.title, "Trinkgeld angefochten");
  assert.doesNotMatch(rows[0]!.message, /€|EUR|\d+[.,]\d{2}/, "no amounts in the notice");
});

await test("funds in two currencies are never added together: the dispute is flagged for reconciliation", async () => {
  const t = await tip("dest_employee");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost", balance_transactions: [{ amount: -2000, fee: 1500, currency: "eur" }, { amount: -2200, fee: 0, currency: "usd" }] });
  await deliver("charge.dispute.closed", d.id);
  const r = await row(d.id);
  assert.equal(r.fundsCurrency, "eur");
  assert.equal(r.fundsCurrencyMixed, true);
  assert.equal(r.fundsWithdrawnCents, 2000, "only the EUR transaction is counted");
  const detail = await (await import("../src/services/disputes/stripeDisputeAdmin.service.js")).getDisputeDetailForAdmin(r.id);
  assert.equal(detail!.explanation.nextStep, "reconciliation_required");
  assert.equal(detail!.explanation.needsAttention, true);
});
await test("a Stripe 200 reply is not proof: an unconfirmed reversal stays unknown and nothing is counted as recovered", async () => {
  const t = await tip("dest_employee");
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  fault.reversal = "unconfirmed";
  try {
    const out = await recover({ disputeRowId: (await row(d.id)).id, adminUserId: admin.id });
    assert.equal(out.status, "unknown", JSON.stringify(out));
  } finally {
    fault.reversal = null;
  }
  const r = await row(d.id);
  assert.equal(r.recoveredCents, 0, "nothing counted until Stripe shows the reversal");
  assert.notEqual(r.recoveryStatus, "recovered");
  const attempts = await prisma.stripeDisputeRecoveryAttempt.findMany({ where: { disputeId: r.id } });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]!.status, "unknown");
  assert.ok(attempts[0]!.stripeReversalId, "the Stripe reply is kept for the audit trail");
});
await test("plain-language summary: derived on the server, never guesses where the money is", async () => {
  const explain = (await import("../src/services/disputes/stripeDisputeExplain.service.js")).explainDispute;
  const now = new Date("2026-11-26T12:00:00Z");
  const baseRow = {
    stripeStatus: "lost", amountCents: 2000, currency: "eur", subjectKind: "tip_destination_employee" as never,
    evidenceDueBy: null, evidencePastDue: false, evidenceSubmissionCount: 1, fundsWithdrawnCents: 2000, fundsReinstatedCents: 0,
    fundsCurrency: "eur", fundsCurrencyMixed: false, lastStripeSyncAt: now, lastSyncError: null,
    recoveryStatus: "review_required" as never, recoveredCents: 0, recoveryCancelledAt: null, destinationTransferId: "tr_1",
  };
  const extra = { businessName: "B", employeeName: "E", paymentDate: null, platformHoldTransferredCents: null, outstandingCents: 1800, now };
  const lost = explain(baseRow, extra);
  assert.equal(lost.nextStep, "lost_recovery_review");
  assert.equal(lost.adminAction, "decide_recovery_with_policy");
  assert.ok(lost.money.some((m) => m.location === "bank" && m.source === "not_determinable"), "bank payout shown as unknowable");
  assert.equal(lost.happened.paymentDateSource, "not_determinable");
  const won = explain({ ...baseRow, stripeStatus: "won", fundsReinstatedCents: 2000 }, extra);
  assert.equal(won.nextStep, "won_funds_returned");
  assert.equal(won.adminAction, "none", "a won dispute never asks for a recovery");
  const stale = explain({ ...baseRow, stripeStatus: "under_review", lastStripeSyncAt: new Date(now.getTime() - 48 * 3600_000) }, extra);
  assert.equal(stale.nextStep, "reconciliation_required");
  assert.equal(explain({ ...baseRow, lastSyncError: "boom" }, extra).nextStep, "reconciliation_required");
  const hold = explain({ ...baseRow, subjectKind: "tip_platform_hold" as never }, { ...extra, platformHoldTransferredCents: 0 });
  assert.ok(hold.money.some((m) => m.code === "tip_not_paid_out_yet"));
});

await test("a transfer in another currency than the dispute is never reversed: manual review", async () => {
  const t = await tip("dest_employee");
  transfers.get(t.tr)!.currency = "usd";
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  const before = reversalPosts();
  await assert.rejects(recover({ disputeRowId: (await row(d.id)).id, adminUserId: admin.id }), (e: { code?: string }) => e.code === "CURRENCY_MISMATCH");
  assert.equal(reversalPosts(), before);
  assert.equal((await row(d.id)).recoveryApprovedAt, null, "no approval recorded");
});
await test("a transfer paid to another account than CareTip recorded is never reversed (destination and platform hold)", async () => {
  const t = await tip("dest_employee");
  transfers.get(t.tr)!.destination = "acct_1SomeoneElse000";
  const d = openDispute(t.ch, t.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d.id);
  const before = reversalPosts();
  await assert.rejects(recover({ disputeRowId: (await row(d.id)).id, adminUserId: admin.id }), (e: { code?: string }) => e.code === "ACCOUNT_MISMATCH");
  const h = await tip("platform_hold");
  transfers.get(h.holdTransfer!)!.destination = "acct_1SomeoneElse001";
  const d2 = openDispute(h.ch, h.pi, 2000, { status: "lost" });
  await deliver("charge.dispute.closed", d2.id);
  await assert.rejects(recover({ disputeRowId: (await row(d2.id)).id, adminUserId: admin.id }), (e: { code?: string }) => e.code === "ACCOUNT_MISMATCH");
  assert.equal(reversalPosts(), before);
});

server.close();
fake.closeAllConnections();
fake.close();
await prisma.$disconnect();
console.log(failures.length ? `\n${failures.length} of ${count} failed` : `\nstripe-dispute-lifecycle-runtime: ok (${count} scenarios)`);
process.exit(failures.length ? 1 : 0);
