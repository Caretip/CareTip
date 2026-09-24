/**
 * Auth navigation / false-logout regression matrix (static + lightweight simulation).
 * Run: npm run test:auth-navigation-session-preservation
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Check = { id: string; ok: boolean; detail: string };
const checks: Check[] = [];
const pass = (id: string, detail: string) => checks.push({ id, ok: true, detail });
const fail = (id: string, detail: string) => checks.push({ id, ok: false, detail });

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function must(cond: unknown, id: string, detail: string): void {
  if (cond) pass(id, detail);
  else fail(id, detail);
}

const apiSrc = read("src/app/lib/api.ts");
const pricingLegal = read("src/components/pricing/PricingGridLegalNote.tsx");
const merchantLegal = read("src/app/components/legal/MerchantLegalAcceptanceCheckbox.tsx");
const diagnostics = read("src/app/lib/authSessionDiagnostics.ts");
const clientLogout = read("src/app/lib/clientLogout.ts");
const authInit = read("src/app/hooks/useAuthInitializer.ts");

// AUTH-01 / AUTH-14 / AUTH-15 / AUTH-16 — 401 handler must not clear session on transient skip
must(
  apiSrc.includes("bypassCooldown") && apiSrc.includes("refreshAccessToken({ bypassCooldown: true })"),
  "AUTH-01-bypass-cooldown-on-401",
  "401 recovery always attempts refresh (bypasses post-503 cooldown)",
);

must(
  !apiSrc.includes("(Date.now() >= refreshFailureCooldownUntil || !tokenIsSet)") ||
    apiSrc.includes("bypassCooldown: true"),
  "AUTH-14-no-cooldown-gate-on-401",
  "401 handler no longer skips refresh when cooldown active + stale JWT present",
);

must(
  apiSrc.includes('outcome: "resource_denied_session_preserved"') &&
    apiSrc.includes("refreshDeemedInvalid || !hasTokenAfterRecovery"),
  "AUTH-16-no-false-clear-on-resource-401",
  "persistent 401 clears session only when refresh invalid or no token after recovery",
);

must(
  apiSrc.includes("isAbortError(err)") && apiSrc.includes("throw err"),
  "AUTH-16-abort-no-logout",
  "aborted API requests throw without session clear",
);

must(
  apiSrc.includes("SERVICE_UNAVAILABLE_CLIENT_MESSAGE") ||
    read("src/app/lib/authRefreshFailureClassification.ts").includes("SERVICE_UNAVAILABLE"),
  "AUTH-15-transient-not-definitive",
  "transient infra failures classified separately from auth invalidation",
);

// AUTH-09 — peer refresh retry preserved
must(
  apiSrc.includes("hasRecentPeerRefreshSuccess()") && apiSrc.includes("coordinateCrossTabRefresh"),
  "AUTH-09-multitab-refresh-coordination",
  "cross-tab refresh coordination + peer-success retry remain in place",
);

// AUTH-11 — explicit logout
must(
  clientLogout.includes('AUTH_LOGOUT_REASON') && clientLogout.includes("explicit_user_logout"),
  "AUTH-11-explicit-logout-diagnostic",
  "explicit logout records AUTH_LOGOUT_REASON diagnostic",
);

// AUTH-19 / AUTH-20 — checkout legal links
must(
  merchantLegal.includes('target="_blank"') && merchantLegal.includes('rel="noopener noreferrer"'),
  "AUTH-19-merchant-legal-new-tab",
  "merchant checkout legal acceptance links open in new tab with noopener",
);

must(
  pricingLegal.includes('target="_blank"') && pricingLegal.includes('rel="noopener noreferrer"'),
  "AUTH-04-pricing-plv-new-tab",
  "billing pricing grid PLV link opens in new tab (checkout continuity)",
);

// Diagnostics
must(
  diagnostics.includes("AUTH_SESSION_INVALIDATION_REASON") &&
    diagnostics.includes("AUTH_API_401_OUTCOME"),
  "AUTH-diagnostics",
  "structured auth session diagnostics available (opt-in)",
);

must(
  authInit.includes("AUTH_BOOTSTRAP_REDIRECT_REASON"),
  "AUTH-02-bootstrap-diagnostic",
  "bootstrap expiry records redirect reason without silent logout",
);

// Checkout must not clear auth on unmount
const staleStripe = read("src/app/hooks/useStaleExternalStripeStateReset.ts");
must(
  !staleStripe.includes("logout") && !staleStripe.includes("clearAuth"),
  "AUTH-checkout-no-auth-cleanup",
  "checkout stale-state reset does not call logout/clearAuth",
);

// Stripe workflows unchanged
must(
  read("src/app/lib/externalStripeRedirect.ts").includes("window.location.assign"),
  "AUTH-17-stripe-checkout-redirect",
  "Stripe external redirect flow preserved",
);

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.id} — ${c.detail}`);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length > 0) process.exit(1);
