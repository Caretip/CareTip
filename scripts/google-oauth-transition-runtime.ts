/**
 * Google sign-in transition regressions (no backend, no Google). Run: npm run test:google-oauth-transition
 *
 * Root causes covered:
 *  1  Returning from Google (redirect mode) painted the email/password form until the credential
 *     exchange began → AuthPage starts in a "Signing you in with Google" state when a hand-off is
 *     pending, sets it for every provider exchange, and clears it on every failure path.
 *  2  /auth/google/complete dropped the boot screen on React's first write: a blank frame, then a
 *     CareTip shell, the auth page's code loader and the form → the boot is held until the auth page
 *     (or the error screen) commits, and the auth page's code is loaded before navigating.
 *  3  No feedback between tapping Google and leaving the page (redirect mode) → "Opening Google…".
 *  4  The Google button rendered at 200px and redrew at the measured width → renders once, measured.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

type Check = { id: string; ok: boolean; detail: string };
const results: Check[] = [];
const check = (cond: unknown, id: string, detail: string) => results.push({ id, ok: Boolean(cond), detail });

// ── 2: boot retain rule (real module, stubbed document) ──────────────────────────────────────────
let routeReady = false;
const fakeDoc = {
  querySelector: (sel: string) => (sel.includes("data-caretip-route-ready") && routeReady ? {} : null),
  documentElement: { classList: { contains: () => true } },
  getElementById: () => ({}),
};
Object.defineProperty(globalThis, "document", { value: fakeDoc, configurable: true });
Object.defineProperty(globalThis, "window", {
  value: { location: { pathname: "/auth/google/complete" } },
  configurable: true,
});
const { shouldRetainHtmlBootUntilLandingCommit } = await import("../src/app/lib/htmlMarketingBootBridge");
const cappedOut = performance.now() >= 10_000;
if (!cappedOut) {
  routeReady = false;
  check(shouldRetainHtmlBootUntilLandingCommit() === true, "B1", "boot is held on /auth/google/complete while nothing committed");
  routeReady = true;
  check(shouldRetainHtmlBootUntilLandingCommit() === false, "B2", "boot is released once the error screen commits its ready marker");
} else {
  check(true, "B1", "(skipped: process older than the 10s retain cap)");
}
const complete = read("src/app/pages/GoogleOAuthCompletePage.tsx");
check(/<div data-caretip-route-ready="">\s*<AuthOAuthProgress provider="google" \/>/.test(complete), "B3", "the completion page shows the Google progress state (not a CareTip shell)");
check(!/AuthBootstrapShell/.test(complete), "B4", "no CareTip loader on the completion page");
const bootLocale = read("public/boot-locale.js");
check(/bootPath === GOOGLE_RETURN_PATH\) applyGoogleReturnBootVariant/.test(bootLocale) && /setAttribute\("data-oauth-progress", "google"\)/.test(bootLocale), "B6",
  "the boot screen on the Google return URL shows the Google progress state (before any app code)");
const indexHtml = read("index.html");
check(/html:not\(\[data-boot-copy\]\) \.caretip-html-boot__mark \{\s*visibility: hidden;/.test(indexHtml) && /setAttribute\("data-boot-copy", ""\)/.test(bootLocale), "B10",
  "the CareTip boot mark stays hidden until boot-locale.js has run (no flash before the Google variant), with a CSS fallback");
const intent = read("src/app/lib/authTransitionIntent.ts");
check(/isGoogleRedirectReturnInProgress\(\)\s*\);/.test(intent), "B7", "the CareTip session-check overlay is suppressed during a Google return");
const cover = read("src/app/components/auth/SignInHandoffCover.tsx");
check(/if \(provider\) \{[\s\S]*?<AuthOAuthProgress provider=\{provider\} \/>/.test(cover), "B8", "the sign-in cover continues the provider progress state (no CareTip loader)");
check(/beginAuthSignInHandoff\(\);\s*setAuthSignInHandoffProvider\(provider\);/.test(read("src/app/components/AuthPage.tsx")), "B9", "provider sign-ins tell the cover which provider is in progress");
check(/ensureAuthEntryRouteCode\(returnPath\)/.test(complete), "B5", "the auth page's code is loaded before navigating (no Suspense loader)");

// ── 1: AuthPage progress state ───────────────────────────────────────────────────────────────────
const auth = read("src/app/components/AuthPage.tsx");
check(/useState<OAuthProgressProvider \| null>\(\(\) =>\s*hasPendingGoogleRedirectHandoff\(\) \? "google" : null/.test(auth), "P1",
  "AuthPage starts in the Google progress state when a redirect hand-off is pending (form never paints)");
const social = auth.slice(auth.indexOf("const runSocialOAuth = async"), auth.indexOf("// Google redirect mode"));
check(/authInFlightRef\.current = true;\s*setOauthProgress\(provider\);/.test(social), "P2", "every provider exchange shows the progress state once it starts");
const clears = (social.match(/setOauthProgress\(null\)/g) ?? []).length;
check(clears >= 6, "P3", `progress cleared on every failure path in runSocialOAuth (${clears} sites: validation ×3, MFA, error, finally)`);
check(/if \(!handoff\) \{\s*setOauthProgress\(null\);/.test(auth), "P4", "an expired hand-off clears the progress state and shows the error");
check(/setAuthFlowInProgress\(false\);\s*setOauthProgress\(null\);\s*endAuthSignInHandoff\("auth_navigation_recovery"\)/.test(auth), "P5", "navigation recovery clears the progress state");
check(/\{oauthProgress \? <AuthOAuthProgress provider=\{oauthProgress\} \/> : null\}/.test(auth), "P6", "progress state rendered over the page");
check(/\.\.\.\(oauthProgress \? \{ inert: "", "aria-hidden": true \} : \{\}\)/.test(auth), "P7", "the form stays mounted but inert and hidden from assistive tech");
const progress = read("src/app/components/auth/AuthOAuthProgress.tsx");
check(/data-oauth-progress=\{provider\}/.test(progress) && /role="status"/.test(progress) && /aria-live="polite"/.test(progress), "P8", "progress state is an announced status");
check(/titleRef\.current\?\.focus\(\)/.test(progress), "P9", "focus moves to the status (not a hidden form field)");

// ── 3/4: Google button ───────────────────────────────────────────────────────────────────────────
const btn = read("src/app/components/auth/AuthGoogleLoginButton.tsx");
check(/useState<number \| null>\(null\)/.test(btn) && /scriptLoadedSuccessfully && width != null \?/.test(btn), "G1", "Google button renders only once its width is measured (no redraw)");
check(/useLayoutEffect\(\(\) => \{\s*const el = hostRef\.current;/.test(btn), "G2", "width measured before paint");
check(/if \(uxMode === "redirect"\) setLeavingForGoogle\(true\)/.test(btn), "G3", "redirect tap shows Opening Google…");
check(/if \(document\.visibilityState !== "hidden"\) setLeavingForGoogle\(false\)/.test(btn) && /addEventListener\("pageshow", onReturn\)/.test(btn), "G4",
  "Opening Google… clears when the page is shown again (Back, bfcache) — cannot stick");

for (const lang of ["en", "de"]) {
  const j = JSON.parse(read(`src/i18n/locales/${lang}.json`)) as { auth: { oauth: Record<string, unknown> } };
  const p = j.auth.oauth.progress as Record<string, string> | undefined;
  check(Boolean(p?.title?.includes("{{provider}}") && p?.hint && j.auth.oauth.openingGoogle), "L1", `${lang}: progress and Opening Google copy present`);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} [${r.id}] ${r.detail}`);
if (failed.length) {
  console.log(`\ngoogle-oauth-transition-runtime: ${failed.length} failure(s)`);
  process.exit(1);
}
console.log(`\ngoogle-oauth-transition-runtime: ok (${results.length} checks)`);
process.exit(0);
