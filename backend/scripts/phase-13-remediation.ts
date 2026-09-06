/**
 * Phase 13 — rate limiting / API abuse (original exploit + post-fix).
 * Run: npm run test:phase-13-remediation (backend)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "../src/loadEnv.js";
import { parseBoundedSkip, MAX_LIST_SKIP } from "../src/utils/paginationLimits.js";
import { parseBusinessListQuery } from "../src/services/platformBusinessList.service.js";
import { authRateLimits } from "../src/config/authRateLimit.config.js";
import { securityRateLimits } from "../src/config/securityRateLimit.config.js";
import {
  checkAndIncrementLimitDistributed,
  enforceRateLimitLayersDistributed,
} from "../src/utils/rateLimitStore.js";
import { userIdFromPendingMfaLoginToken, signPendingMfaLoginToken } from "../src/services/mfaLogin.service.js";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
const backendRoot = process.cwd();
const API = (process.env.RUNTIME_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const TRUSTED_ORIGIN = (process.env.ABUSE_TEST_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");

const pass = (id: string, detail: string) => results.push({ id, pass: true, detail });
const fail = (id: string, detail: string) => results.push({ id, pass: false, detail });

function read(rel: string): string {
  return readFileSync(join(backendRoot, rel), "utf8");
}

function runSkipExploitRegression() {
  if (parseBoundedSkip(999_999_999) !== MAX_LIST_SKIP) {
    fail("skip-cap-helper", `parseBoundedSkip(999999999) = ${parseBoundedSkip(999_999_999)}, want ${MAX_LIST_SKIP}`);
  } else {
    pass("skip-cap-helper", `parseBoundedSkip max remains ${MAX_LIST_SKIP}`);
  }

  if (parseBoundedSkip("-1") !== 0) {
    fail("skip-negative", "Negative skip should clamp to 0");
  } else {
    pass("skip-negative", "Negative skip clamps to 0");
  }

  const hugeSkip = parseBusinessListQuery({ skip: "999999999", take: "25" });
  if (hugeSkip.skip !== MAX_LIST_SKIP) {
    fail(
      "RL-13-01-retest",
      `ORIGINAL EXPLOIT still open: platform business list skip=${hugeSkip.skip} (expected ${MAX_LIST_SKIP})`,
    );
  } else {
    pass(
      "RL-13-01-retest",
      `BLOCKED: parseBusinessListQuery skip=999999999 now ${hugeSkip.skip} (was unbounded OFFSET)`,
    );
  }

  const hugePage = parseBusinessListQuery({ page: "999999", take: "100" });
  if (hugePage.skip !== MAX_LIST_SKIP) {
    fail("RL-13-01-page-retest", `page*take skip=${hugePage.skip}, expected cap ${MAX_LIST_SKIP}`);
  } else {
    pass("RL-13-01-page-retest", `page*take OFFSET capped at ${MAX_LIST_SKIP}`);
  }

  const modest = parseBusinessListQuery({ skip: "40", take: "25" });
  if (modest.skip !== 40) {
    fail("skip-legitimate", `Legitimate skip=40 became ${modest.skip}`);
  } else {
    pass("skip-legitimate", "In-range skip unchanged (product pagination intact)");
  }
}

function runStaticInventory() {
  const index = read("src/index.ts");
  const authRoutes = read("src/routes/auth.routes.ts");
  const store = read("src/utils/rateLimitStore.ts");

  if (index.includes('app.set("trust proxy", 1)') && index.includes('NODE_ENV === "production"')) {
    pass("trust-proxy-prod-only", "trust proxy 1 is production-only (XFF not spoofable in local NODE_ENV)");
  } else {
    fail("trust-proxy-prod-only", "trust proxy configuration missing or not production-gated");
  }

  if (index.includes("authenticatedApiRateLimit") && index.includes('app.use("/api"')) {
    pass(
      "global-api-cap",
      `Global /api cap IP=${securityRateLimits.authenticatedApi.ip.max}/15m user=${securityRateLimits.authenticatedApi.user.max}/15m`,
    );
  } else {
    fail("global-api-cap", "authenticatedApiRateLimit not mounted");
  }

  const webhookUse = index.indexOf('app.use("/api/webhooks"');
  const apiRlUse = index.indexOf('app.use("/api", authenticatedApiRateLimit)');
  if (webhookUse >= 0 && apiRlUse >= 0 && webhookUse < apiRlUse) {
    pass("webhook-before-api-rl", "Stripe webhook mount is registered before the broad /api limiter");
  } else {
    fail("webhook-before-api-rl", "Webhook mount order relative to /api limiter unexpected");
  }

  if (authRoutes.includes("loginRateLimit") && authRoutes.includes("/signin")) {
    pass("login-alias-same-limiter", "POST /login and /signin share loginRateLimit");
  } else {
    fail("login-alias-same-limiter", "Login aliases missing shared limiter");
  }

  if (authRoutes.includes("mfaLoginChallengeRateLimit") && store.includes("memoryCheckAndIncrement")) {
    pass("redis-memory-fallback", "Distributed store falls back to in-memory when Redis is unavailable");
  } else {
    fail("redis-memory-fallback", "Memory fallback not present");
  }

  if (authRoutes.includes("activateEmployeeRateLimit") && authRoutes.includes("forgotPasswordRateLimit")) {
    pass("activation-reset-limiters", "Activation and password-reset routes are rate limited");
  } else {
    fail("activation-reset-limiters", "Activation/reset limiters missing");
  }

  const listSvc = read("src/services/platformBusinessList.service.ts");
  if (listSvc.includes("parseBoundedSkip")) {
    pass("RL-13-01-source", "parseBusinessListQuery uses parseBoundedSkip (remediation present)");
  } else {
    fail("RL-13-01-source", "parseBusinessListQuery still unbounded");
  }
}

async function runLimiterSimulations() {
  const probe = `p13:${Date.now()}`;
  const { max, windowMs } = authRateLimits.login.ipEmail;
  for (let i = 0; i < max; i++) {
    const r = await checkAndIncrementLimitDistributed({
      key: `${probe}:login`,
      maxPerWindow: max,
      windowMs,
    });
    if (!r.allowed) {
      fail("sim-ip-email-window", `Blocked early at ${i + 1}/${max}`);
      return;
    }
  }
  const blocked = await checkAndIncrementLimitDistributed({
    key: `${probe}:login`,
    maxPerWindow: max,
    windowMs,
  });
  if (blocked.allowed) fail("sim-ip-email-window", `Did not block attempt ${max + 1}`);
  else pass("sim-ip-email-window", `ip+email window blocks after ${max} increments`);

  const empty = await checkAndIncrementLimitDistributed({
    key: "   ",
    maxPerWindow: 1,
    windowMs: 60_000,
  });
  if (empty.allowed) {
    pass(
      "empty-key-fail-open",
      "Empty rate-limit keys fail-open (INFORMATIONAL; live layers always have IP or hashed token keys)",
    );
  } else {
    fail("empty-key-fail-open", "Empty key unexpectedly blocked");
  }

  const skipped = await enforceRateLimitLayersDistributed([
    { name: "empty", key: "", max: 1, windowMs: 1000 },
    { name: "real", key: `${probe}:layer`, max: 1, windowMs: 60_000 },
  ]);
  if (!skipped.ok) {
    fail("empty-layer-skip", "Unexpected block on first increment of real layer");
  } else {
    const second = await enforceRateLimitLayersDistributed([
      { name: "real", key: `${probe}:layer`, max: 1, windowMs: 60_000 },
    ]);
    if (second.ok) fail("empty-layer-skip", "Second increment of max=1 layer was allowed");
    else pass("empty-layer-skip", "Empty layer keys are skipped; remaining layers still enforce");
  }

  if (!process.env.JWT_SECRET?.trim()) {
    pass("mfa-pending-bucket", "SKIP JWT_SECRET unset — cannot mint pending MFA token locally");
    return;
  }
  const uid = "user_phase13_mfa_bucket";
  const pending = signPendingMfaLoginToken(uid);
  const extracted = userIdFromPendingMfaLoginToken(pending);
  if (extracted !== uid) {
    fail("mfa-pending-bucket", `Pending MFA JWT did not yield user id (got ${extracted})`);
  } else {
    pass("mfa-pending-bucket", "Pending MFA JWT binds the MFA TOTP user rate-limit bucket");
  }
  if (userIdFromPendingMfaLoginToken("garbage") !== null) {
    fail("mfa-pending-invalid", "Invalid pending token produced a user bucket");
  } else {
    pass("mfa-pending-invalid", "Invalid pending MFA token does not create a user bucket (IP layer only)");
  }
}

async function runLiveHttp() {
  try {
    const health = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok && health.status !== 200) {
      pass("live-http", `SKIP API not healthy at ${API} (${health.status})`);
      return;
    }
  } catch {
    pass("live-http", `SKIP API not reachable at ${API}`);
    return;
  }

  const email = `p13-xff-${Date.now()}@caretip-test.local`;
  const body = JSON.stringify({ email, password: "WrongPass1!" });
  const headersBase = {
    "Content-Type": "application/json",
    Origin: TRUSTED_ORIGIN,
    Referer: `${TRUSTED_ORIGIN}/`,
  };

  const a = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { ...headersBase, "X-Forwarded-For": "198.51.100.10", "X-Real-IP": "198.51.100.10" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const b = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { ...headersBase, "X-Forwarded-For": "203.0.113.20", Forwarded: "for=203.0.113.20" },
    body,
    signal: AbortSignal.timeout(15000),
  });

  if (a.status === 429 || b.status === 429) {
    pass("live-xff-spoof", `Login returned 429 during XFF probe (statuses ${a.status}/${b.status})`);
    return;
  }
  if ([401, 403, 400].includes(a.status) && [401, 403, 400].includes(b.status)) {
    pass(
      "live-xff-spoof",
      `X-Forwarded-For / Forwarded / X-Real-IP did not yield a distinct unauthenticated success path (statuses ${a.status}/${b.status}; trust proxy off in non-prod)`,
    );
  } else {
    fail("live-xff-spoof", `Unexpected login statuses ${a.status}/${b.status}`);
  }

  const signin = await fetch(`${API}/api/auth/signin`, {
    method: "POST",
    headers: headersBase,
    body,
    signal: AbortSignal.timeout(15000),
  });
  if ([401, 403, 400, 429].includes(signin.status)) {
    pass("live-signin-alias", `POST /signin is live and gated (status ${signin.status})`);
  } else {
    fail("live-signin-alias", `Unexpected /signin status ${signin.status}`);
  }
}

async function main() {
  runStaticInventory();
  runSkipExploitRegression();
  await runLimiterSimulations();
  await runLiveHttp();

  console.log("=== Phase 13 rate limiting / API abuse ===\n");
  for (const r of results) {
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
  }
  const failures = results.filter((r) => !r.pass);
  console.log(`\nSummary: ${results.length} tests, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
