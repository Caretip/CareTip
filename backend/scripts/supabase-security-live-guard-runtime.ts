/**
 * The live Supabase security audit only touches a project the operator names, only reads by
 * default, and never runs in CI. Runs the real audit script with fetch replaced by a recorder.
 * No network, no database.
 * Run: npm run test:supabase-security-live-guard
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const tsx = path.resolve(backend, "node_modules/tsx/dist/cli.mjs");
const dir = mkdtempSync(path.join(tmpdir(), "caretip-sb-guard-"));
const log = path.join(dir, "requests.log");

// Preload: every fetch is recorded and answered locally; nothing leaves the process.
const preload = path.join(dir, "mock-fetch.mjs");
writeFileSync(
  preload,
  `import { appendFileSync } from "node:fs";
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const method = (init?.method ?? (typeof input === "object" && input.method) ?? "GET").toUpperCase();
  appendFileSync(${JSON.stringify(log)}, method + " " + new URL(url).pathname + "\\n");
  const body = /\\/storage\\/v1\\/bucket$/.test(new URL(url).pathname)
    ? JSON.stringify([{ id: "caretip", name: "caretip", public: true }, { id: "caretip-kyc", name: "caretip-kyc", public: false }])
    : "[]";
  const status = new URL(url).pathname.endsWith("/rest/v1/User") && !init?.headers?.apikey ? 401 : 200;
  return new Response(body, { status, headers: { "content-type": "application/json" } });
};
`,
);

const REF = "abcdefghijklmnop";
// Blank every name from the local env files (values never read) so the audit cannot pick up a real project.
const blanked: Record<string, string> = {};
for (const file of [path.join(backend, ".env"), path.join(backend, "..", ".env")]) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const line of text.split(/\r?\n/)) {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];
    if (name) blanked[name] = "";
  }
}
const base = {
  ...blanked,
  PATH: process.env.PATH ?? "",
  SystemRoot: process.env.SystemRoot ?? "",
  CARETIP_TEST_ISOLATION: "1", // keeps loadEnv from reading the real .env files
  SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_ANON_KEY: "anon-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
};

function run(extra: Record<string, string>) {
  rmSync(log, { force: true });
  const r = spawnSync(process.execPath, [tsx, "scripts/supabase-security-pentest.ts"], {
    cwd: backend,
    // NODE_OPTIONS reaches the process tsx starts, so its fetch is the recorder.
    env: { ...base, ...extra, NODE_OPTIONS: `--import ${pathToFileURL(preload).href}` },
    encoding: "utf8",
  });
  let requests: string[] = [];
  try {
    requests = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    requests = [];
  }
  return { out: `${r.stdout}${r.stderr}`, requests };
}

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

try {
  check("without a named target, no live check runs and nothing is requested", () => {
    const r = run({});
    assert.deepEqual(r.requests, []);
    assert.match(r.out, /postgrest-bypass: SKIP: set CARETIP_SECURITY_AUDIT_TARGET/);
    assert.match(r.out, /storage-audit: SKIP: set CARETIP_SECURITY_AUDIT_TARGET/);
  });

  check("a target that does not match the configured project is refused", () => {
    const r = run({ CARETIP_SECURITY_AUDIT_TARGET: "someotherproject" });
    assert.deepEqual(r.requests, []);
    assert.match(r.out, /does not match the configured Supabase project/);
  });

  check("CI never runs live checks, even with the right target", () => {
    const r = run({ CI: "true", CARETIP_SECURITY_AUDIT_TARGET: REF });
    assert.deepEqual(r.requests, []);
    assert.match(r.out, /live checks never run in CI/);
  });

  check("with the named target, only reads are sent (write probes off by default)", () => {
    const r = run({ CARETIP_SECURITY_AUDIT_TARGET: REF });
    assert.ok(r.requests.length > 0, "live read checks ran");
    const writes = r.requests.filter((l) => !/^(GET|HEAD) /.test(l));
    assert.deepEqual(writes, [], `unexpected write requests: ${writes.join(", ")}`);
    assert.match(r.out, /postgrest-anon-write: SKIP: write probes disabled/);
    assert.match(r.out, /storage-anon-upload-blocked: SKIP: write probes disabled/);
  });

  check("write probes need the exact acknowledgement for this project", () => {
    const wrong = run({ CARETIP_SECURITY_AUDIT_TARGET: REF, CARETIP_SECURITY_AUDIT_WRITE_PROBES: "1" });
    assert.deepEqual(wrong.requests.filter((l) => !/^(GET|HEAD) /.test(l)), []);
    const right = run({ CARETIP_SECURITY_AUDIT_TARGET: REF, CARETIP_SECURITY_AUDIT_WRITE_PROBES: `attempt-blocked-writes:${REF}` });
    assert.ok(right.requests.some((l) => l.startsWith("POST ")), "explicitly enabled write probes do run");
  });

  check("no key or credential is printed", () => {
    const r = run({ CARETIP_SECURITY_AUDIT_TARGET: REF });
    assert.doesNotMatch(r.out, /anon-test-key|service-test-key/);
  });

  console.log(`supabase-security-live-guard-runtime: ok (${passed} checks)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
