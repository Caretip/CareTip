/**
 * Render Cron Job runner (scripts/render-category-retention-http.mjs): both secret headers, fail-closed
 * without either secret, no secret in output, cron-secret auth and origin enforcement behind it, and the
 * existing timeout / HTTP-error / network-error handling. Local servers only; disposable database for
 * the one real (harmless) job call.
 * Run: node scripts/safe-test.mjs test:cron-runner
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

if (process.env.CARETIP_TEST_ISOLATION !== "1") throw new Error("disposable database only (run through safe-test)");
delete process.env.REDIS_URL;
console.info = () => {};

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, "render-category-retention-http.mjs");
const CRON = randomBytes(24).toString("hex");
const ORIGIN = randomBytes(24).toString("base64url");

type Run = { status: number | null; stdout: string; stderr: string; ms: number };
function run(env: Record<string, string | undefined>): Promise<Run> {
  const started = Date.now();
  return new Promise((resolve) => {
    const base = { ...process.env };
    for (const k of ["CRON_SECRET", "ORIGIN_PROTECTION_SECRET", "CARE_TIP_API_ORIGIN", "CARE_TIP_INTERNAL_JOB_PATH", "CARE_TIP_JOB_TIMEOUT_MS"]) delete base[k];
    const child = spawn(process.execPath, [runner], { env: { ...base, ...env } as NodeJS.ProcessEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (status) => resolve({ status, stdout, stderr, ms: Date.now() - started }));
  });
}
const noSecrets = (r: Run, ...secrets: string[]) => {
  for (const s of secrets) assert.ok(!r.stdout.includes(s) && !r.stderr.includes(s), "a secret appeared in the runner output");
};

// Recording server: answers with a configurable status; never echoes headers.
const seen: IncomingHttpHeaders[] = [];
let reply: { status: number; body: string } | "hang" = { status: 200, body: '{"ok":true}' };
const recorder = createServer((req, res) => {
  seen.push({ ...req.headers });
  if (reply === "hang") return; // never answers (timeout test)
  res.writeHead(reply.status, { "content-type": "application/json" });
  res.end(reply.body);
});
await new Promise<void>((r) => recorder.listen(0, "127.0.0.1", r));
const recOrigin = `http://127.0.0.1:${(recorder.address() as AddressInfo).port}`;
const JOB = "/api/internal/jobs/purge-mobile-web-handoff";

let checks = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  checks++;
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

await test("1. sends both headers with the exact (trimmed) values; output contains neither secret", async () => {
  seen.length = 0;
  reply = { status: 200, body: '{"ok":true,"deleted":0}' };
  const r = await run({ CRON_SECRET: `  ${CRON} `, ORIGIN_PROTECTION_SECRET: ` ${ORIGIN}\n`, CARE_TIP_API_ORIGIN: recOrigin, CARE_TIP_INTERNAL_JOB_PATH: JOB });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!["x-cron-secret"], CRON);
  assert.equal(seen[0]!["x-caretip-origin-secret"], ORIGIN);
  assert.match(r.stdout, /"ok":true/);
  noSecrets(r, CRON, ORIGIN);
});

await test("3. missing or blank ORIGIN_PROTECTION_SECRET: exits 1 with a clear message and sends nothing", async () => {
  for (const value of [undefined, "", "   "]) {
    seen.length = 0;
    const r = await run({ CRON_SECRET: CRON, ORIGIN_PROTECTION_SECRET: value, CARE_TIP_API_ORIGIN: recOrigin, CARE_TIP_INTERNAL_JOB_PATH: JOB });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ORIGIN_PROTECTION_SECRET is not set on this cron service; refusing/);
    assert.equal(seen.length, 0, "no request without the origin header");
    noSecrets(r, CRON);
  }
});

await test("4. missing CRON_SECRET still fails closed first (unchanged), nothing sent", async () => {
  seen.length = 0;
  const r = await run({ ORIGIN_PROTECTION_SECRET: ORIGIN, CARE_TIP_API_ORIGIN: recOrigin, CARE_TIP_INTERNAL_JOB_PATH: JOB });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CRON_SECRET is not set/);
  assert.equal(seen.length, 0);
  noSecrets(r, ORIGIN);
});

await test("5. HTTP error: exits 1, prints status, URL and body, but no secret", async () => {
  reply = { status: 500, body: '{"message":"job failed"}' };
  const r = await run({ CRON_SECRET: CRON, ORIGIN_PROTECTION_SECRET: ORIGIN, CARE_TIP_API_ORIGIN: recOrigin, CARE_TIP_INTERNAL_JOB_PATH: JOB });
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`HTTP 500 ${recOrigin}${JOB}`));
  assert.match(r.stderr, /job failed/);
  noSecrets(r, CRON, ORIGIN);
});

await test("5. network error: exits 1 with 'Request failed', no secret", async () => {
  const dead = createServer();
  await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
  const port = (dead.address() as AddressInfo).port;
  await new Promise<void>((r) => dead.close(() => r()));
  const r = await run({ CRON_SECRET: CRON, ORIGIN_PROTECTION_SECRET: ORIGIN, CARE_TIP_API_ORIGIN: `http://127.0.0.1:${port}`, CARE_TIP_INTERNAL_JOB_PATH: JOB });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Request failed/);
  noSecrets(r, CRON, ORIGIN);
});

await test("5. timeout unchanged: a hung API is abandoned at the 10 s minimum and exits 1, no secret", async () => {
  reply = "hang";
  const r = await run({ CRON_SECRET: CRON, ORIGIN_PROTECTION_SECRET: ORIGIN, CARE_TIP_API_ORIGIN: recOrigin, CARE_TIP_INTERNAL_JOB_PATH: JOB, CARE_TIP_JOB_TIMEOUT_MS: "1000" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Request failed/);
  assert.ok(r.ms >= 9_000 && r.ms < 30_000, `took ${r.ms} ms (timeout is clamped to at least 10 s)`);
  noSecrets(r, CRON, ORIGIN);
  reply = { status: 200, body: '{"ok":true}' };
});

// Real API wiring: origin protection in enforce mode + the real internal-job routes.
process.env.CRON_SECRET = CRON;
const op = await import("../src/lib/originProtection.js");
const { default: internalJobsRoutes } = await import("../src/routes/internalJobs.routes.js");
const { prisma } = await import("../src/prisma.js");
op.configureOriginProtection({ ORIGIN_PROTECTION_MODE: "enforce", ORIGIN_PROTECTION_SECRET: ORIGIN, CRON_SECRET: CRON });
op.__setOriginProtectionReporterForTests(() => {});
const app = express();
app.use(op.originProtectionMiddleware);
app.use(express.json());
app.use("/api/internal/jobs", internalJobsRoutes);
const api = createServer(app);
await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
const apiOrigin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

await test("2+4. enforce: runner with both secrets is accepted and the job runs (HTTP 200)", async () => {
  const r = await run({ CRON_SECRET: CRON, ORIGIN_PROTECTION_SECRET: ORIGIN, CARE_TIP_API_ORIGIN: apiOrigin, CARE_TIP_INTERNAL_JOB_PATH: JOB });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"ok":true/);
  noSecrets(r, CRON, ORIGIN);
});
await test("4. enforce: correct origin + wrong cron secret → HTTP 401 (cron auth still enforced)", async () => {
  const r = await run({ CRON_SECRET: `${CRON}-wrong`, ORIGIN_PROTECTION_SECRET: ORIGIN, CARE_TIP_API_ORIGIN: apiOrigin, CARE_TIP_INTERNAL_JOB_PATH: JOB });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /HTTP 401/);
});
await test("enforce: wrong origin secret + correct cron secret → HTTP 403 (origin enforced first)", async () => {
  const r = await run({ CRON_SECRET: CRON, ORIGIN_PROTECTION_SECRET: `${ORIGIN}-wrong`, CARE_TIP_API_ORIGIN: apiOrigin, CARE_TIP_INTERNAL_JOB_PATH: JOB });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /HTTP 403/);
  noSecrets(r, CRON, ORIGIN);
});

await test("shell fallback: same fail-closed check before curl, and both headers", async () => {
  const sh = readFileSync(join(here, "render-category-retention-http.sh"), "utf8");
  const guard = sh.indexOf('if [ -z "${ORIGIN_PROTECTION_SECRET:-}" ]');
  const curl = sh.indexOf("curl -fsS");
  assert.ok(guard > 0 && guard < curl, "origin guard precedes the request");
  assert.ok(sh.includes('-H "x-cron-secret: ${CRON_SECRET}"'));
  assert.ok(sh.includes('-H "x-caretip-origin-secret: ${ORIGIN_PROTECTION_SECRET}"'));
  assert.ok(!/echo[^\n]*\$\{?(CRON_SECRET|ORIGIN_PROTECTION_SECRET)/.test(sh), "never echoes a secret");
});

api.close();
recorder.close();
await prisma.$disconnect();
console.log(failures.length ? `\n${failures.length} of ${checks} failed` : `\ncron-runner: ok (${checks} checks)`);
process.exit(failures.length ? 1 : 0);
