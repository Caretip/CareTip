/**
 * Sprint 1.2+ — disposable Postgres only. Never falls back to DATABASE_URL from .env.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendEnv = join(__dirname, "../../.env");
const rootEnv = join(__dirname, "../../../.env");

const ISOLATED_ENV = "CARETIP_ISOLATED_POSTGRES_URL";
const DISPOSABLE_ACK = "CARETIP_ISOLATED_POSTGRES_ACK_DISPOSABLE";

const BLOCKED_HOST_FRAGMENTS = ["supabase.co", "supabase.com", "pooler.supabase"];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

function loadEnvFilesForIsolatedKeyOnly(): void {
  if (existsSync(rootEnv)) {
    config({ path: rootEnv, quiet: true });
  }
  if (existsSync(backendEnv)) {
    config({ path: backendEnv, override: true, quiet: true });
  }
}

function parsePostgresHostname(connectionUrl: string): string {
  const normalized = connectionUrl.replace(/^postgresql:\/\//i, "http://").replace(/^postgres:\/\//i, "http://");
  return new URL(normalized).hostname.toLowerCase();
}

function assertDisposablePostgresTarget(connectionUrl: string): void {
  const lower = connectionUrl.toLowerCase();
  if (BLOCKED_HOST_FRAGMENTS.some((frag) => lower.includes(frag))) {
    console.error(
      `[isolated-db] Blocked: ${ISOLATED_ENV} appears to target Supabase. Use a disposable local or ephemeral PostgreSQL instance.`,
    );
    process.exit(2);
  }

  let host: string;
  try {
    host = parsePostgresHostname(connectionUrl);
  } catch {
    console.error(`[isolated-db] ${ISOLATED_ENV} is not a valid PostgreSQL connection URL.`);
    process.exit(2);
  }

  if (LOCAL_HOSTS.has(host)) {
    return;
  }

  if (process.env[DISPOSABLE_ACK] === "1") {
    return;
  }

  console.error(
    `[isolated-db] Blocked: host "${host}" is not local. Set ${DISPOSABLE_ACK}=1 only after confirming the database is disposable (not shared staging/production).`,
  );
  process.exit(2);
}

export function printIsolatedPostgresSetupHelp(): void {
  console.error(`
[isolated-db] ${ISOLATED_ENV} is required for Sprint 1.2 database tests.

These scripts never use DATABASE_URL from .env. Configure a disposable PostgreSQL instance, then:

  PowerShell:
    $env:${ISOLATED_ENV} = "postgresql://USER:PASSWORD@127.0.0.1:5433/caretip_s12_test"
    npm run db:migrate:isolated-test
    npm run test:subscription-reliability-sprint1_2-integration
    npm run test:subscription-b1

  Docker example (when available):
    docker run -d --name caretip-s12-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=caretip_s12_test -p 5433:5432 postgres:16

Apply all Prisma migrations only on that disposable database via db:migrate:isolated-test.
`);
}

/** Synchronous guard — call before any module that imports Prisma. */
export function enforceIsolatedPostgresOrExit(): string {
  loadEnvFilesForIsolatedKeyOnly();

  const isolated = process.env[ISOLATED_ENV]?.trim();
  if (!isolated) {
    printIsolatedPostgresSetupHelp();
    process.exit(2);
  }

  assertDisposablePostgresTarget(isolated);
  process.env.DATABASE_URL = isolated;
  return isolated;
}

/** After loadEnv merge, force DATABASE_URL back to the isolated target. */
export async function completeIsolatedPostgresBootstrap(): Promise<string> {
  const isolated = enforceIsolatedPostgresOrExit();
  await import("../../src/loadEnv.js");
  process.env.DATABASE_URL = isolated;

  const active = process.env.DATABASE_URL?.trim() ?? "";
  if (active !== isolated) {
    console.error("[isolated-db] Internal error: DATABASE_URL was not pinned to isolated target.");
    process.exit(2);
  }

  const host = parsePostgresHostname(isolated);
  if (!LOCAL_HOSTS.has(host) && process.env[DISPOSABLE_ACK] !== "1") {
    assertDisposablePostgresTarget(isolated);
  }

  return isolated;
}
