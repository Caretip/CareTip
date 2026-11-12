/**
 * Google redirect-mode sign-in (mobile web white-screen fix) — isolated runtime checks.
 * Run: node scripts/safe-test.mjs test:google-oauth-redirect
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";

process.env.JWT_SECRET ||= "google-redirect-runtime-secret-google-redirect-runtime";
process.env.GOOGLE_CLIENT_ID ||= "runtime-test.apps.googleusercontent.com";
process.env.AUTH_LOGIN_IP_MAX_PER_15M = "3";

const svc = await import("../src/services/oauth/googleOAuthRedirect.service.js");
const { default: authRoutes } = await import("../src/routes/auth.routes.js");

let failures = 0;
async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- sealed hand-off -------------------------------------------------------------------------
await check("hand-off round-trips the credential", () => {
  const sealed = svc.sealGoogleRedirectHandoff("header.payload.sig");
  assert.ok(sealed.startsWith(svc.GOOGLE_REDIRECT_HANDOFF_PREFIX));
  assert.ok(!sealed.includes("payload"), "credential is not readable in the hand-off");
  assert.equal(svc.openGoogleRedirectHandoff(sealed), "header.payload.sig");
});
await check("tampered hand-off is rejected", () => {
  const sealed = svc.sealGoogleRedirectHandoff("a.b.c");
  const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
  assert.throws(() => svc.openGoogleRedirectHandoff(flipped), svc.GoogleRedirectHandoffError);
});
await check("expired hand-off is rejected", () => {
  const sealed = svc.sealGoogleRedirectHandoff("a.b.c", Date.now() - svc.GOOGLE_REDIRECT_HANDOFF_TTL_MS - 1);
  assert.throws(() => svc.openGoogleRedirectHandoff(sealed), (e: unknown) => e instanceof svc.GoogleRedirectHandoffError && e.reason === "expired");
});
await check("raw Google token is not treated as a hand-off", () => {
  assert.equal(svc.isGoogleRedirectHandoff("eyJhbGciOiJSUzI1NiJ9.x.y"), false);
});
await check("completion URL is relative and data stays in the fragment", () => {
  const url = svc.buildGoogleRedirectCompleteUrl({ error: "csrf" });
  assert.equal(url, "/auth/google/complete#error=csrf");
});

// --- HTTP callback ---------------------------------------------------------------------------
const app = express();
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(express.json());
app.use("/api/auth", authRoutes);
const server = createServer(app);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const { port } = server.address() as { port: number };
const post = (body: string, cookie?: string) =>
  fetch(`http://127.0.0.1:${port}/api/auth/google/redirect`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    body,
  });

await check("missing CSRF cookie → redirect with error=csrf (never JSON)", async () => {
  const r = await post("credential=x&g_csrf_token=abc");
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/auth/google/complete#error=csrf");
  assert.equal(r.headers.get("cache-control"), "no-store");
});
await check("CSRF body/cookie mismatch → error=csrf", async () => {
  const r = await post("credential=x&g_csrf_token=abc", "g_csrf_token=zzz");
  assert.equal(r.headers.get("location"), "/auth/google/complete#error=csrf");
});
await check("missing credential → error=missing_credential", async () => {
  const r = await post("g_csrf_token=abc", "g_csrf_token=abc");
  assert.equal(r.headers.get("location"), "/auth/google/complete#error=missing_credential");
});
await check("rate-limited callback redirects to the error page instead of a JSON body", async () => {
  // AUTH_LOGIN_IP_MAX_PER_15M=3 and three requests were made above.
  const r = await post("g_csrf_token=abc", "g_csrf_token=abc");
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/auth/google/complete#error=rate_limited");
});

// --- /oauth unwraps the hand-off -------------------------------------------------------------
await check("POST /oauth rejects an invalid hand-off with a clear code", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/oauth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "google", idToken: `${svc.GOOGLE_REDIRECT_HANDOFF_PREFIX}AAAA`, isLogin: true }),
  });
  assert.equal(r.status, 400);
  const body = (await r.json()) as { code?: string };
  assert.equal(body.code, "GOOGLE_REDIRECT_HANDOFF_INVALID");
});

server.close();
console.log(failures ? `google-oauth-redirect: ${failures} failed` : "google-oauth-redirect: ok");
process.exit(failures ? 1 : 0);
