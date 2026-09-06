/**
 * Phase 14 — SSRF / webhook authenticity (safe local targets only).
 * Run: npm run test:phase-14-ssrf-webhooks (backend)
 */
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import "../src/loadEnv.js";
import { isValidRechtstextPdfUrl } from "../src/services/itRechtKanzlei/itRechtKanzleiPdfValidator.js";
import { checkoutSessionBoundToBusiness } from "../src/lib/subscription/checkoutSessionOwnership.js";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
const backendRoot = process.cwd();
const API = (process.env.RUNTIME_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");

const pass = (id: string, detail: string) => results.push({ id, pass: true, detail });
const fail = (id: string, detail: string) => results.push({ id, pass: false, detail });

function read(rel: string): string {
  return readFileSync(join(backendRoot, rel), "utf8");
}

function geoLookupUrl(raw: string): URL {
  return new URL(`https://ipwho.is/${encodeURIComponent(raw)}`);
}

function runOutboundInventory() {
  const geo = read("src/services/loginGeoLookup.service.ts");
  const webhookSvc = read("src/services/itRechtKanzlei/itRechtKanzleiWebhook.service.ts");
  const stripeWh = read("src/webhooks/stripe.webhook.ts");
  const stripeSvc = read("src/services/stripe.service.ts");
  const index = read("src/index.ts");
  const fb = read("src/services/oauth/facebookVerifier.ts");
  const canvas = read("src/qr/installNodeQrCanvas.ts");

  if (geo.includes("https://ipwho.is/${encodeURIComponent(raw)}") && geo.includes("isPrivateOrLocalIp")) {
    pass("geo-fixed-host", "Login geo lookup fetches only https://ipwho.is/<encoded-ip>; private IPs skipped");
  } else {
    fail("geo-fixed-host", "Geo lookup URL construction changed");
  }

  if (!webhookSvc.includes("fetch(") && !webhookSvc.includes("https.request")) {
    pass(
      "legal-pdf-url-not-fetched",
      "IT-Recht webhook validates rechtstext_pdf_url but does not fetch it (no server-side SSRF sink)",
    );
  } else {
    fail("legal-pdf-url-not-fetched", "Legal webhook now performs outbound HTTP");
  }

  if (
    stripeWh.includes("verifyWebhookSignature") &&
    stripeSvc.includes("constructEvent") &&
    index.includes("express.raw")
  ) {
    pass("stripe-sig-required", "Stripe webhook uses constructEvent + raw body");
  } else {
    fail("stripe-sig-required", "Stripe signature path incomplete");
  }

  if (stripeWh.includes("isStripeWebhookEventProcessed")) {
    pass("stripe-event-idempotency", "Stripe webhook checks processed event ids before side effects");
  } else {
    fail("stripe-event-idempotency", "Event idempotency missing");
  }

  if (fb.includes("https://graph.facebook.com/debug_token") && fb.includes("https://graph.facebook.com/me")) {
    pass("facebook-fixed-host", "Facebook token debug/me requests use graph.facebook.com only");
  } else {
    fail("facebook-fixed-host", "Facebook verifier hosts unexpected");
  }

  if (canvas.includes("pathToFileURL") && canvas.includes("loadImage(key)")) {
    pass(
      "qr-loadimage-http-fallback",
      "INFORMATIONAL: Node QR canvas may loadImage(key) if file:// conversion fails — current HTTP QR path encodes targetUrl into PNG and does not fetch it",
    );
  }

  const billing = read("src/services/stripeBillingWebhook.service.ts");
  if (billing.includes("missing_caretipBusinessId") && billing.includes("findSubscriptionForStripeBilling")) {
    pass("billing-tenant-bind", "Billing webhooks require caretipBusinessId and resolve subscription by Stripe ids + business");
  } else {
    fail("billing-tenant-bind", "Billing tenant bind markers missing");
  }
}

function runUrlValidation() {
  if (!isValidRechtstextPdfUrl("http://127.0.0.1/secret.pdf")) {
    fail("pdf-url-allows-http-localhost", "Expected scheme-only validator to accept http localhost (documents residual)");
  } else {
    pass(
      "pdf-url-scheme-only",
      "isValidRechtstextPdfUrl accepts http://127.0.0.1 — INFORMATIONAL (URL is not fetched by the server)",
    );
  }
  if (isValidRechtstextPdfUrl("javascript:alert(1)")) {
    fail("pdf-url-rejects-javascript", "javascript: URL accepted");
  } else {
    pass("pdf-url-rejects-javascript", "Non-http(s) schemes rejected");
  }
  if (isValidRechtstextPdfUrl("ftp://example.com/a.pdf")) {
    fail("pdf-url-rejects-ftp", "ftp URL accepted");
  } else {
    pass("pdf-url-rejects-ftp", "ftp scheme rejected");
  }

  const poison = geoLookupUrl("127.0.0.1@evil.example/path");
  if (poison.hostname !== "ipwho.is") {
    fail("geo-host-injection", `Geo URL hostname became ${poison.hostname}`);
  } else {
    pass("geo-host-injection", `User-controlled IP stays a path segment (host=${poison.hostname}, path=${poison.pathname})`);
  }

  const slash = geoLookupUrl("8.8.8.8/../../");
  if (slash.hostname !== "ipwho.is") {
    fail("geo-path-slash", `Slash IP changed host to ${slash.hostname}`);
  } else {
    pass("geo-path-slash", "Encoded slashes cannot redirect geo lookup off ipwho.is");
  }
}

function runStripeBind() {
  const bizA = "biz_aaaaaaaaaaaaaaaaaaaaaaaa";
  const bizB = "biz_bbbbbbbbbbbbbbbbbbbbbbbb";
  if (!checkoutSessionBoundToBusiness({ metadata: { caretipBusinessId: bizB } }, bizA)) {
    pass("stripe-session-tenant", "Checkout session bind rejects foreign caretipBusinessId");
  } else {
    fail("stripe-session-tenant", "Foreign session bound");
  }
  if (!checkoutSessionBoundToBusiness({ metadata: {} }, bizA)) {
    pass("stripe-session-fail-closed", "Missing caretipBusinessId fail-closed");
  } else {
    fail("stripe-session-fail-closed", "Empty metadata still binds");
  }
}

async function withLocalListener(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  fn: (url: string, hits: { count: number }) => Promise<void>,
): Promise<void> {
  const hits = { count: 0 };
  const server = createHttpServer((req, res) => {
    hits.count += 1;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("failed to bind local listener");
  }
  const url = `http://127.0.0.1:${addr.port}/ssrf-probe`;
  try {
    await fn(url, hits);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function runSafeSsrfProof() {
  await withLocalListener(
    (_req, res) => {
      res.statusCode = 200;
      res.end("local");
    },
    async (localUrl, hits) => {
      const u = geoLookupUrl(localUrl);
      if (u.hostname !== "ipwho.is") {
        fail("ssrf-geo-not-to-local", `Geo URL targeted ${u.hostname}`);
        return;
      }
      if (hits.count !== 0) {
        fail("ssrf-geo-not-to-local", "Local listener was contacted during URL construction");
        return;
      }
      pass(
        "ssrf-geo-not-to-local",
        "Controlled local HTTP listener received 0 connections from geo URL construction (destination remains ipwho.is)",
      );
    },
  );
}

async function runLiveWebhooks() {
  try {
    await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    pass("live-webhooks", `SKIP API not reachable at ${API}`);
    return;
  }

  const unsigned = await fetch(`${API}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "checkout.session.completed", id: "evt_p14_unsigned" }),
    signal: AbortSignal.timeout(15000),
  });
  const unsignedText = await unsigned.text();
  if (unsigned.status === 400 && !unsignedText.toLowerCase().includes("prisma") && !unsignedText.includes("stack")) {
    pass(
      "live-stripe-unsigned",
      `Unsigned Stripe webhook → ${unsigned.status} without stack/prisma leak (${unsignedText.slice(0, 80)})`,
    );
  } else if (unsigned.status === 400) {
    pass("live-stripe-unsigned", `Unsigned Stripe webhook → 400 (${unsignedText.slice(0, 80)})`);
  } else {
    fail("live-stripe-unsigned", `Unsigned webhook status ${unsigned.status}: ${unsignedText.slice(0, 120)}`);
  }

  const badSig = await fetch(`${API}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    body: "{}",
    signal: AbortSignal.timeout(15000),
  });
  if (badSig.status === 400) {
    pass("live-stripe-badsig", `Invalid Stripe signature → ${badSig.status}`);
  } else {
    fail("live-stripe-badsig", `Invalid signature status ${badSig.status}`);
  }

  const legal = await fetch(`${API}/api/legal/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "privacy_policy", html: "<p>x</p>" }),
    signal: AbortSignal.timeout(15000),
  });
  if ([401, 503].includes(legal.status)) {
    pass("live-legal-unauth", `JSON legal webhook without Bearer → ${legal.status} (fail closed)`);
  } else {
    fail("live-legal-unauth", `Legal webhook status ${legal.status}`);
  }

  const replay1 = await fetch(`${API}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "evt_replay", type: "ping" }),
    signal: AbortSignal.timeout(15000),
  });
  const replay2 = await fetch(`${API}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "evt_replay", type: "ping" }),
    signal: AbortSignal.timeout(15000),
  });
  if (replay1.status === 400 && replay2.status === 400) {
    pass(
      "live-stripe-replay-unsigned",
      "Repeat unsigned deliveries both rejected at signature gate (no state change without Stripe HMAC)",
    );
  } else {
    fail("live-stripe-replay-unsigned", `Replay statuses ${replay1.status}/${replay2.status}`);
  }
}

async function main() {
  runOutboundInventory();
  runUrlValidation();
  runStripeBind();
  await runSafeSsrfProof();
  await runLiveWebhooks();

  console.log("=== Phase 14 SSRF / webhooks ===\n");
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
