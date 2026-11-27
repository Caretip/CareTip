/**
 * Legacy API hostname traffic watch: categories, per-minute summary, canonical host ignored,
 * bounded memory, no client data in the log line. Pure in-process; no network or database.
 * Run: npm run test:legacy-host-monitor
 */
import assert from "node:assert/strict";
import {
  __setLegacyHostReporterForTests,
  classifyLegacyHostRequest,
  flushLegacyHostCounts,
  isLegacyApiHost,
  recordLegacyHostRequest,
  requestHostname,
} from "../src/lib/legacyHostMonitor.js";

const req = (host: string | undefined, path: string, headers: Record<string, string> = {}) => ({
  method: "POST",
  path,
  headers: { ...(host ? { host } : {}), ...headers } as Record<string, string>,
});

let checks = 0;
const ok = (name: string) => {
  checks++;
  console.log(`ok - ${name}`);
};

assert.equal(requestHostname({ host: "Caretip.OnRender.com:443" }), "caretip.onrender.com");
assert.equal(isLegacyApiHost("caretip.onrender.com"), true);
assert.equal(isLegacyApiHost("api.caretip.de"), false);
assert.equal(isLegacyApiHost(".onrender.com"), false);
assert.equal(isLegacyApiHost("onrender.com.evil.example"), false);
ok("host parsing and legacy-host detection");

const cases: Array<[ReturnType<typeof req>, string]> = [
  [req("caretip.onrender.com", "/api/health"), "health"],
  [req("caretip.onrender.com", "/health"), "health"],
  [req("caretip.onrender.com", "/api/webhooks/stripe"), "stripe_webhook"],
  [req("caretip.onrender.com", "/api/webhooks/stripe-connect"), "stripe_webhook"],
  [req("caretip.onrender.com", "/api/webhook/stripe"), "stripe_webhook"],
  [req("caretip.onrender.com", "/api/internal/jobs/trial-reminders"), "internal_job"],
  [req("caretip.onrender.com", "/api/legal/webhook"), "legal_webhook"],
  [req("caretip.onrender.com", "/api/auth/apple/native-callback"), "oauth_callback"],
  [req("caretip.onrender.com", "/api/auth/facebook/callback"), "oauth_callback"],
  [req("caretip.onrender.com", "/api/auth/google/redirect"), "oauth_callback"],
  [req("caretip.onrender.com", "/api/employees/me", { "x-caretip-app": "mobile" }), "mobile_app"],
  [req("caretip.onrender.com", "/api/auth/refresh"), "mobile_app"],
  [req("caretip.onrender.com", "/api/auth/refresh", { origin: "https://caretip.de" }), "web_session_move"],
  [req("caretip.onrender.com", "/api/auth/logout", { origin: "https://www.caretip.de" }), "web_session_move"],
  [req("caretip.onrender.com", "/uploads/x.png"), "media"],
  [req("caretip.onrender.com", "/api/tips/employee"), "other"],
];
for (const [r, want] of cases) assert.equal(classifyLegacyHostRequest(r), want, `${r.path} ${JSON.stringify(r.headers)}`);
ok("caller categories (webhooks, jobs, OAuth, mobile, web session move, media, other)");

const lines: string[] = [];
__setLegacyHostReporterForTests((l) => lines.push(l));
const t0 = 1_000_000;
assert.equal(recordLegacyHostRequest(req("api.caretip.de", "/api/auth/refresh"), t0), null);
assert.equal(recordLegacyHostRequest(req(undefined, "/api/auth/refresh"), t0), null);
recordLegacyHostRequest(req("caretip.onrender.com", "/api/employees/me", { "x-caretip-app": "mobile", "x-forwarded-for": "203.0.113.77" }), t0);
recordLegacyHostRequest(req("caretip.onrender.com", "/api/employees/me", { "x-caretip-app": "mobile" }), t0 + 10);
recordLegacyHostRequest(req("caretip.onrender.com", "/api/webhooks/stripe"), t0 + 20);
assert.equal(lines.length, 0, "no line before the minute is over");
recordLegacyHostRequest(req("caretip.onrender.com", "/api/health"), t0 + 60_000);
assert.equal(lines.length, 1);
assert.equal(lines[0], "[legacy-host] caretip.onrender.com 60s: mobile_app=2 stripe_webhook=1 (total 3)");
assert.ok(!lines[0]!.includes("203.0.113"), "no client address in the log");
ok("canonical host ignored; one summary per minute with counts by category");

flushLegacyHostCounts(t0 + 120_000);
assert.equal(lines[1], "[legacy-host] caretip.onrender.com 60s: health=1 (total 1)");
flushLegacyHostCounts(t0 + 180_000);
assert.equal(lines.length, 2, "quiet minutes produce no line");
ok("pending counts flush; no line when there was no legacy traffic");

// After a quiet period the line states the real window length, not a nominal minute.
recordLegacyHostRequest(req("caretip.onrender.com", "/api/webhooks/stripe"), t0 + 400_000);
flushLegacyHostCounts(t0 + 700_000);
assert.equal(lines[2], "[legacy-host] caretip.onrender.com 300s: stripe_webhook=1 (total 1)");
ok("reported window length is measured");

__setLegacyHostReporterForTests((l) => lines.push(l));
lines.length = 0;
for (let i = 0; i < 50; i++) recordLegacyHostRequest(req(`x${i}.onrender.com`, "/"), t0);
flushLegacyHostCounts(t0 + 60_000);
assert.equal(lines.length, 8, "distinct hosts per window are capped");
ok("memory bounded against arbitrary Host headers");

console.log(`legacy-host-monitor: ok (${checks} checks)`);
