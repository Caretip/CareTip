/**
 * Phase 1 local certification: ephemeral disposable Postgres + migrations + webhook claim tests.
 *
 *   npm run test:phase1-isolated-cert
 *
 * Does not use DATABASE_URL from .env. Never targets Supabase (isolated gate).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startEphemeralIsolatedPostgres } from "./lib/ephemeralIsolatedPostgres.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");

function runStep(label: string, command: string, args: string[], extraEnv: Record<string, string>): number {
  console.log(`\n[phase1-cert] ${label}`);
  const result = spawnSync(command, args, {
    cwd: backendRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: true,
  });
  return result.status ?? 1;
}

async function verifyProcessingResultColumn(connectionUrl: string): Promise<void> {
  process.env.CARETIP_ISOLATED_POSTGRES_URL = connectionUrl;
  const { completeIsolatedPostgresBootstrap } = await import("./lib/isolatedPostgresTestGate.js");
  await completeIsolatedPostgresBootstrap();
  await import("../src/loadEnv.js");
  process.env.DATABASE_URL = connectionUrl;
  process.env.DATABASE_ALLOW_LOCALHOST = "true";
  const { prisma } = await import("../src/prisma.js");
  await prisma.$queryRaw`
    SELECT processing_result, processing_claim_token
    FROM stripe_webhook_events
    LIMIT 0
  `;
  await prisma.$disconnect();
  console.log("[phase1-cert] verified processing_result column on isolated database");
}

const pg = await startEphemeralIsolatedPostgres();
console.log(`[phase1-cert] ephemeral PostgreSQL listening on 127.0.0.1:${pg.port} (disposable)`);

const isolatedEnv = {
  CARETIP_ISOLATED_POSTGRES_URL: pg.connectionUrl,
  DATABASE_URL: pg.connectionUrl,
  DATABASE_ALLOW_LOCALHOST: "true",
};

let exitCode = 0;
try {
  if (runStep("prisma migrate deploy (isolated)", "npm", ["run", "db:migrate:isolated-test"], isolatedEnv) !== 0) {
    exitCode = 1;
    throw new Error("migrate failed");
  }

  await verifyProcessingResultColumn(pg.connectionUrl);

  if (runStep("tip webhook claim runtime", "npm", ["run", "test:tip-webhook-processing-claim"], isolatedEnv) !== 0) {
    exitCode = 1;
  }

  if (runStep("tip webhook HTTP concurrency", "npm", ["run", "test:tip-webhook-http-concurrency"], isolatedEnv) !== 0) {
    exitCode = 1;
  }

  if (runStep("sprint3 guest flow (isolated DB)", "npx", ["tsx", "scripts/sprint3-guest-flow-runtime.ts"], isolatedEnv) !== 0) {
    exitCode = 1;
  }

  if (runStep("payment pentest (static)", "npm", ["run", "test:payment-pentest"], {}) !== 0) {
    exitCode = 1;
  }

  if (runStep("TypeScript", "npx", ["tsc", "--noEmit"], {}) !== 0) {
    exitCode = 1;
  }
} finally {
  await pg.stop();
  console.log("\n[phase1-cert] ephemeral PostgreSQL stopped");
}

process.exit(exitCode);
