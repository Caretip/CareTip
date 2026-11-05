#!/usr/bin/env node
/**
 * Runs one backend test with no access to real credentials or services:
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://user:pw@127.0.0.1:5433/test node scripts/safe-test.mjs test:name
 *
 * - Every name found in the local .env files is defined as empty, so no dotenv loader can fill it in
 *   (Prisma's generated client also reads backend/.env on its own).
 * - All non-loopback connections are refused, plus the local dev ports.
 * - A database that is not on loopback is refused outright.
 *
 * Names are read from the env files, values never are.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..");
const script = process.argv[2];
if (!script) {
  console.error("usage: node scripts/safe-test.mjs <npm script>");
  process.exit(2);
}

const dbUrl = process.env.CARETIP_ISOLATED_POSTGRES_URL?.trim() ?? "";
if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl)) {
  console.error("REFUSING: set CARETIP_ISOLATED_POSTGRES_URL to a disposable loopback database");
  process.exit(1);
}

const env = { ...process.env };
for (const file of [join(backend, ".env"), join(backend, "..", ".env")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];
    if (name) env[name] = "";
  }
}
Object.assign(env, {
  CARETIP_TEST_ISOLATION: "1",
  DATABASE_URL: dbUrl,
  DIRECT_URL: dbUrl,
  DATABASE_ALLOW_LOCALHOST: "true",
  JWT_SECRET: "isolated-test-secret-isolated-test-secret-isolated",
  // Placeholders, never real keys: many suites need one present but stub the provider call.
  STRIPE_SECRET_KEY: "sk_test_isolated_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_isolated_placeholder",
  FACEBOOK_APP_ID: "1",
  FACEBOOK_APP_SECRET: "isolated_placeholder",
  NODE_ENV: "test",
  PORT: "3912",
  RUNTIME_API_BASE: "http://127.0.0.1:3912",
  SMOKE_API_URL: "http://127.0.0.1:3912",
  API_BASE_URL: "http://127.0.0.1:3912",
  E2E_BASE_URL: "http://127.0.0.1:3912",
  NODE_OPTIONS: `--require ${join(here, "block-test-egress.cjs").replace(/\\/g, "/")}`,
});

const child = spawn("npm", ["run", "-s", script], { cwd: backend, env, stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 1));
