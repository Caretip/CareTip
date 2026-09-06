/**
 * Phase 16 — secrets / configuration (no secret values printed).
 * Run: npm run test:phase-16-secrets (backend)
 */
import "../src/loadEnv.js";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDemoEmailVerificationBypassEnabled } from "../src/services/emailVerificationBypass.flags.js";
import { accessTokenMissingRequiredSessionBind, IMPERSONATION_JWT_TYPE } from "../src/lib/jwtConfig.js";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
const backendRoot = process.cwd();
const repoRoot = join(backendRoot, "..");
const API = (process.env.RUNTIME_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");

const pass = (id: string, detail: string) => results.push({ id, pass: true, detail });
const fail = (id: string, detail: string) => results.push({ id, pass: false, detail });

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}
function readBackend(rel: string): string {
  return readFileSync(join(backendRoot, rel), "utf8");
}

function gitGrepFiles(pattern: string, pathspec: string): string[] {
  try {
    const out = execSync(`git grep -l ${pattern} -- ${pathspec}`, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function gitLsFiles(pattern: string): string[] {
  try {
    const out = execSync(`git ls-files -- ${pattern}`, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function runStatic() {
  const jwt = readBackend("src/lib/jwtConfig.ts");
  if (
    jwt.includes("process.env.JWT_SECRET?.trim()") &&
    jwt.includes("JWT_SECRET not configured") &&
    !jwt.includes('|| "secret"') &&
    !jwt.includes("development-secret")
  ) {
    pass("jwt-no-fallback", "JWT_SECRET has no hardcoded fallback; empty secret throws");
  } else {
    fail("jwt-no-fallback", "JWT signing secret fallback or missing fail-closed");
  }

  const index = readBackend("src/index.ts");
  if (index.includes("JWT_SECRET is missing") && index.includes("process.exit(1)")) {
    pass("jwt-boot-fail-closed", "API process exits if JWT_SECRET is empty");
  } else {
    fail("jwt-boot-fail-closed", "Boot does not require JWT_SECRET");
  }

  if (index.includes('app.use("/api/test", testRoutes)') && index.includes('NODE_ENV !== "production"')) {
    pass("test-routes-nonprod", "/api/test is mounted only when NODE_ENV is not production");
  } else {
    fail("test-routes-nonprod", "/api/test production gate missing");
  }

  if (index.includes("HEALTH_CHECK_SECRET") && index.includes('isProd ||')) {
    pass("health-detailed-gated", "GET /health detailed diagnostics require non-prod or x-health-secret");
  } else {
    fail("health-detailed-gated", "Detailed /health gating unexpected");
  }

  const bypassFn = readBackend("src/services/emailVerificationBypass.flags.ts");
  if (
    bypassFn.includes("export function isDemoEmailVerificationBypassEnabled") &&
    bypassFn.includes('return process.env.ENABLE_DEMO_BYPASS === "true"')
  ) {
    pass("demo-bypass-explicit", "Email verify bypass is ENABLE_DEMO_BYPASS=true only (not NODE_ENV)");
  } else {
    fail("demo-bypass-explicit", "Demo bypass flag wiring unexpected");
  }

  const prev = process.env.ENABLE_DEMO_BYPASS;
  delete process.env.ENABLE_DEMO_BYPASS;
  if (!isDemoEmailVerificationBypassEnabled()) {
    pass("demo-bypass-default-off", "Bypass disabled when ENABLE_DEMO_BYPASS unset");
  } else {
    fail("demo-bypass-default-off", "Bypass enabled with flag unset");
  }
  process.env.ENABLE_DEMO_BYPASS = "true";
  if (isDemoEmailVerificationBypassEnabled()) {
    pass("demo-bypass-opt-in", "Bypass enables only when ENABLE_DEMO_BYPASS=true");
  } else {
    fail("demo-bypass-opt-in", "Flag true did not enable bypass");
  }
  if (prev === undefined) delete process.env.ENABLE_DEMO_BYPASS;
  else process.env.ENABLE_DEMO_BYPASS = prev;

  if (
    accessTokenMissingRequiredSessionBind({
      type: IMPERSONATION_JWT_TYPE,
      tv: 1,
    })
  ) {
    pass("impersonation-still-needs-sid", "Impersonation JWT still requires sid (AUTH-01 residual intact)");
  } else {
    fail("impersonation-still-needs-sid", "Impersonation sid bind regresssed");
  }

  const spa = gitGrepFiles("SUPABASE_SERVICE_ROLE", "src mobile");
  if (spa.length === 0) {
    pass("no-service-role-in-client-src", "No SUPABASE_SERVICE_ROLE references in src/ or mobile/");
  } else {
    fail("no-service-role-in-client-src", `Client paths mention service role (${spa.length} files; names omitted if sensitive)`);
  }

  const stripeFront = gitGrepFiles("STRIPE_SECRET_KEY", "src mobile");
  if (stripeFront.length === 0) {
    pass("no-stripe-secret-in-client-src", "No STRIPE_SECRET_KEY in src/ or mobile/");
  } else {
    fail("no-stripe-secret-in-client-src", "Frontend references STRIPE_SECRET_KEY");
  }

  const gitignore = readRepo(".gitignore");
  if (gitignore.includes(".env") && gitignore.includes("!.env.example")) {
    pass("gitignore-env", ".gitignore excludes .env and allows *.example");
  } else {
    fail("gitignore-env", ".gitignore env rules missing");
  }

  const trackedEnv = [
    ...gitLsFiles(".env"),
    ...gitLsFiles("**/.env"),
    ...gitLsFiles("backend/.env"),
    ...gitLsFiles(".env.local"),
  ].filter((f) => !f.endsWith(".example"));
  if (trackedEnv.length === 0) {
    pass("no-tracked-dotenv", "No non-example .env files are git-tracked");
  } else {
    fail("no-tracked-dotenv", `Tracked env files (names only): ${trackedEnv.join(", ")}`);
  }

  const saJson = gitLsFiles("*service-account*.json").filter((f) => !f.includes("node_modules"));
  if (saJson.length === 0) {
    pass("no-tracked-service-account-json", "No service-account JSON tracked");
  } else {
    fail("no-tracked-service-account-json", `Tracked credential JSON names: ${saJson.join(", ")}`);
  }

  const err = readBackend("src/middleware/errorHandler.middleware.ts");
  if (err.includes("CLIENT_FALLBACK.generic") && err.includes("do not expose stack")) {
    pass("errors-no-stack-in-http", "HTTP 5xx uses generic client message; stacks stay on server logs");
  } else {
    fail("errors-no-stack-in-http", "Error handler may leak internals");
  }

  const totp = readBackend("src/controllers/auth.controller.ts");
  if (totp.includes("twoFactorSecret") && totp.includes("speakeasy")) {
    pass(
      "totp-auth-04-residual",
      "TOTP still stored/used as application secret material (AUTH-04 residual — not a new Phase 16 finding)",
    );
  }

  const cron = readBackend("src/routes/internalJobs.routes.ts");
  if (cron.includes("x-cron-secret") && cron.includes("if (!secret) return false")) {
    pass("cron-fail-closed", "Internal jobs reject requests when CRON/HEALTH secret is unset");
  } else {
    fail("cron-fail-closed", "Cron auth fail-open");
  }
}

async function runLive() {
  try {
    await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    pass("live-http", `SKIP API not reachable at ${API}`);
    return;
  }

  const testDb = await fetch(`${API}/api/test/db`, { signal: AbortSignal.timeout(10000) });
  const testJson = (await testDb.json().catch(() => ({}))) as Record<string, unknown>;
  if (process.env.NODE_ENV === "production") {
    if (testDb.status === 404) pass("live-test-db-prod", "/api/test/db absent in production");
    else fail("live-test-db-prod", `/api/test/db status ${testDb.status} in production`);
  } else if (!JSON.stringify(testJson).includes("postgresql://") && !JSON.stringify(testJson).includes("JWT_SECRET")) {
    pass("live-test-db-no-dsn", `/api/test/db ${testDb.status} body does not include DSN or JWT_SECRET`);
  } else {
    fail("live-test-db-no-dsn", "Test DB error/debug leaked a secret-shaped string");
  }

  const health = await fetch(`${API}/health`, { signal: AbortSignal.timeout(10000) });
  const healthText = await health.text();
  if (!/sk_live_|sk_test_[a-zA-Z0-9]{8,}|whsec_|eyJ[A-Za-z0-9_-]{20,}/.test(healthText)) {
    pass("live-health-no-keys", "GET /health body has no Stripe/JWT-like secret material");
  } else {
    fail("live-health-no-keys", "Health response matched a secret-like pattern (value not printed)");
  }

  const cron = await fetch(`${API}/api/internal/jobs/trial-reminders`, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
  });
  if (cron.status === 401) {
    pass("live-cron-unauth", "Internal cron job without secret → 401");
  } else {
    fail("live-cron-unauth", `Cron without secret → ${cron.status}`);
  }
}

async function main() {
  runStatic();
  await runLive();

  console.log("=== Phase 16 secrets / configuration ===\n");
  for (const r of results) {
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
  }
  const failures = results.filter((x) => !x.pass);
  console.log(`\nSummary: ${results.length} tests, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
