/**
 * Read-only forensics for the two transition-window tips that have no EmployeeTipPayable row.
 *
 *   npx tsx scripts/phase2-local-copy.ts run scripts/payable-backfill-forensics.ts
 *
 * Local copy only; the forensic queries run in a READ ONLY transaction and the backfill is only
 * planned (reads), never applied. Stripe access is test-mode retrieve/list only. Stripe ids are
 * printed as suffixes; no personal data is printed.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { calculateTipPlatformFeeCents } from "../src/config/fees.js";
import { remainingPayableCents } from "../src/services/employeeTipPayable.service.js";
import { planTransitionWindowPayable, type TransitionTipStripeFacts } from "./lib/transitionWindowPayableBackfill.js";

const TIP_IDS = ["cmtvejz87000rif3q6ikpficc", "cmtvekj1p000zif3q1hnlnfsj"];

if (process.env.CARETIP_PHASE2_LOCAL_COPY_SCAN !== "1") {
  console.error("[payable-forensics] Blocked: run only via phase2-local-copy.ts run (local copy)");
  process.exit(2);
}
const marker = await prisma.$queryRaw<{ ok: boolean }[]>`
  SELECT to_regclass('public._caretip_phase2_copy') IS NOT NULL AS ok`;
if (!marker[0]?.ok) {
  console.error("[payable-forensics] Blocked: database is not a Phase 2 local copy");
  process.exit(2);
}

const sfx = (v: unknown): string => (typeof v === "string" && v ? `…${v.slice(-6)}` : String(v ?? "null"));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? "null"));

type StripeRefs = { tipId: string; pi: string | null; employeeAcct: string | null; businessAcct: string | null; disputeId: string | null };
const stripeRefs: StripeRefs[] = [];

async function q<T>(tx: Prisma.TransactionClient, sql: Prisma.Sql): Promise<T[]> {
  return tx.$queryRaw<T[]>(sql);
}

await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

  const hasMigrations = (
    await q<{ ok: boolean }>(tx, Prisma.sql`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS ok`)
  )[0]?.ok;
  const migrations = hasMigrations
    ? await q<{ migration_name: string; finished_at: Date | null }>(
        tx,
        Prisma.sql`SELECT migration_name, finished_at FROM _prisma_migrations
                   WHERE migration_name IN ('20260910080000_employee_tip_direct_payout_ledger','20260910120000_employee_tip_payable_disputes')
                   ORDER BY migration_name`,
      )
    : [];
  console.log("== ledger migrations on copy ==");
  for (const m of migrations) console.log(`  ${m.migration_name} finished_at=${iso(m.finished_at)}`);
  if (!migrations.length) console.log("  (_prisma_migrations not present on copy)");

  const firstPayable = await q<{ min: Date | null; n: bigint }>(
    tx,
    Prisma.sql`SELECT MIN(created_at) AS min, COUNT(*) AS n FROM employee_tip_payables`,
  );
  console.log(`  first payable created_at=${iso(firstPayable[0]?.min)} total payables=${firstPayable[0]?.n}`);

  for (const tipId of TIP_IDS) {
    console.log(`\n== tip ${tipId.slice(0, 9)}… ==`);
    const tip = (
      await q<{
        id: string; amount: Prisma.Decimal; status: string; payout_status: string; employee_id: string | null;
        business_id: string; created_at: Date; stripe_payment_intent_id: string | null;
      }>(tx, Prisma.sql`SELECT id, amount, status::text, payout_status::text, employee_id, business_id, created_at, stripe_payment_intent_id
                        FROM tips WHERE id = ${tipId}`)
    )[0];
    if (!tip) {
      console.log("  tip row NOT FOUND on copy");
      continue;
    }
    const grossCents = Math.round(Number(tip.amount) * 100);
    const feeCents = calculateTipPlatformFeeCents(grossCents);
    console.log(`  status=${tip.status} payout_status=${tip.payout_status} created_at=${iso(tip.created_at)}`);
    console.log(`  business=${tip.business_id.slice(0, 9)}… employee=${tip.employee_id ? tip.employee_id.slice(0, 9) + "…" : "null"} pi=${sfx(tip.stripe_payment_intent_id)}`);
    console.log(`  gross=${grossCents} fee(formula)=${feeCents} net=${grossCents - feeCents}`);

    const payable = await q<{ id: string }>(tx, Prisma.sql`SELECT id FROM employee_tip_payables WHERE transaction_id = ${tipId}`);
    const payableByPi = tip.stripe_payment_intent_id
      ? await q<{ id: string; transaction_id: string }>(
          tx,
          Prisma.sql`SELECT id, transaction_id FROM employee_tip_payables WHERE stripe_payment_intent_id = ${tip.stripe_payment_intent_id}`,
        )
      : [];
    console.log(`  payable by transaction_id=${payable.length} by payment_intent=${payableByPi.length}`);

    const biz = (
      await q<{ mode: string; acct: string | null; created_at: Date }>(
        tx,
        Prisma.sql`SELECT employee_tip_payout_mode::text AS mode, stripe_account_id AS acct, created_at
                   FROM businesses WHERE id = ${tip.business_id}`,
      )
    )[0];
    console.log(`  business routing_mode(now)=${biz?.mode} business_connect=${sfx(biz?.acct)}`);
    const refs: StripeRefs = { tipId, pi: tip.stripe_payment_intent_id, employeeAcct: null, businessAcct: biz?.acct ?? null, disputeId: null };
    stripeRefs.push(refs);

    if (tip.employee_id) {
      refs.employeeAcct =
        (await q<{ a: string }>(tx, Prisma.sql`SELECT stripe_account_id AS a FROM employee_stripe_accounts WHERE employee_id = ${tip.employee_id}`))[0]?.a ?? null;
      const acct = (
        await q<{ stripe_account_id: string; status: string; payouts: boolean; created_at: Date }>(
          tx,
          Prisma.sql`SELECT stripe_account_id, stripe_connect_status::text AS status, stripe_payouts_enabled AS payouts, created_at
                     FROM employee_stripe_accounts WHERE employee_id = ${tip.employee_id}`,
        )
      )[0];
      console.log(`  employee connect acct=${sfx(acct?.stripe_account_id)} status=${acct?.status ?? "none"} payouts_enabled=${acct?.payouts ?? "n/a"} acct_created=${iso(acct?.created_at)}`);

      const otherPayables = await q<{ charge_model: string; status: string; n: bigint; gross: bigint; payable: bigint; transferred: bigint; first: Date; last: Date }>(
        tx,
        Prisma.sql`SELECT charge_model::text, status::text, COUNT(*) AS n, SUM(gross_cents) AS gross, SUM(payable_cents) AS payable,
                          SUM(transferred_cents) AS transferred, MIN(created_at) AS first, MAX(created_at) AS last
                   FROM employee_tip_payables WHERE employee_id = ${tip.employee_id}
                   GROUP BY 1, 2 ORDER BY 1, 2`,
      );
      console.log(`  employee's existing payables:`);
      for (const r of otherPayables) {
        console.log(`    ${r.charge_model}/${r.status} n=${r.n} gross=${r.gross} payable=${r.payable} transferred=${r.transferred} ${iso(r.first)}..${iso(r.last)}`);
      }

      const tipsNoPayable = await q<{ n: bigint; first: Date | null; last: Date | null }>(
        tx,
        Prisma.sql`SELECT COUNT(*) AS n, MIN(t.created_at) AS first, MAX(t.created_at) AS last
                   FROM tips t LEFT JOIN employee_tip_payables p ON p.transaction_id = t.id
                   WHERE t.employee_id = ${tip.employee_id} AND t.status = 'success' AND p.id IS NULL`,
      );
      console.log(`  employee's successful tips without payable: n=${tipsNoPayable[0]?.n} ${iso(tipsNoPayable[0]?.first)}..${iso(tipsNoPayable[0]?.last)}`);

      const payouts = await q<{ status: string; method: string | null; n: bigint; amount: bigint; first: Date | null; last: Date | null }>(
        tx,
        Prisma.sql`SELECT status::text, method, COUNT(*) AS n, SUM(amount_cents) AS amount, MIN(stripe_created_at) AS first, MAX(stripe_created_at) AS last
                   FROM employee_stripe_payouts WHERE employee_id = ${tip.employee_id} GROUP BY 1, 2 ORDER BY 1, 2`,
      );
      console.log(`  employee Stripe payouts:${payouts.length ? "" : " none"}`);
      for (const p of payouts) {
        console.log(`    ${p.status}/${p.method ?? "?"} n=${p.n} amount=${p.amount} ${iso(p.first)}..${iso(p.last)}`);
      }
      const instant = await q<{ status: string; n: bigint; amount: bigint }>(
        tx,
        Prisma.sql`SELECT status::text, COUNT(*) AS n, SUM(amount_cents) AS amount FROM employee_instant_payout_requests
                   WHERE employee_id = ${tip.employee_id} GROUP BY 1`,
      );
      console.log(`  employee instant payout requests:${instant.length ? "" : " none"}`);
      for (const r of instant) console.log(`    ${r.status} n=${r.n} amount=${r.amount}`);
      const scheduled = await q<{ status: string; n: bigint; amount: bigint }>(
        tx,
        Prisma.sql`SELECT status::text, COUNT(*) AS n, SUM(amount_cents) AS amount
                   FROM employee_stripe_scheduled_payout_requests
                   WHERE employee_id = ${tip.employee_id} GROUP BY 1`,
      );
      console.log(`  employee scheduled payout requests:${scheduled.length ? "" : " none"}`);
      for (const r of scheduled) console.log(`    ${r.status} n=${r.n} amount=${r.amount}`);

      const distributed = await q<{ n: bigint }>(
        tx,
        Prisma.sql`SELECT COUNT(*) AS n FROM employee_tip_distribution_items WHERE employee_id = ${tip.employee_id}`,
      );
      console.log(`  distribution items for employee=${distributed[0]?.n}`);
    }

    const refunds = await q<{
      kind: string; status: string; amount_eur: Prisma.Decimal; original_amount_eur: Prisma.Decimal | null;
      stripe_refund_id: string | null; stripe_dispute_id: string | null; stripe_charge_id: string | null;
      reason: string | null; occurred_at: Date; updated_at: Date;
    }>(
      tx,
      Prisma.sql`SELECT kind::text, status::text, amount_eur, original_amount_eur, stripe_refund_id, stripe_dispute_id, stripe_charge_id,
                        reason, occurred_at, updated_at
                 FROM tip_refunds
                 WHERE tip_id = ${tipId} OR (${tip.stripe_payment_intent_id}::text IS NOT NULL AND stripe_payment_intent_id = ${tip.stripe_payment_intent_id})
                 ORDER BY occurred_at`,
    );
    console.log(`  tip_refunds rows=${refunds.length}`);
    for (const r of refunds) {
      if (r.stripe_dispute_id) refs.disputeId = r.stripe_dispute_id;
      console.log(
        `    ${r.kind}/${r.status} amount_eur=${r.amount_eur} original=${r.original_amount_eur ?? "null"} refund=${sfx(r.stripe_refund_id)} dispute=${sfx(r.stripe_dispute_id)} charge=${sfx(r.stripe_charge_id)} reason=${r.reason ?? "null"} occurred=${iso(r.occurred_at)} updated=${iso(r.updated_at)}`,
      );
    }
  }
}, { timeout: 60_000 });

const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
if (!/^(sk|rk)_test_/.test(key) || key.includes("isolated_placeholder")) {
  console.log("\n== Stripe (test mode, read-only) == SKIPPED: no real test-mode key in this run");
  await prisma.$disconnect();
  process.exit(0);
}
const { default: Stripe } = await import("stripe");
const stripe = new Stripe(key);
const idOf = (v: unknown): string | null => (typeof v === "string" ? v : (v as { id?: string } | null)?.id ?? null);

console.log("\n== Stripe (test mode, retrieve calls only) ==");
for (const r of stripeRefs) {
  console.log(`-- tip ${r.tipId.slice(0, 9)}…`);
  if (!r.pi) {
    console.log("  no PaymentIntent id");
    continue;
  }
  const pi = await stripe.paymentIntents.retrieve(r.pi, { expand: ["latest_charge"] });
  if (pi.livemode) {
    console.log("  BLOCKED: live-mode object");
    continue;
  }
  const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const dest = idOf(pi.transfer_data?.destination);
  console.log(
    `  pi status=${pi.status} amount_received=${pi.amount_received} currency=${pi.currency} application_fee_amount=${pi.application_fee_amount ?? "null"} on_behalf_of=${pi.on_behalf_of ? "set" : "null"}`,
  );
  console.log(
    `  transfer_data.destination: present=${!!dest} == employee acct=${!!dest && dest === r.employeeAcct} == business acct=${!!dest && dest === r.businessAcct}`,
  );
  console.log(`  pi.metadata keys=${Object.keys(pi.metadata ?? {}).sort().join(",") || "none"} routing=${pi.metadata?.caretip_routing_mode ?? pi.metadata?.routingMode ?? "n/a"} charge_model=${pi.metadata?.caretip_charge_model ?? "n/a"}`);
  if (!charge) continue;
  console.log(
    `  charge=${sfx(charge.id)} amount=${charge.amount} captured=${charge.captured} refunded=${charge.refunded} amount_refunded=${charge.amount_refunded} disputed=${charge.disputed} application_fee=${sfx(idOf(charge.application_fee))} application_fee_amount=${charge.application_fee_amount ?? "null"}`,
  );
  const trId = idOf(charge.transfer);
  if (trId) {
    const tr = await stripe.transfers.retrieve(trId);
    const trDest = idOf(tr.destination);
    console.log(
      `  transfer=${sfx(tr.id)} amount=${tr.amount} amount_reversed=${tr.amount_reversed} reversed=${tr.reversed} reversals=${tr.reversals?.data?.length ?? 0} dest==employee=${trDest === r.employeeAcct} dest==business=${trDest === r.businessAcct} source==charge=${idOf(tr.source_transaction) === charge.id}`,
    );
    const destPayment = idOf(tr.destination_payment);
    console.log(`  destination_payment present=${!!destPayment}`);
  } else {
    console.log("  charge.transfer: none");
  }
  const feeId = idOf(charge.application_fee);
  if (feeId) {
    const fee = await stripe.applicationFees.retrieve(feeId);
    console.log(`  application_fee amount=${fee.amount} amount_refunded=${fee.amount_refunded} refunded=${fee.refunded}`);
  }
  const disputes = await stripe.disputes.list({ charge: charge.id, limit: 10 });
  for (const d of disputes.data) {
    const btSum = d.balance_transactions.reduce((s, b) => s + b.amount, 0);
    const btFee = d.balance_transactions.reduce((s, b) => s + b.fee, 0);
    console.log(
      `  dispute=${sfx(d.id)} matches ledger=${d.id === r.disputeId} status=${d.status} amount=${d.amount} reason=${d.reason} platform balance impact=${btSum} dispute fee=${btFee} bt_count=${d.balance_transactions.length}`,
    );
  }
  if (!disputes.data.length) console.log("  disputes: none");
  const refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 10 });
  console.log(`  refunds: ${refunds.data.length ? refunds.data.map((x) => `${x.status}:${x.amount}`).join(",") : "none"}`);

  const tr = trId ? await stripe.transfers.retrieve(trId) : null;
  const facts: TransitionTipStripeFacts = {
    livemode: pi.livemode,
    paymentIntentId: pi.id,
    paymentIntentStatus: pi.status,
    amountReceivedCents: pi.amount_received,
    currency: pi.currency,
    applicationFeeAmountCents: pi.application_fee_amount ?? null,
    destinationAccountId: dest,
    chargeId: charge.id,
    chargeAmountRefundedCents: charge.amount_refunded,
    chargeTransferId: trId,
    transferAmountCents: tr?.amount ?? null,
    transferDestinationAccountId: idOf(tr?.destination),
    transferAmountReversedCents: tr?.amount_reversed ?? null,
    disputes: disputes.data.map((d) => ({ id: d.id, status: d.status, amountCents: d.amount })),
  };
  const plan = await planTransitionWindowPayable(r.tipId, facts);
  if (plan.kind === "blocked") console.log(`  PLAN blocked: ${plan.reasons.join("; ")}`);
  else {
    const p = plan.payable;
    const tipRefundId = p.stripeDisputeId
      ? (await prisma.tipRefund.findUnique({ where: { stripeDisputeId: p.stripeDisputeId }, select: { id: true } }))?.id ?? "missing"
      : null;
    console.log(
      `  IDS transaction=${p.transactionId} employee=${p.employeeId} business=${p.businessId} pi=${p.stripePaymentIntentId} charge=${p.stripeChargeId} transfer=${p.stripeTransferId} dispute=${p.stripeDisputeId ?? "none"} tip_refund_row=${tipRefundId ?? "none"}`,
    );
    console.log(
      `  PLAN ${plan.kind}: ${p.chargeModel}/${p.routingMode} status=${p.status} gross=${p.grossCents} fee=${p.platformFeeCents} payable=${p.payableCents} transferred=${p.transferredCents} reversed=${p.reversedCents} refunded=${p.refundedCents} disputedOpen=${p.disputedOpenCents} disputedLost=${p.disputedLostCents} dispute=${sfx(p.stripeDisputeId)} charge=${sfx(p.stripeChargeId)} transfer=${sfx(p.stripeTransferId)} dest==business=${p.stripeDestinationAccountId === r.businessAcct} remaining_owed=${remainingPayableCents(p)}`,
    );
  }
}
await prisma.$disconnect();
