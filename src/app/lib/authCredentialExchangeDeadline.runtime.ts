import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API_WAKEUP_NETWORK_MESSAGE } from "./errorMessages";
import {
  getAuthCredentialExchangeTimeoutMs,
  scheduleAuthNavigationRecovery,
  withAuthCredentialExchangeDeadline,
} from "./authCredentialExchangeDeadline";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

assert.equal(getAuthCredentialExchangeTimeoutMs(), 20_000);

const api = read("src/app/lib/api.ts");
for (const marker of [
  'apiPath("/api/auth/register")',
  'apiPath("/api/auth/signin")',
  'apiPath("/api/auth/oauth")',
  'apiPath("/api/auth/login/mfa/enable")',
  'apiPath("/api/auth/login/mfa/verify")',
  'apiPath("/api/auth/login/mfa/setup")',
]) {
  const at = api.indexOf(marker);
  assert.ok(at > 0, marker);
  assert.ok(api.lastIndexOf("withAuthCredentialExchangeDeadline", at) > at - 600, marker);
}
assert.ok(read("src/app/lib/authRefreshCoordination.ts").includes("REFRESH_COORD_TIMEOUT_MS = 12_000"));
assert.equal(api.includes("logoutAPIWithTimeout"), true);

const prefetch = read("src/app/lib/prefetchAuthenticatedRoutes.ts");
const prepare = prefetch.slice(prefetch.indexOf("export function preparePostAuthDestination"));
assert.equal(prepare.includes("await prefetchAuthenticatedShell"), false);
assert.ok(prepare.includes("void prefetchAuthenticatedShell"));

const authPage = read("src/app/components/AuthPage.tsx");
assert.ok(authPage.includes("scheduleAuthNavigationRecovery"));
assert.ok(authPage.includes("armNavigationRecovery()"));
assert.ok(authPage.includes("if (!postAuthRedirectRef.current)"));
assert.ok(authPage.includes('t("auth.page.navigationRecovery")'));

const facebook = read("src/app/lib/facebookOAuthRedirectWeb.ts");
assert.equal(facebook.includes("shouldFailFacebookStartForStall"), false);
assert.equal(facebook.includes("redirect_navigation_stalled"), false);
assert.equal(facebook.includes("getAuthCredentialExchangeTimeoutMs"), false);
assert.ok(facebook.includes('failStart(\n      "csp_form_action_blocked"'));
assert.ok(facebook.includes('failStart("form_submit_exception", "form_submit_threw"'));
assert.equal((facebook.match(/form\.submit\(\)/g) ?? []).length, 1);
assert.equal((facebook.match(/window\.location\.assign/g) ?? []).length, 1);
assert.ok(facebook.includes("navigationLeft = true"));

const apple = read("src/app/lib/appleOAuthWeb.ts");
assert.ok(apple.includes("withAuthCredentialExchangeDeadline"));
assert.ok(apple.includes("usePopup: true"));

let aborted = false;
try {
  await withAuthCredentialExchangeDeadline(
    (signal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
    40,
  );
  assert.fail("pending auth request should reject");
} catch (err) {
  assert.equal(aborted, true);
  assert.ok(err instanceof Error);
  assert.equal(err.message, API_WAKEUP_NETWORK_MESSAGE);
  assert.equal("user" in err, false);
  assert.equal("pendingMfaToken" in err, false);
}

const ok = await withAuthCredentialExchangeDeadline(async () => "session", 200);
assert.equal(ok, "session");

try {
  await withAuthCredentialExchangeDeadline(async () => {
    throw new Error("Invalid email or password");
  }, 200);
  assert.fail("real auth error should surface");
} catch (err) {
  assert.ok(err instanceof Error);
  assert.equal(err.message, "Invalid email or password");
}

let recovered = false;
let pending = true;
scheduleAuthNavigationRecovery({
  delayMs: 30,
  isRedirectPending: () => pending,
  onRecover: () => {
    recovered = true;
    pending = false;
  },
});
await new Promise((resolve) => setTimeout(resolve, 60));
assert.equal(recovered, true);
assert.equal(pending, false);

recovered = false;
pending = true;
const cancel = scheduleAuthNavigationRecovery({
  delayMs: 30,
  isRedirectPending: () => pending,
  onRecover: () => {
    recovered = true;
  },
});
cancel();
await new Promise((resolve) => setTimeout(resolve, 60));
assert.equal(recovered, false);
assert.equal(pending, true);

pending = false;
scheduleAuthNavigationRecovery({
  delayMs: 20,
  isRedirectPending: () => pending,
  onRecover: () => {
    recovered = true;
  },
});
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(recovered, false);

console.log("authCredentialExchangeDeadline-runtime: all passed");
