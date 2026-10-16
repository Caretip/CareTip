/**
 * Read-only environment safety probe (no secrets printed).
 *   npm run scan:phase2-staging-safety-probe
 *
 * Hostname heuristics cannot prove a database is the approved staging copy (Supabase pooler
 * hosts look identical across projects), so the scan also requires an explicit operator ack.
 */
import "../src/loadEnv.js";
import { stripeSecretKeyMode } from "../src/utils/stripeKeyMode.js";

const STAGING_ACK_ENV = "CARETIP_PHASE2_STAGING_ACK";

function parseDbHost(connectionUrl: string): string {
  try {
    const normalized = connectionUrl
      .replace(/^postgresql:\/\//i, "http://")
      .replace(/^postgres:\/\//i, "http://");
    const u = new URL(normalized);
    return `${u.hostname}:${u.port || "5432"}`;
  } catch {
    return "(unparseable)";
  }
}

const rawDb = process.env.DATABASE_URL?.trim() ?? "";
const host = rawDb ? parseDbHost(rawDb) : "(unset)";
const stripeMode = stripeSecretKeyMode();

console.log("[phase2-safety-probe]");
console.log(`  nodeEnv: ${process.env.NODE_ENV ?? "(unset)"}`);
console.log(`  databaseHost: ${host}`);
console.log(`  stripeKeyMode: ${stripeMode}`);

if (!rawDb) {
  console.error("[phase2-safety-probe] BLOCKED: DATABASE_URL unset.");
  process.exit(2);
}
if (stripeMode !== "test") {
  console.error(`[phase2-safety-probe] BLOCKED: STRIPE_SECRET_KEY mode is ${stripeMode}, not test.`);
  process.exit(2);
}
if (process.env.NODE_ENV === "production") {
  console.error("[phase2-safety-probe] BLOCKED: NODE_ENV=production.");
  process.exit(2);
}

const { prisma } = await import("../src/prisma.js");
try {
  const cols = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM information_schema.columns
    WHERE table_name = 'stripe_webhook_events' AND column_name = 'processing_result'
  `;
  const migration = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM _prisma_migrations
    WHERE migration_name = '20261015140000_stripe_webhook_processing_claim'
      AND finished_at IS NOT NULL
  `;
  const tz = await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
  console.log(`  processingResultColumn: ${Number(cols[0]?.n ?? 0) > 0 ? "present" : "missing"}`);
  console.log(`  phase1MigrationApplied: ${Number(migration[0]?.n ?? 0) > 0 ? "yes" : "no"}`);
  // TIMESTAMP (no tz) columns + raw SQL Date params make period filters depend on this being UTC.
  console.log(`  sessionTimeZone: ${tz[0]?.tz ?? "(unknown)"}`);
} finally {
  await prisma.$disconnect().catch(() => undefined);
}

if (process.env[STAGING_ACK_ENV] !== "1") {
  console.error(
    `[phase2-safety-probe] BLOCKED: set ${STAGING_ACK_ENV}=1 only after confirming DATABASE_URL is the approved staging copy (not production or a shared dev database).`,
  );
  process.exit(2);
}

process.exit(0);
