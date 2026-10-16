/**
 * Phase 4: query plans for money / dashboard hot paths on the sanitized Phase 2 local copy.
 *
 *   npx tsx scripts/phase2-local-copy.ts run scripts/phase4-query-plans.ts
 *
 * Local copy only. Writes nothing but planner statistics (ANALYZE); plans run in a READ ONLY
 * transaction and the index what-if runs in a transaction that is always rolled back.
 * Prints plan shapes, index usage, timings and counts only.
 * Each query is planned twice: as-is, and with enable_seqscan=off to show whether an index can
 * serve the predicate once the table outgrows the local copy (small tables favour seq scans).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/prisma.js";

if (process.env.CARETIP_PHASE2_LOCAL_COPY_SCAN !== "1") {
  console.error("[phase4-plans] Blocked: run only via phase2-local-copy.ts run (local copy)");
  process.exit(2);
}
const marker = await prisma.$queryRaw<{ ok: boolean }[]>`
  SELECT to_regclass('public._caretip_phase2_copy') IS NOT NULL AS ok`;
if (!marker[0]?.ok) {
  console.error("[phase4-plans] Blocked: database is not a Phase 2 local copy");
  process.exit(2);
}

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

type PlanNode = { "Node Type": string; "Index Name"?: string; "Relation Name"?: string; Plans?: PlanNode[] };
type ExplainRow = { "QUERY PLAN": Array<{ Plan: PlanNode & { "Actual Total Time": number; "Actual Rows": number }; "Execution Time": number }> };

function walk(node: PlanNode, out: string[]): void {
  const rel = node["Relation Name"] ? ` ${node["Relation Name"]}` : "";
  const idx = node["Index Name"] ? ` [${node["Index Name"]}]` : "";
  if (/Scan/.test(node["Node Type"])) out.push(`${node["Node Type"]}${rel}${idx}`);
  for (const child of node.Plans ?? []) walk(child, out);
}

async function planShapes(tx: Prisma.TransactionClient, sql: string): Promise<{ ms: number; asIs: string[]; noSeq: string[] }> {
  const shapes: string[][] = [];
  let ms = 0;
  for (const seqOff of [false, true]) {
    await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = ${seqOff ? "off" : "on"}`);
    const rows = await tx.$queryRawUnsafe<ExplainRow[]>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
    const plan = rows[0]!["QUERY PLAN"][0]!;
    if (!seqOff) ms = plan["Execution Time"];
    const out: string[] = [];
    walk(plan.Plan, out);
    shapes.push(out);
  }
  await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = on");
  return { ms, asIs: shapes[0]!, noSeq: shapes[1]! };
}

function printPlan(name: string, p: { ms: number; asIs: string[]; noSeq: string[] }): void {
  const forcedSeq = p.noSeq.some((s) => s.startsWith("Seq Scan"));
  console.log(`  ${name}: ${p.ms.toFixed(2)}ms`);
  console.log(`    as-is:  ${p.asIs.join(" ; ")}`);
  console.log(`    no-seq: ${p.noSeq.join(" ; ")}${forcedSeq ? "   <-- NO USABLE INDEX" : ""}`);
}

await prisma.$executeRawUnsafe("ANALYZE");
const whatIf: Array<[string, string]> = [];

await prisma.$transaction(
  async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

    const sizes = await tx.$queryRaw<{ table: string; rows: bigint }[]>`
      SELECT relname AS table, n_live_tup AS rows FROM pg_stat_user_tables
      WHERE relname IN ('tips','employee_tip_payables','tip_refunds','employee_tip_distribution_allocations',
                        'stripe_connect_payouts','employee_stripe_payouts','stripe_webhook_events')
      ORDER BY relname`;
    console.log("\n[phase4-plans] table sizes (local copy):");
    for (const s of sizes) console.log(`  ${s.table}: ${s.rows}`);

    const [biz] = await tx.$queryRaw<{ id: string }[]>`
      SELECT business_id AS id FROM tips GROUP BY business_id ORDER BY count(*) DESC LIMIT 1`;
    const [emp] = await tx.$queryRaw<{ id: string }[]>`
      SELECT employee_id AS id FROM tips WHERE employee_id IS NOT NULL GROUP BY employee_id ORDER BY count(*) DESC LIMIT 1`;
    const [pay] = await tx.$queryRaw<{ id: string; tx: string; pi: string; ch: string | null; biz: string; emp: string | null }[]>`
      SELECT id, transaction_id AS tx, stripe_payment_intent_id AS pi, stripe_charge_id AS ch, business_id AS biz, employee_id AS emp
      FROM employee_tip_payables WHERE stripe_charge_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`;
    const payIds = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM employee_tip_payables ORDER BY created_at DESC LIMIT 20`;
    if (!biz || !emp || !pay) throw new Error("local copy has no tips/payables to sample");

    const inList = payIds.map((r) => q(r.id)).join(",");
    const queries: Array<[string, string]> = [
      ["webhook: tip by payment intent", `SELECT id, business_id FROM tips WHERE stripe_payment_intent_id = ${q(pay.pi)}`],
      ["dispute fallback: payable by charge", `SELECT business_id, transaction_id FROM employee_tip_payables WHERE stripe_charge_id = ${q(pay.ch ?? "")} LIMIT 1`],
      ["refund/dispute: payable by transaction", `SELECT id FROM employee_tip_payables WHERE transaction_id = ${q(pay.tx)}`],
      ["distribution: lockable payables", `SELECT id FROM employee_tip_payables WHERE business_id = ${q(pay.biz)} AND employee_id = ${q(pay.emp ?? "")} AND routing_mode = 'business_distribution' AND charge_model = 'destination_business' AND status = 'held_business' ORDER BY created_at`],
      ["distribution: allocation totals", `SELECT employee_tip_payable_id, sum(amount_cents) FROM employee_tip_distribution_allocations WHERE employee_tip_payable_id IN (${inList}) GROUP BY 1`],
      ["release: held for employee", `SELECT id FROM employee_tip_payables WHERE employee_id = ${q(emp.id)} AND charge_model = 'platform_hold' AND routing_mode = 'direct_to_employee' AND status IN ('held_platform','transfer_failed') AND stripe_transfer_id IS NULL ORDER BY created_at LIMIT 50`],
      ["release tick: stale transferring", `SELECT id FROM employee_tip_payables WHERE charge_model = 'platform_hold' AND routing_mode = 'direct_to_employee' AND status = 'transferring' AND stripe_transfer_id IS NULL AND updated_at < now() - interval '15 minutes' ORDER BY updated_at LIMIT 50`],
      ["reconcile tick: blocked/uncertain", `SELECT id FROM employee_tip_payables WHERE stripe_transfer_id IS NULL AND charge_model = 'platform_hold' AND routing_mode = 'direct_to_employee' AND status IN ('held_platform','transfer_failed','transferring') AND (last_transfer_error LIKE 'rel_durable:1:%' OR last_transfer_error LIKE '%post_reclaim_empty_lookup%' OR last_transfer_error LIKE 'ops_uncertain:%' OR (status = 'transferring' AND updated_at < now() - interval '15 minutes')) LIMIT 50`],
      ["dashboard: business tips", `SELECT id, amount, created_at FROM tips WHERE business_id = ${q(biz.id)} AND status = 'success' ORDER BY created_at DESC LIMIT 50`],
      ["dashboard: business 30d sum", `SELECT sum(amount) FROM tips WHERE business_id = ${q(biz.id)} AND status = 'success' AND created_at >= now() - interval '30 days'`],
      ["dashboard: employee tips", `SELECT id, amount, created_at FROM tips WHERE employee_id = ${q(emp.id)} AND status = 'success' ORDER BY created_at DESC LIMIT 50`],
      ["employee summary: payables", `SELECT status, payable_cents FROM employee_tip_payables WHERE employee_id = ${q(emp.id)}`],
      ["finance: refunds for business", `SELECT id FROM tip_refunds WHERE business_id = ${q(biz.id)} ORDER BY occurred_at DESC LIMIT 50`],
      ["payouts: business history", `SELECT id FROM stripe_connect_payouts WHERE business_id = ${q(biz.id)} ORDER BY created_at DESC LIMIT 20`],
      ["ops: aged held_business", `SELECT id FROM employee_tip_payables WHERE status = 'held_business' AND created_at < now() - interval '30 days'`],
    ];

    console.log("\n[phase4-plans] query plans (as-is | enable_seqscan=off):");
    for (const [name, sql] of queries) printPlan(name, await planShapes(tx, sql));
    whatIf.push(
      ["dispute fallback: payable by charge", queries[1]![1]],
      ["dashboard: business tips", queries[8]![1]],
      ["dashboard: employee tips", queries[10]![1]],
      ["FK check: any tip for business", `SELECT 1 FROM tips WHERE business_id = ${q(biz.id)} LIMIT 1`],
      ["legacy hero: success+paid sum", `SELECT sum(amount) FROM tips WHERE employee_id = ${q(emp.id)} AND status = 'success' AND payout_status = 'paid'`],
    );

    const redundant = await tx.$queryRaw<{ table: string; redundant: string; covered_by: string }[]>(Prisma.sql`
      SELECT a.indrelid::regclass::text AS table, a.indexrelid::regclass::text AS redundant,
             b.indexrelid::regclass::text AS covered_by
      FROM pg_index a
      JOIN pg_index b ON a.indrelid = b.indrelid AND a.indexrelid <> b.indexrelid
      JOIN pg_class c ON c.oid = a.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE NOT a.indisunique AND NOT a.indisprimary
        AND a.indpred IS NULL AND b.indpred IS NULL AND a.indexprs IS NULL AND b.indexprs IS NULL
        AND a.indnatts < b.indnatts
        AND (b.indkey::int2[])[0:a.indnatts - 1] = (a.indkey::int2[])[0:a.indnatts - 1]
      ORDER BY 1, 2`);
    console.log("\n[phase4-plans] non-unique indexes that are a column-prefix of another index:");
    for (const r of redundant) console.log(`  ${r.table}: ${r.redundant}  (covered by ${r.covered_by})`);

    const payoutStatus = await tx.$queryRaw<{ payout_status: string; status: string; n: bigint }[]>`
      SELECT payout_status::text, status::text, count(*) AS n FROM tips GROUP BY 1, 2 ORDER BY 1, 2`;
    console.log("\n[phase4-plans] legacy tips.payout_status distribution:");
    for (const r of payoutStatus) console.log(`  payout_status=${r.payout_status} status=${r.status}: ${r.n}`);
  },
  { timeout: 120_000 },
);

const ROLLBACK = new Error("phase4 what-if rollback");
console.log("\n[phase4-plans] what-if (rolled back): +payables(stripe_charge_id), -tips_business_id_idx, -tips_employee_id_status_payout_status_idx");
await prisma
  .$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`CREATE INDEX "employee_tip_payables_stripe_charge_id_idx" ON "employee_tip_payables" ("stripe_charge_id")`);
      await tx.$executeRawUnsafe(`DROP INDEX "tips_business_id_idx"`);
      await tx.$executeRawUnsafe(`DROP INDEX "tips_employee_id_status_payout_status_idx"`);
      for (const [name, sql] of whatIf) printPlan(name, await planShapes(tx, sql));
      throw ROLLBACK;
    },
    { timeout: 120_000 },
  )
  .catch((err: unknown) => {
    if (!(err instanceof Error && err.message === ROLLBACK.message)) throw err;
  });

await prisma.$disconnect();
console.log("\n[phase4-plans] done (read-only)");
