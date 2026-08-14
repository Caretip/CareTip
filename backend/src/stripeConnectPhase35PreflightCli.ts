/**
 * Run: npm run preflight:stripe-connect-phase3-5
 * Secret-safe Phase 3.5 TEST MODE preflight. Does not call Stripe. Does not mutate.
 */
import "dotenv/config";
import "./loadEnv.js";

function keyMode(raw: string): "TEST" | "LIVE" | "UNKNOWN" | "N/A" {
  if (!raw) return "N/A";
  if (raw.startsWith("sk_test_")) return "TEST";
  if (raw.startsWith("sk_live_")) return "LIVE";
  return "UNKNOWN";
}

function presence(raw: string): "PRESENT" | "MISSING" {
  return raw.trim() ? "PRESENT" : "MISSING";
}

const nodeEnv = process.env.NODE_ENV?.trim() || "(unset)";
const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
const webhook = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
const database = process.env.DATABASE_URL?.trim() ?? "";
const frontend = process.env.FRONTEND_URL?.trim() ?? "";
const mode = keyMode(secret);

const lines = [
  `NODE_ENV: ${nodeEnv}`,
  `STRIPE_SECRET_KEY: ${presence(secret)} — ${mode === "N/A" ? "N/A" : mode}`,
  `STRIPE_WEBHOOK_SECRET: ${presence(webhook)}`,
  `DATABASE_URL: ${presence(database)}`,
  `FRONTEND_URL: ${presence(frontend)}`,
];

const text = lines.join("\n");
const leaked =
  (secret && text.includes(secret)) ||
  (webhook && webhook.length > 8 && text.includes(webhook)) ||
  (database && database.includes("@") && text.includes(database));
if (leaked) {
  console.error("Preflight aborted: output would leak a secret.");
  process.exit(1);
}

console.log("CareTip Stripe Connect Phase 3.5 TEST MODE preflight");
console.log("(no secrets, no Stripe mutations)\n");
console.log(text);
console.log("");

if (mode === "LIVE") {
  console.error("PHASE 3.5 BLOCKED — LIVE STRIPE CREDENTIAL DETECTED.");
  process.exit(2);
}

let failed = false;
if (presence(secret) === "MISSING" || mode !== "TEST") {
  console.error("FAIL: STRIPE_SECRET_KEY must be PRESENT TEST (sk_test_).");
  failed = true;
}
if (presence(webhook) === "MISSING") {
  console.error("FAIL: STRIPE_WEBHOOK_SECRET is missing.");
  failed = true;
}
if (presence(database) === "MISSING") {
  console.error("FAIL: DATABASE_URL is missing.");
  failed = true;
}

if (failed) process.exit(1);
console.log("PREFLIGHT_OK");
