/**
 * Redirect safety: internal-path validators (backend and web), legitimate integrations,
 * role-based post-login targets, notification links and the push-click service worker.
 * No network or database.
 * Run: npm run test:safe-redirect
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildTrustedAppUrl, toSafeAppPath } from "../src/config/frontendUrl.ts";
import { buildGoogleRedirectCompleteUrl } from "../src/services/oauth/googleOAuthRedirect.service.ts";
import { guestTipCheckoutCancelUrl } from "../src/services/stripe.service.ts";
import { toSafeInternalPath } from "../../src/app/lib/safeInternalPath.ts";
import { isAllowedStripeRedirectUrl } from "../../src/app/lib/externalStripeRedirect.ts";
import { resolvePostAuthTarget } from "../../src/app/lib/authRedirects.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = { ...process.env, FRONTEND_URL: "https://caretip.de", NODE_ENV: "production" } as NodeJS.ProcessEnv;
const ORIGIN = "https://caretip.de";

let passed = 0;
const check = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
};

const malicious = [
  "https://evil.example/phish",
  "http://caretip.de.evil.example/x",
  "https://caretip.de@evil.example/",
  "https://user:pw@caretip.de/dashboard",
  "//evil.example/x",
  "///evil.example",
  "/\\evil.example",
  "\\\\evil.example",
  "/%2F%2Fevil.example",
  "/%252F%252Fevil.example",
  "%2F%2Fevil.example",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "java\tscript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "/dashboard\u0000",
  "/dash\nboard",
  "http://localhost:5173/x",
  "https://caretip.de:8443/x",
  "ftp://caretip.de/x",
  "dashboard/x",
  "%E0%A4%A",
  "",
];

const legitimate: Array<[string, string]> = [
  ["/dashboard", "/dashboard"],
  ["/dashboard/billing/subscription", "/dashboard/billing/subscription"],
  ["/dashboard/support/ck123?tab=messages#latest", "/dashboard/support/ck123?tab=messages#latest"],
  ["/employee/tip-history", "/employee/tip-history"],
  ["https://caretip.de/platform-admin/businesses/abc", "/platform-admin/businesses/abc"],
  ["/dashboard/../employee/settings", "/employee/settings"],
  ["/search?q=caf%C3%A9", "/search?q=caf%C3%A9"],
];

await check("backend: malicious destinations are rejected", () => {
  for (const m of malicious) assert.equal(toSafeAppPath(m, env), null, JSON.stringify(m));
});

await check("web: malicious destinations are rejected", () => {
  for (const m of malicious) assert.equal(toSafeInternalPath(m, ORIGIN), null, JSON.stringify(m));
});

await check("backend and web: internal routes, nested routes, query and hash are kept", () => {
  for (const [input, expected] of legitimate) {
    assert.equal(toSafeAppPath(input, env), expected, input);
    assert.equal(toSafeInternalPath(input, ORIGIN), expected, input);
  }
});

await check("email links still require the CareTip origin", () => {
  assert.equal(buildTrustedAppUrl("/employee/tip-history", env), "https://caretip.de/employee/tip-history");
  assert.throws(() => buildTrustedAppUrl("https://evil.example/x", env));
  assert.throws(() => buildTrustedAppUrl("//evil.example/x", env));
});

await check("Google OAuth completion stays on the app (handoff in the fragment, not the query)", () => {
  const url = buildGoogleRedirectCompleteUrl({ handoff: "sealed" });
  assert.equal(url, "/auth/google/complete#handoff=sealed");
  assert.equal(toSafeInternalPath(url, ORIGIN), url);
});

await check("Stripe: only Stripe-hosted HTTPS pages are accepted, per flow", () => {
  assert.ok(isAllowedStripeRedirectUrl("https://checkout.stripe.com/c/pay/cs_test_1", "checkout"));
  assert.ok(isAllowedStripeRedirectUrl("https://billing.stripe.com/p/session/x", "portal"));
  assert.ok(isAllowedStripeRedirectUrl("https://connect.stripe.com/setup/e/acct_1/x", "connect"));
  assert.ok(isAllowedStripeRedirectUrl("https://connect.stripe.com/express/acct_1/x", "expressDashboard"));
  for (const bad of [
    "http://checkout.stripe.com/c/pay/x",
    "https://checkout.stripe.com.evil.example/x",
    "https://evil.example/?u=https://checkout.stripe.com",
    "https://stripe.com.evil.example/express/",
    "javascript:alert(1)",
  ]) {
    assert.equal(isAllowedStripeRedirectUrl(bad, "checkout"), false, bad);
  }
  assert.equal(isAllowedStripeRedirectUrl("https://checkout.stripe.com/x", "portal"), false, "flow-specific host");
});

await check("Stripe return URLs are built on the app origin with no client input", () => {
  const cancel = guestTipCheckoutCancelUrl("https://caretip.de", "emp_1", "loc_1", null);
  assert.equal(new URL(cancel).origin, ORIGIN);
  assert.equal(new URL(cancel).pathname, "/tip-amount");
});

await check("post-login targets respect the role", () => {
  const employee = { role: "employee", isVerified: true, hasCompletedOnboarding: true } as const;
  assert.equal(resolvePostAuthTarget(employee, "/employee/tip-history"), "/employee/tip-history");
  for (const bad of ["/dashboard", "/platform-admin", "https://evil.example", "//evil.example", "/employee//x", "/employee/login"]) {
    assert.equal(resolvePostAuthTarget(employee, bad), "/employee/dashboard", bad);
  }
  const manager = { role: "business", isVerified: true, hasCompletedOnboarding: true } as const;
  assert.equal(resolvePostAuthTarget(manager, "/platform-admin/system"), "/dashboard");
  assert.equal(resolvePostAuthTarget(manager, "https://evil.example"), "/dashboard");
  const admin = { role: "platform_admin", isVerified: true, hasCompletedOnboarding: true } as const;
  assert.equal(resolvePostAuthTarget(admin, "/dashboard"), "/platform-admin/dashboard");
  assert.equal(resolvePostAuthTarget({ ...employee, isVerified: false }, "/employee/tip-history"), "/verify-email");
});

await check("notification links: inbox, orchestrator and announcements use the validators", () => {
  // notificationNavigation.ts pulls in the whole web API client, so its use of the helper is
  // asserted on the source; the helper itself is covered by the cases above.
  const nav = readFileSync(path.join(root, "src/app/lib/notificationNavigation.ts"), "utf8");
  assert.match(nav, /const raw = toSafeInternalPath\(notification\.url/);
  const orch = readFileSync(
    path.join(root, "backend/src/services/notifications/notificationOrchestrator.service.ts"),
    "utf8",
  );
  assert.match(orch, /toSafeAppPath\(input\.payload\.url\)/);
  assert.match(orch, /url: safeUrl \?\? undefined/);
  const platform = readFileSync(path.join(root, "backend/src/services/platform.service.ts"), "utf8");
  assert.match(platform, /if \(rawUrl && !safeUrl\)/);
});

await check("push click handler opens only same-origin pages", () => {
  const src = readFileSync(path.join(root, "public/fcm-sw-handler.js"), "utf8");
  const generator = readFileSync(path.join(root, "scripts/generate-fcm-sw.mjs"), "utf8");
  const full = readFileSync(path.join(root, "public/firebase-messaging-sw.js"), "utf8");
  for (const s of [generator, full]) assert.ok(s.includes("parsed.origin === self.location.origin"));

  const run = (url: unknown, withClient: boolean) => {
    const opened: string[] = [];
    let clickHandler: ((e: unknown) => void) | null = null;
    const client = {
      focus: async () => client,
      navigate: async (t: string) => { opened.push(t); },
    };
    const sandbox = {
      URL,
      self: {
        location: { origin: ORIGIN },
        addEventListener: (type: string, fn: (e: unknown) => void) => {
          if (type === "notificationclick") clickHandler = fn;
        },
        registration: { showNotification: () => undefined },
      },
      clients: {
        matchAll: async () => (withClient ? [client] : []),
        openWindow: async (t: string) => { opened.push(t); },
      },
      firebase: { initializeApp: () => undefined, messaging: () => ({ onBackgroundMessage: () => undefined }) },
      importScripts: () => undefined,
      console,
    };
    (sandbox as Record<string, unknown>).addEventListener = sandbox.self.addEventListener;
    vm.runInNewContext(src, sandbox);
    let waited: Promise<unknown> = Promise.resolve();
    clickHandler!({
      notification: { close: () => undefined, data: { url } },
      waitUntil: (p: Promise<unknown>) => { waited = p; },
    });
    return waited.then(() => opened);
  };

  return Promise.all([
    run("/dashboard/support/1", false).then((o) => assert.deepEqual(o, ["/dashboard/support/1"])),
    run("https://evil.example/x", false).then((o) => assert.deepEqual(o, ["/"])),
    run("//evil.example/x", true).then((o) => assert.deepEqual(o, ["/"])),
    run("javascript:alert(1)", false).then((o) => assert.deepEqual(o, ["/"])),
    run(undefined, false).then((o) => assert.deepEqual(o, ["/"])),
  ]).then(() => undefined);
});

console.log(`safe-redirect-runtime: ok (${passed} checks)`);
