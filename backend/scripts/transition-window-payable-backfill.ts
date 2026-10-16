/**
 * Gated repair for the two reviewed transition-window tips that have no EmployeeTipPayable row.
 *
 *   npx tsx scripts/transition-window-payable-backfill.ts                 # preflight only (no writes)
 *   CARETIP_BACKFILL_CONFIRM_HOST=<host:port> npx tsx scripts/transition-window-payable-backfill.ts --execute
 *
 * Writes only when every preflight passes for BOTH tips: confirmed DATABASE_URL host, test-mode
 * Stripe key and objects, no existing payable rows, and a plan identical to the reviewed plan.
 * Each tip is re-planned from fresh Stripe facts immediately before its own transaction, and the
 * transaction re-verifies the locked tip row. Stripe access is retrieve/list only.
 * Prints internal ids and cents only; no secrets or personal data.
 */
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { remainingPayableCents } from "../src/services/employeeTipPayable.service.js";
import {
  applyTransitionWindowPayable,
  planTransitionWindowPayable,
  TransitionBackfillAbort,
  type PlannedPayable,
  type TransitionTipStripeFacts,
} from "./lib/transitionWindowPayableBackfill.js";

type Reviewed = Omit<PlannedPayable, "stripeDestinationAccountId"> & { destinationSuffix: string };

const shared = {
  employeeId: "cmtvehfvo0002u7o4t8nvf4rz",
  businessId: "cmqexplaj0021n83qbet06d89",
  routingMode: "business_distribution",
  chargeModel: "destination_business",
  status: "held_business",
  grossCents: 1000,
  platformFeeCents: 149,
  payableCents: 851,
  transferredCents: 0,
  reversedCents: 0,
  refundedCents: 0,
  disputedOpenCents: 0,
  destinationSuffix: "8HIMOU",
} as const;

const REVIEWED: Reviewed[] = [
  {
    ...shared,
    transactionId: "cmtvejz87000rif3q6ikpficc",
    disputedLostCents: 0,
    stripeDisputeId: null,
    stripePaymentIntentId: "pi_3UE5Uy66w930Tx0A0S8esj8O",
    stripeChargeId: "ch_3UE5Uy66w930Tx0A0cWRkB0W",
    stripeTransferId: "tr_3UE5Uy66w930Tx0A0eZQ1Obe",
  } as Reviewed,
  {
    ...shared,
    transactionId: "cmtvekj1p000zif3q1hnlnfsj",
    disputedLostCents: 851,
    stripeDisputeId: "du_1UE5VP66w930Tx0AvDR4oHt8",
    stripePaymentIntentId: "pi_3UE5VO66w930Tx0A0XlgJbZw",
    stripeChargeId: "ch_3UE5VO66w930Tx0A02I1bnMG",
    stripeTransferId: "tr_3UE5VO66w930Tx0A0urcywKH",
  } as Reviewed,
];
const EXPECTED_REMAINING: Record<string, number> = {
  cmtvejz87000rif3q6ikpficc: 851,
  cmtvekj1p000zif3q1hnlnfsj: 0,
};

const execute = process.argv.includes("--execute");
const log = (m: string) => console.log(`[payable-backfill] ${m}`);
function abort(m: string): never {
  console.error(`[payable-backfill] ABORT (nothing written): ${m}`);
  process.exit(2);
}

if (process.env.NODE_ENV === "production") abort("NODE_ENV=production");
const host = (() => {
  try {
    const u = new URL((process.env.DATABASE_URL ?? "").replace(/^postgres(ql)?:\/\//i, "http://"));
    return `${u.hostname}:${u.port || "5432"}`;
  } catch {
    return "";
  }
})();
if (!host) abort("DATABASE_URL host unreadable");
log(`mode=${execute ? "EXECUTE" : "preflight-only"} target host=${host}`);
if (execute && process.env.CARETIP_BACKFILL_CONFIRM_HOST !== host) {
  abort("CARETIP_BACKFILL_CONFIRM_HOST does not equal the DATABASE_URL host");
}

const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
if (!/^(sk|rk)_test_/.test(key) || key.includes("isolated_placeholder")) abort("a real test-mode Stripe key is required");
const { default: Stripe } = await import("stripe");
const stripe = new Stripe(key);
const idOf = (v: unknown): string | null => (typeof v === "string" ? v : (v as { id?: string } | null)?.id ?? null);

async function stripeFacts(paymentIntentId: string): Promise<TransitionTipStripeFacts> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  if (!charge) abort(`${paymentIntentId}: no latest charge`);
  const trId = idOf(charge.transfer);
  const tr = trId ? await stripe.transfers.retrieve(trId) : null;
  const disputes = await stripe.disputes.list({ charge: charge.id, limit: 10 });
  return {
    livemode: pi.livemode || charge.livemode || Boolean(tr?.livemode),
    paymentIntentId: pi.id,
    paymentIntentStatus: pi.status,
    amountReceivedCents: pi.amount_received,
    currency: pi.currency,
    applicationFeeAmountCents: pi.application_fee_amount ?? null,
    destinationAccountId: idOf(pi.transfer_data?.destination),
    chargeId: charge.id,
    chargeAmountRefundedCents: charge.amount_refunded,
    chargeTransferId: trId,
    transferAmountCents: tr?.amount ?? null,
    transferDestinationAccountId: idOf(tr?.destination),
    transferAmountReversedCents: tr?.amount_reversed ?? null,
    disputes: disputes.data.map((d) => ({ id: d.id, status: d.status, amountCents: d.amount })),
  };
}

function diffFromReviewed(p: PlannedPayable, r: Reviewed): string[] {
  const diffs: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (k === "destinationSuffix") continue;
    const got = (p as Record<string, unknown>)[k];
    if (got !== v) diffs.push(`${k}: planned ${String(got)} != reviewed ${String(v)}`);
  }
  if (!p.stripeDestinationAccountId.endsWith(r.destinationSuffix)) diffs.push("destination account differs from reviewed");
  if (remainingPayableCents(p) !== EXPECTED_REMAINING[r.transactionId]) diffs.push(`remaining owed ${remainingPayableCents(p)}`);
  return diffs;
}

type Ready = { reviewed: Reviewed; plan: Awaited<ReturnType<typeof planTransitionWindowPayable>> };

async function preflight(): Promise<Ready[]> {
  const out: Ready[] = [];
  for (const r of REVIEWED) {
    const plan = await planTransitionWindowPayable(r.transactionId, await stripeFacts(r.stripePaymentIntentId));
    if (plan.kind === "blocked") abort(`${r.transactionId}: ${plan.reasons.join("; ")}`);
    const diffs = diffFromReviewed(plan.payable, r);
    if (diffs.length) abort(`${r.transactionId} differs from reviewed plan: ${diffs.join("; ")}`);
    if (plan.kind === "already_present" && !plan.matches) {
      abort(`${r.transactionId} has a divergent existing payable ${plan.payableId}: ${plan.diffs.join("; ")}`);
    }
    log(`preflight ${r.transactionId}: ${plan.kind === "create" ? "no payable row; plan == reviewed" : `already present ${plan.payableId}, matches reviewed`}`);
    out.push({ reviewed: r, plan });
  }
  return out;
}

async function employeeMoneySnapshot() {
  const [payables, payouts, instant, scheduled] = await Promise.all([
    prisma.employeeTipPayable.findMany({
      where: { employeeId: shared.employeeId, transactionId: { notIn: REVIEWED.map((r) => r.transactionId) } },
      orderBy: { id: "asc" },
    }),
    prisma.employeeStripePayout.count({ where: { employeeId: shared.employeeId } }),
    prisma.employeeInstantPayoutRequest.count({ where: { employeeId: shared.employeeId } }),
    prisma.employeeStripeScheduledPayoutRequest.count({ where: { employeeId: shared.employeeId } }),
  ]);
  return JSON.stringify({ payables, payouts, instant, scheduled });
}

try {
  const ready = await preflight();
  if (!execute) {
    log("preflight PASS; rerun with --execute and CARETIP_BACKFILL_CONFIRM_HOST to write");
    process.exit(0);
  }

  const startedAt = Math.floor(Date.now() / 1000) - 5;
  const moneyBefore = await employeeMoneySnapshot();
  for (const { reviewed: r } of ready) {
    const plan = await planTransitionWindowPayable(r.transactionId, await stripeFacts(r.stripePaymentIntentId));
    if (plan.kind === "blocked") abort(`${r.transactionId} at write time: ${plan.reasons.join("; ")}`);
    const diffs = diffFromReviewed(plan.payable, r);
    if (diffs.length) abort(`${r.transactionId} changed before write: ${diffs.join("; ")}`);
    if (plan.kind === "already_present") {
      if (!plan.matches) abort(`${r.transactionId} divergent row appeared: ${plan.diffs.join("; ")}`);
      log(`${r.transactionId}: already present and matching; no write`);
      continue;
    }
    try {
      log(`${r.transactionId}: ${await applyTransitionWindowPayable(plan)}`);
    } catch (err) {
      if (err instanceof TransitionBackfillAbort) abort(`${r.transactionId}: ${err.reasons.join("; ")}`);
      throw err;
    }
  }

  log("== post-repair verification (READ ONLY) ==");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    for (const r of REVIEWED) {
      const rows = await tx.employeeTipPayable.findMany({ where: { transactionId: r.transactionId } });
      if (rows.length !== 1) throw new Error(`${r.transactionId}: ${rows.length} payable rows`);
      const row = rows[0]!;
      const diffs = diffFromReviewed({ ...row, transactionId: r.transactionId } as PlannedPayable, r);
      log(
        `  ${r.transactionId} payable=${row.id} ${row.chargeModel}/${row.routingMode}/${row.status} gross=${row.grossCents} fee=${row.platformFeeCents} payable=${row.payableCents} transferred=${row.transferredCents} reversed=${row.reversedCents} refunded=${row.refundedCents} disputedOpen=${row.disputedOpenCents} disputedLost=${row.disputedLostCents} remaining=${remainingPayableCents(row)} transfer=${row.stripeTransferId} dispute=${row.stripeDisputeId ?? "none"} ${diffs.length ? `MISMATCH ${diffs.join("; ")}` : "== reviewed"}`,
      );
      if (diffs.length) throw new Error("post-repair row differs from reviewed plan");
    }
  });
  const moneyAfter = await employeeMoneySnapshot();
  log(`  employee's other payables / payout rows unchanged: ${moneyAfter === moneyBefore}`);
  if (moneyAfter !== moneyBefore) throw new Error("employee money rows changed during repair");

  const businessAcct = (await prisma.business.findUniqueOrThrow({ where: { id: shared.businessId }, select: { stripeAccountId: true } })).stripeAccountId;
  const employeeAcct = (await prisma.employeeStripeAccount.findUnique({ where: { employeeId: shared.employeeId }, select: { stripeAccountId: true } }))?.stripeAccountId;
  const since = { gte: startedAt };
  const transfers = await stripe.transfers.list({ created: since, limit: 100 });
  const ours = transfers.data.filter((t) =>
    [businessAcct, employeeAcct].includes(idOf(t.destination)) ||
    REVIEWED.some((r) => idOf(t.source_transaction) === r.stripeChargeId || Object.values(t.metadata ?? {}).includes(r.transactionId)),
  );
  log(`  Stripe transfers created since start: total=${transfers.data.length} to these accounts/tips=${ours.length}`);
  for (const acct of [businessAcct, employeeAcct].filter((a): a is string => Boolean(a))) {
    const payouts = await stripe.payouts.list({ created: since, limit: 100 }, { stripeAccount: acct });
    log(`  Stripe payouts created since start on …${acct.slice(-6)}: ${payouts.data.length}`);
    if (payouts.data.length) throw new Error("payout created on a repair-related account");
  }
  if (ours.length) throw new Error("transfer created for a repair-related account or tip");
  log("repair complete and verified");
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
