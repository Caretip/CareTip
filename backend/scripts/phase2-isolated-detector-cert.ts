/**
 * Phase 2: run financial integrity / reconciliation regression suites on disposable Postgres.
 *
 *   npm run test:phase2-isolated-cert
 *
 * Fixture-writing suites never touch the .env database (see runWithIsolatedPostgres.ts).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startEphemeralIsolatedPostgres } from "./lib/ephemeralIsolatedPostgres.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");

const ISOLATED_SUITES = [
  "schema-migration-parity-runtime.ts",
  "business-distribution-integrity-runtime.ts",
  "employee-payout-reconciliation-runtime.ts",
  "business-payout-reconciliation-runtime.ts",
  "tip-distribution-runtime.ts",
  "financial-p0-remediation-runtime.ts",
  "financial-pass2-period-runtime.ts",
  "employee-tip-dispute-lifecycle-runtime.ts",
  "employee-tip-direct-routing-runtime.ts",
  "employee-transfer-failed-recovery-runtime.ts",
  "employee-transfer-recovery-generalized-runtime.ts",
  "employee-transfer-failure-injection-runtime.ts",
  "employee-transfer-lookup-recovery-runtime.ts",
  "employee-transfer-reconciliation-job-runtime.ts",
  "connect-payout-reconciliation-safety-runtime.ts",
  "phase2-financial-integrity-detector-runtime.ts",
  "employee-transfer-release-concurrency-runtime.ts",
  "employee-transfer-expired-claim-inflight-runtime.ts",
  "financial-multi-instance-concurrency-runtime.ts",
  "employee-stripe-connect-foundation-runtime.ts",
  "transition-window-payable-backfill-runtime.ts",
  "session-timezone-utc-runtime.ts",
];

type StepResult = { label: string; status: "PASS" | "FAIL" };
const results: StepResult[] = [];

function runStep(label: string, command: string, args: string[], extraEnv: Record<string, string>): boolean {
  console.log(`\n[phase2-cert] ${label}`);
  const result = spawnSync(command, args, {
    cwd: backendRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: true,
  });
  const ok = result.status === 0;
  results.push({ label, status: ok ? "PASS" : "FAIL" });
  return ok;
}

const pg = await startEphemeralIsolatedPostgres();
console.log(`[phase2-cert] ephemeral PostgreSQL listening on 127.0.0.1:${pg.port} (disposable)`);

const isolatedEnv = {
  CARETIP_ISOLATED_POSTGRES_URL: pg.connectionUrl,
  DATABASE_URL: pg.connectionUrl,
  DATABASE_ALLOW_LOCALHOST: "true",
  CARETIP_ISOLATED_PG_DATA_DIR: pg.databaseDir,
};

try {
  if (!runStep("prisma migrate deploy (isolated)", "npm", ["run", "db:migrate:isolated-test"], isolatedEnv)) {
    throw new Error("migrate failed");
  }
  const only = process.env.CARETIP_CERT_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  if (only?.some((s) => !/^[a-z0-9-]+-runtime\.ts$/.test(s))) throw new Error("CARETIP_CERT_ONLY: invalid suite name");
  for (const suite of only ?? ISOLATED_SUITES) {
    runStep(suite, "npx", ["tsx", "scripts/lib/runWithIsolatedPostgres.ts", `scripts/${suite}`], isolatedEnv);
  }
  if (!only) {
    runStep("tip webhook claim (Phase 1)", "npm", ["run", "test:tip-webhook-processing-claim"], isolatedEnv);
    runStep("tip webhook HTTP (Phase 1)", "npm", ["run", "test:tip-webhook-http-concurrency"], isolatedEnv);
    runStep("prisma validate", "npx", ["prisma", "validate"], {});
    runStep("TypeScript", "npx", ["tsc", "--noEmit"], {});
  }
} finally {
  await pg.stop();
  console.log("\n[phase2-cert] ephemeral PostgreSQL stopped");
}

console.log("\n[phase2-cert] summary");
for (const r of results) {
  console.log(`  ${r.status}  ${r.label}`);
}
process.exit(results.every((r) => r.status === "PASS") ? 0 : 1);
