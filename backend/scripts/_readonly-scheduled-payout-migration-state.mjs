/**
 * Read-only migration/column inspection (no secrets in stdout).
 * Usage: node scripts/_readonly-scheduled-payout-migration-state.mjs
 */
import "../src/loadEnv.js";
import { PrismaClient } from "@prisma/client";

function sanitizeDatabaseTarget() {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return { configured: false };
  try {
    const u = new URL(raw.replace(/^postgresql:\/\//i, "http://"));
    const user = decodeURIComponent(u.username || "");
    const projectRef = user.includes(".") ? user.split(".")[1] : user.slice(0, 12);
    return {
      configured: true,
      host: u.hostname,
      port: u.port || "5432",
      database: u.pathname.replace(/^\//, "") || "postgres",
      supabaseProjectRefHint: projectRef ? `${projectRef.slice(0, 8)}…` : null,
      pooler: u.hostname.includes("pooler.supabase.com"),
    };
  } catch {
    return { configured: true, host: "parse_failed" };
  }
}

function stripeKeyMode() {
  const k = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (k.startsWith("sk_live_")) return "live";
  if (k.startsWith("sk_test_")) return "test";
  if (k) return "other";
  return "unset";
}

const prisma = new PrismaClient();
try {
  const target = sanitizeDatabaseTarget();
  const context = {
    nodeEnv: process.env.NODE_ENV ?? "(unset)",
    renderService: process.env.RENDER_SERVICE_NAME ?? "(unset)",
    stripeKeyMode: stripeKeyMode(),
    database: target,
  };
  console.log("INSPECTION_CONTEXT", JSON.stringify(context, null, 2));

  const migrations = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at, logs
    FROM _prisma_migrations
    WHERE migration_name IN (
      '20261010180000_scheduled_payout_recovery_fields',
      '20261010210000_scheduled_payout_claim_token'
    )
    ORDER BY migration_name
  `;
  console.log("MIGRATIONS", JSON.stringify(migrations, null, 2));

  const cols = await prisma.$queryRaw`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'employee_stripe_scheduled_payout_requests',
        'stripe_connect_scheduled_payout_requests'
      )
      AND column_name IN (
        'processing_claim_token',
        'processing_claimed_at',
        'attempt_count',
        'reconciliation_status',
        'failure_classification'
      )
    ORDER BY table_name, column_name
  `;
  console.log("COLUMNS", JSON.stringify(cols, null, 2));
} finally {
  await prisma.$disconnect();
}
