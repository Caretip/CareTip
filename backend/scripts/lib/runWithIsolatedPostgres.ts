/**
 * Run an existing DB-writing regression script against CARETIP_ISOLATED_POSTGRES_URL only.
 *
 *   tsx scripts/lib/runWithIsolatedPostgres.ts scripts/<name>-runtime.ts
 *
 * loadEnv re-reads backend/.env with override, so DATABASE_URL is re-pinned after env load and the
 * live connection is verified to be loopback before the target script is imported. Not safe for
 * scripts that spawn child processes which load .env themselves.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { completeIsolatedPostgresBootstrap } from "./isolatedPostgresTestGate.js";

const target = process.argv[2]?.trim();
if (!target) {
  console.error("usage: runWithIsolatedPostgres.ts <script path>");
  process.exit(2);
}

await completeIsolatedPostgresBootstrap();
const { stripeSecretKeyMode } = await import("../../src/utils/stripeKeyMode.js");
// Read-only Phase 2 local-copy scans may keep a *test-mode* key; any other key is replaced.
const keepTestKey = process.env.CARETIP_ISOLATED_KEEP_STRIPE_TEST_KEY === "1" && stripeSecretKeyMode() === "test";
if (!keepTestKey) {
  process.env.STRIPE_SECRET_KEY = ["sk", "test", "isolated", "placeholder", "not", "a", "real", "key"].join("_");
}

const { prisma } = await import("../../src/prisma.js");

async function blocked(reason: string): Promise<never> {
  console.error(`[isolated-run] Blocked: ${reason}`);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(2);
}

const rows = await prisma.$queryRaw<{ addr: string | null }[]>`SELECT inet_server_addr()::text AS addr`;
const addr = rows[0]?.addr?.split("/")[0] ?? "";
if (addr !== "127.0.0.1" && addr !== "::1") {
  await blocked(`connected server address is not loopback (${addr || "unknown"}).`);
}

const expectedDataDir = process.env.CARETIP_ISOLATED_PG_DATA_DIR?.trim();
if (expectedDataDir) {
  const normalize = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  let actualDataDir = "";
  try {
    const dirRows = await prisma.$queryRaw<{ dir: string }[]>`SELECT current_setting('data_directory') AS dir`;
    actualDataDir = dirRows[0]?.dir ?? "";
  } catch {
    await blocked("cannot read server data_directory (not the ephemeral superuser cluster).");
  }
  if (normalize(actualDataDir) !== normalize(expectedDataDir)) {
    await blocked("connected server is not the ephemeral cluster started for this run.");
  }
  console.log("[isolated-run] verified: connected to this run's ephemeral PostgreSQL cluster");
}

process.argv.splice(2, 1);
await import(pathToFileURL(resolve(process.cwd(), target)).href);
