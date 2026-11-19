/**
 * Test runs cannot reach a non-local database or real Resend. No network or database.
 * Run: npm run test:test-safety-guard
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.resolve(here, "../node_modules/tsx/dist/cli.mjs");
// Random per run so no credential-looking literal sits in the repo (secret scanners flag those).
const FAKE_PW = randomBytes(9).toString("hex");
const fakeRemote = new URL("postgresql://aws-0-eu-central-1.pooler.supabase.com:6543/postgres");
fakeRemote.username = "postgres.abcdefgh";
fakeRemote.password = FAKE_PW;
const FAKE_REMOTE = fakeRemote.toString();

function probe(env: Record<string, string>, code: string) {
  // CARETIP_TEST_ISOLATION=1 stops loadEnv from re-reading the real .env files in the child.
  const r = spawnSync(process.execPath, [tsx, "--eval", `(async () => {${code}})().catch((e) => { console.error(String(e)); process.exit(1); });`], {
    cwd: path.resolve(here, ".."),
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", CARETIP_TEST_ISOLATION: "1", ...env },
    encoding: "utf8",
  });
  return { out: `${r.stdout}${r.stderr}`, status: r.status };
}

const urlProbe = `
  const { getDatabaseUrlForPrisma, TEST_GUARD_DATABASE_URL } = await import("./src/databaseUrl.ts");
  const u = getDatabaseUrlForPrisma();
  console.log(u === TEST_GUARD_DATABASE_URL ? "GUARDED" : u.includes("127.0.0.1") ? "LOCAL" : "REMOTE");
`;

let passed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
};

check("an npm test script with a hosted DATABASE_URL is redirected to a dead loopback port", () => {
  const r = probe({ npm_lifecycle_event: "test:auth-enumeration", DATABASE_URL: FAKE_REMOTE, CARETIP_TEST_ISOLATION: "" }, urlProbe);
  assert.match(r.out, /GUARDED/);
  assert.ok(!r.out.includes(FAKE_PW), "the password is never printed");
  assert.doesNotMatch(r.out, /pooler\.supabase\.com|abcdefgh/, "the URL is never printed");
});

check("NODE_ENV=test is guarded the same way", () => {
  const r = probe({ NODE_ENV: "test", DATABASE_URL: FAKE_REMOTE }, urlProbe);
  assert.match(r.out, /GUARDED/);
});

check("a loopback disposable database is allowed", () => {
  const r = probe({ npm_lifecycle_event: "test:x", DATABASE_URL: "postgresql://ctest@127.0.0.1:55433/caretip_test" }, urlProbe);
  assert.match(r.out, /LOCAL/);
});

check("a plain boolean override is refused (the host must be named)", () => {
  for (const v of ["1", "true", "yes"]) {
    const r = probe({ npm_lifecycle_event: "test:x", DATABASE_URL: FAKE_REMOTE, CARETIP_ALLOW_REMOTE_TEST_DATABASE: v }, urlProbe);
    assert.match(r.out, /GUARDED/, v);
  }
});

check("naming a different host does not unlock this database", () => {
  const r = probe({ npm_lifecycle_event: "test:x", DATABASE_URL: FAKE_REMOTE, CARETIP_ALLOW_REMOTE_TEST_DATABASE: "db.test-project.example" }, urlProbe);
  assert.match(r.out, /GUARDED/);
});

check("naming the exact host allows a dedicated remote test database", () => {
  const r = probe(
    { npm_lifecycle_event: "test:x", DATABASE_URL: FAKE_REMOTE, CARETIP_ALLOW_REMOTE_TEST_DATABASE: "aws-0-eu-central-1.pooler.supabase.com" },
    urlProbe,
  );
  assert.match(r.out, /REMOTE/);
});

check("CI never accepts a remote test database, even with the exact host", () => {
  const r = probe(
    { npm_lifecycle_event: "test:x", CI: "true", DATABASE_URL: FAKE_REMOTE, CARETIP_ALLOW_REMOTE_TEST_DATABASE: "aws-0-eu-central-1.pooler.supabase.com" },
    urlProbe,
  );
  assert.match(r.out, /GUARDED/);
});

check("the API server (npm start / dev) is unaffected", () => {
  const r = probe({ npm_lifecycle_event: "start", NODE_ENV: "production", DATABASE_URL: FAKE_REMOTE, CARETIP_TEST_ISOLATION: "" }, urlProbe);
  assert.match(r.out, /REMOTE/);
});

const resendProbe = `
  let fetched = 0;
  globalThis.fetch = (async () => { fetched += 1; return new Response("{}", { status: 200 }); });
  const { sendResendEmailWithOutcome } = await import("./src/services/resendClient.ts");
  const to = (process.env.PROBE_TO ?? "x@y.example").split(",");
  const o = await sendResendEmailWithOutcome("t", { from: "CareTip <a@b.example>", to, subject: "s", html: "h" });
  console.log("OUTCOME=" + o.kind + " FETCHED=" + fetched);
`;

check("real Resend is blocked in an npm test script even with an API key", () => {
  const r = probe({ npm_lifecycle_event: "test:anything", RESEND_API_KEY: "re_live_looking_key", CARETIP_TEST_ISOLATION: "" }, resendProbe);
  assert.match(r.out, /OUTCOME=not_configured FETCHED=0/);
  assert.doesNotMatch(r.out, /re_live_looking_key/);
});

check("a mocked fetch still works for adapter tests", () => {
  const r = probe(
    { npm_lifecycle_event: "test:anything", RESEND_API_KEY: "re_test", CARETIP_RESEND_FETCH_IS_MOCKED: "1", CARETIP_TEST_ISOLATION: "" },
    resendProbe,
  );
  assert.match(r.out, /OUTCOME=sent FETCHED=1/);
});

check("live email opt-in without a recipient list sends nothing", () => {
  const r = probe({ RESEND_API_KEY: "re_test", CARETIP_ALLOW_LIVE_EMAIL_TEST: "1" }, resendProbe);
  assert.match(r.out, /OUTCOME=not_configured FETCHED=0/);
});

check("live email reaches only the listed recipients; one stray address blocks the send", () => {
  const env = { RESEND_API_KEY: "re_test", CARETIP_ALLOW_LIVE_EMAIL_TEST: "1", CARETIP_LIVE_EMAIL_TEST_RECIPIENTS: "qa@caretip.example" };
  assert.match(probe({ ...env, PROBE_TO: "QA@caretip.example" }, resendProbe).out, /OUTCOME=sent FETCHED=1/);
  assert.match(probe({ ...env, PROBE_TO: "customer@example.com" }, resendProbe).out, /OUTCOME=not_configured FETCHED=0/);
  assert.match(probe({ ...env, PROBE_TO: "qa@caretip.example,customer@example.com" }, resendProbe).out, /FETCHED=0/);
});

check("lead E2E may only email the CareTip lead and support inboxes", () => {
  const env = { RESEND_API_KEY: "re_test", LEAD_EMAIL_E2E: "1", LEADS_INBOX_EMAIL: "leads@caretip.example", SUPPORT_INBOX_EMAIL: "help@caretip.example" };
  assert.match(probe({ ...env, PROBE_TO: "leads@caretip.example" }, resendProbe).out, /OUTCOME=sent FETCHED=1/);
  assert.match(probe({ ...env, PROBE_TO: "help@caretip.example" }, resendProbe).out, /OUTCOME=sent FETCHED=1/);
  assert.match(probe({ ...env, PROBE_TO: "customer@example.com" }, resendProbe).out, /FETCHED=0/);
});

check("CI blocks every live email opt-in", () => {
  const r = probe({ CI: "true", RESEND_API_KEY: "re_test", CARETIP_ALLOW_LIVE_EMAIL_TEST: "1", CARETIP_LIVE_EMAIL_TEST_RECIPIENTS: "qa@caretip.example", PROBE_TO: "qa@caretip.example" }, resendProbe);
  assert.match(r.out, /FETCHED=0/);
});

console.log(`test-safety-guard-runtime: ok (${passed} checks)`);
