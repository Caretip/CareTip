/**
 * Phase 2 read-only financial integrity scan of the sanitized local validation copy.
 *
 *   npx tsx scripts/phase2-local-copy.ts scan
 *
 * Runs only against the loopback copy produced by phase2-local-copy.ts (marker table required); the
 * shared development database is never scanned. Scope = manifest businesses classified
 * non-fixture / test-mode-real-format. Stripe access: test-mode key, retrieve/list calls only.
 * Prints counts, internal ids and labels only. Exit 0 = scan ran; 1 = scan error; 2 = blocked.
 */
import "../src/loadEnv.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { EmployeeTipPayoutMode } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { reconcileBusinessPayables } from "../src/services/businessPayoutReconciliation.service.js";
import { reconcileEmployeeDirectPayables } from "../src/services/employeePayoutReconciliation.service.js";
import { getStripeClient, isStripeConfigured } from "../src/services/stripe.service.js";
import { stripeSecretKeyMode } from "../src/utils/stripeKeyMode.js";
import { ledgerStartedAt, runIntegrityChecks, type Finding } from "./lib/phase2IntegrityChecks.js";
import { phase2StateDir } from "./lib/phase2LocalCluster.js";
import {
  stripeReaderFromClient,
  verifyPayable,
  verifyRefund,
  type LookupCheck,
  type LookupOutcome,
} from "./lib/phase2StripeExactLookup.js";

const MAX_STRIPE_LOOKUPS = Math.max(0, Number.parseInt(process.env.PHASE2_MAX_STRIPE_LOOKUPS ?? "3000", 10) || 3000);
const OUTCOMES: LookupOutcome[] = ["match", "mismatch", "not_found", "unsupported_synthetic", "inconclusive"];

function blocked(reason: string): never {
  console.error(`[phase2-scan] BLOCKED: ${reason}`);
  process.exit(2);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function printFindings(findings: Finding[], showIds: boolean) {
  for (const area of [...new Set(findings.map((f) => f.area))].sort((a, b) => a - b)) {
    console.log(`  [area ${area}]`);
    for (const f of findings.filter((x) => x.area === area)) {
      const ids = showIds && f.ids.length ? `  ids=${f.ids.slice(0, 8).join(",")}${f.ids.length > 8 ? ",..." : ""}` : "";
      console.log(`    ${f.key}: ${f.ids.length}${f.ids.length ? ` [${f.classification}]` : ""}${ids}`);
    }
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main() {
  if (process.env.CARETIP_PHASE2_LOCAL_COPY_SCAN !== "1" || process.env.NODE_ENV === "production") {
    blocked("run via `phase2-local-copy.ts scan` (CARETIP_PHASE2_LOCAL_COPY_SCAN=1, NODE_ENV != production)");
  }
  const where = await prisma.$queryRaw<{ addr: string | null; marker: string | null }[]>`
    SELECT inet_server_addr()::text AS addr, to_regclass('public._caretip_phase2_copy')::text AS marker`;
  const addr = where[0]?.addr?.split("/")[0] ?? "";
  if (addr !== "127.0.0.1" && addr !== "::1") blocked("database is not loopback");
  if (!where[0]?.marker) blocked("database is not a Phase 2 sanitized local copy (marker table missing)");

  const meta = new Map(
    (await prisma.$queryRaw<{ key: string; value: string }[]>`SELECT key, value FROM "_caretip_phase2_copy"`).map((r) => [r.key, r.value]),
  );
  const manifest = await prisma.$queryRaw<{ business_id: string; class: string }[]>`
    SELECT business_id, class FROM "_caretip_phase2_manifest"`;
  const inScope = manifest.filter((m) => m.class === "non-fixture" || m.class === "test-mode-real-format").map((m) => m.business_id);
  const fixtureScope = manifest.filter((m) => m.class === "fixture").map((m) => m.business_id);
  const notCleared = new Set<string>(JSON.parse(meta.get("inconclusive_records") ?? "[]") as string[]);

  section("Target and scope");
  console.log(`  local copy of source ${meta.get("source_fingerprint")} at ${meta.get("copied_at")} (${meta.get("sanitizer_version")})`);
  console.log(`  manifest sha ${meta.get("manifest_sha")}`);
  const byClass = new Map<string, number>();
  for (const m of manifest) byClass.set(m.class, (byClass.get(m.class) ?? 0) + 1);
  console.log(`  manifest: ${[...byClass.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  scan scope: ${inScope.length} businesses (non-fixture + test-mode-real-format); fixture/demo-seed excluded`);
  console.log(`  in-scope records not cleared as legitimate (manifest): ${notCleared.size}`);

  const ledgerStartAt = await ledgerStartedAt(prisma);
  console.log(`  payable ledger introduced at: ${ledgerStartAt?.toISOString() ?? "(unknown)"}`);
  const [tips, payables, refunds, allocations] = await Promise.all([
    prisma.transaction.groupBy({ by: ["status"], where: { businessId: { in: inScope } }, _count: { _all: true } }),
    prisma.employeeTipPayable.groupBy({ by: ["routingMode", "chargeModel", "status"], where: { businessId: { in: inScope } }, _count: { _all: true } }),
    prisma.tipRefund.groupBy({ by: ["kind", "status"], where: { businessId: { in: inScope } }, _count: { _all: true } }),
    prisma.employeeTipDistributionAllocation.count({ where: { businessId: { in: inScope } } }),
  ]);
  for (const t of tips) console.log(`  tips ${t.status}: ${t._count._all}`);
  for (const p of payables) console.log(`  payable ${p.routingMode}/${p.chargeModel}/${p.status}: ${p._count._all}`);
  for (const r of refunds) console.log(`  tip_refund ${r.kind}/${r.status}: ${r._count._all}`);
  console.log(`  distribution allocations: ${allocations}`);

  section("Integrity checks — representative scope");
  const findings = await runIntegrityChecks(prisma, { businessIds: inScope, ledgerStartAt });
  printFindings(findings, true);

  section("Integrity checks — fixture tenants (intentional anomalies; not a verdict)");
  const fixtureFindings = await runIntegrityChecks(prisma, { businessIds: fixtureScope, ledgerStartAt });
  for (const f of fixtureFindings.filter((x) => x.ids.length && x.area !== 12)) {
    console.log(`  ${f.key}: ${f.ids.length} [${f.classification}]`);
  }

  section("11. Stripe ↔ PostgreSQL (exact references, read-only)");
  const stripeMode = stripeSecretKeyMode();
  const checks: LookupCheck[] = [];
  const reconSummary: string[] = [];
  let stripeStatus: "RAN" | "SKIPPED" = "SKIPPED";
  if (stripeMode !== "test" || !isStripeConfigured()) {
    console.log(`  SKIPPED: Stripe key mode is '${stripeMode}' (test-mode key required; never live)`);
  } else {
    stripeStatus = "RAN";
    const reader = stripeReaderFromClient(getStripeClient());
    const payableRows = await prisma.employeeTipPayable.findMany({
      where: { businessId: { in: inScope } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, chargeModel: true, status: true, grossCents: true, platformFeeCents: true, transferredCents: true,
        stripePaymentIntentId: true, stripeChargeId: true, stripeTransferId: true, stripeDestinationAccountId: true,
        employee: { select: { stripeAccount: { select: { stripeAccountId: true } } } },
      },
    });
    const refundRows = await prisma.tipRefund.findMany({
      where: { businessId: { in: inScope } },
      select: { id: true, kind: true, status: true, amountEur: true, stripeRefundId: true, stripeDisputeId: true, stripePaymentIntentId: true },
    });
    const budget = Math.floor(MAX_STRIPE_LOOKUPS / 2);
    if (payableRows.length > budget || refundRows.length > budget) {
      console.log(`  lookup budget ${MAX_STRIPE_LOOKUPS}: comparing first ${budget} payables/refunds (remainder reported as not examined)`);
    }
    const payableChecks = await mapLimit(payableRows.slice(0, budget), 4, (p) =>
      verifyPayable(reader, {
        ...p,
        employeeStripeAccountId: p.employee?.stripeAccount?.stripeAccountId ?? null,
      }),
    );
    checks.push(...payableChecks.flat());
    const refundChecks = await mapLimit(refundRows.slice(0, budget), 4, (r) =>
      verifyRefund(reader, {
        id: r.id, kind: r.kind, status: r.status, amountCents: Math.round(Number(r.amountEur) * 100),
        stripeRefundId: r.stripeRefundId, stripeDisputeId: r.stripeDisputeId, stripePaymentIntentId: r.stripePaymentIntentId,
      }),
    );
    checks.push(...refundChecks.filter((c): c is LookupCheck => c != null));
    console.log(`  not examined (budget): payables ${Math.max(0, payableRows.length - budget)}, refunds ${Math.max(0, refundRows.length - budget)}`);
    for (const obj of ["payment_intent", "transfer", "refund", "dispute"] as const) {
      const list = checks.filter((c) => c.object === obj);
      if (!list.length) continue;
      console.log(`  ${obj}: ${OUTCOMES.map((o) => `${o}=${list.filter((c) => c.outcome === o).length}`).join(" ")}`);
    }
    for (const c of checks.filter((x) => x.outcome === "mismatch" || x.outcome === "not_found").slice(0, 30)) {
      console.log(`    ${c.outcome} ${c.object} ${c.subjectId}: ${c.detail}`);
    }
    const inconclusiveReasons = new Map<string, number>();
    for (const c of checks.filter((x) => x.outcome === "inconclusive")) {
      inconclusiveReasons.set(c.detail, (inconclusiveReasons.get(c.detail) ?? 0) + 1);
    }
    for (const [d, n] of inconclusiveReasons) console.log(`    inconclusive (${n}): ${d}`);

    // Listing-based reconciliation (detects Stripe transfers the ledger does not reference) for every in-scope tenant.
    const employees = await prisma.employeeTipPayable.findMany({
      where: { businessId: { in: inScope }, routingMode: EmployeeTipPayoutMode.direct_to_employee, employeeId: { not: null } },
      distinct: ["employeeId"],
      select: { employeeId: true },
    });
    const empStatus = new Map<string, number>();
    let empInconclusive = 0;
    let empNoAccount = 0;
    const stripeAhead: string[] = [];
    for (const { employeeId } of employees) {
      const r = await reconcileEmployeeDirectPayables(employeeId!);
      const acct = await prisma.employeeStripeAccount.findUnique({ where: { employeeId: employeeId! }, select: { stripeAccountId: true } });
      const nothingToVerify = r.complete && r.rows.every((row) => row.status === "CARETIP_PENDING");
      if (!acct?.stripeAccountId?.startsWith("acct_") && nothingToVerify) empNoAccount += 1;
      else if (!r.stripeReadable || !r.complete) empInconclusive += 1;
      for (const row of r.rows) {
        empStatus.set(row.status, (empStatus.get(row.status) ?? 0) + 1);
        if (row.status === "MATCHED" && (row.caretipStatus === "held_platform" || row.caretipStatus === "transferring")) {
          stripeAhead.push(row.payableId);
        }
      }
    }
    const bizStatus = new Map<string, number>();
    let bizInconclusive = 0;
    for (const businessId of inScope) {
      const r = await reconcileBusinessPayables(businessId);
      if (r.totalPayableCount === 0) continue;
      if (!r.stripeReadable || !r.complete) bizInconclusive += 1;
      for (const row of r.rows) bizStatus.set(row.status, (bizStatus.get(row.status) ?? 0) + 1);
    }
    reconSummary.push(
      `employee reconciliation: ${employees.length} employees (incomplete/unreadable ${empInconclusive}; no connected account, only CareTip-held payables ${empNoAccount}) ${[...empStatus.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" ")}`,
      `business reconciliation: inconclusive ${bizInconclusive} ${[...bizStatus.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" ")}`,
      `Stripe transfer exists but ledger not transferred (incomplete operation): ${stripeAhead.length}${stripeAhead.length ? ` ids=${stripeAhead.join(",")}` : ""}`,
    );
    for (const line of reconSummary) console.log(`  ${line}`);
  }

  section("Summary");
  const withRows = findings.filter((f) => f.ids.length > 0);
  for (const cls of ["defect", "investigate", "uncertain", "expected-lifecycle", "expected-legacy"] as const) {
    const list = withRows.filter((f) => f.classification === cls);
    console.log(`  ${cls}: ${list.length} checks with rows${list.length ? ` (${list.map((f) => `${f.key}=${f.ids.length}`).join(", ")})` : ""}`);
  }
  const stripeBad = checks.filter((c) => c.outcome === "mismatch" || c.outcome === "not_found").length;
  console.log(`  stripe: ${stripeStatus}; mismatches/not_found ${stripeBad}; inconclusive ${checks.filter((c) => c.outcome === "inconclusive").length}`);

  const detailPath = join(phase2StateDir(), `scan-${Date.now()}.json`);
  writeFileSync(
    detailPath,
    JSON.stringify({ meta: Object.fromEntries(meta), scope: inScope, findings, fixtureFindings, stripeStatus, checks, reconSummary }, null, 2),
  );
  console.log(`  detail (ids/labels only): ${detailPath}`);
  console.log("  scan complete (read-only)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
