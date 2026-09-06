/**
 * Google Sign-In (GIS) mount / hit-test lifecycle — source regression for the
 * Firefox Android multi-tap bug (near-invisible iframe overlay + parent
 * transform + delayed/conditional remount).
 * Run: npm run test:google-signin-gsi
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const row = read("src/app/components/auth/OAuthProviderRow.tsx");
const css = read("src/styles/caretip-oauth-circles.css");
const authCss = read("src/styles/caretip-auth.css");
const app = read("src/app/App.tsx");
const oauthScope = read("src/app/components/auth/AuthGoogleOAuthScope.tsx");
const verifier = read("backend/src/services/oauth/googleVerifier.ts");

if (!row.includes("gsiMounted") && !row.includes("setGsiMounted")) {
  pass("GoogleLogin is not delayed behind a post-paint gsiMounted gate");
} else {
  fail("OAuthProviderRow must not delay GIS behind gsiMounted");
}

if (
  /\{showGoogle \? \(/.test(row) &&
  row.includes("<GoogleLogin") &&
  !row.includes("gsiMounted && showGoogle && !disabled")
) {
  pass("GoogleLogin stays mounted while the Google circle is configured (not torn down on disabled)");
} else {
  fail("GoogleLogin must remain mounted whenever Google is configured");
}

if (!/setTimeout\s*\(/.test(row) && !row.includes("dispatchEvent") && !/\.click\s*\(/.test(row)) {
  pass("OAuthProviderRow has no synthetic click / timeout GIS hacks");
} else {
  fail("OAuthProviderRow must not synthesize GIS clicks or use arbitrary delays");
}

if (row.includes("onSuccess={onGoogleSuccess}") && row.includes("useCallback")) {
  pass("GIS onSuccess is a stable callback (not an inline function)");
} else {
  fail("GIS onSuccess must be wrapped in useCallback");
}

if (row.includes("containerProps") && row.includes("width: 44") && row.includes("height: 44")) {
  pass("GIS host is sized to the 44px visible circle");
} else {
  fail("GoogleLogin containerProps must match the 44px circle");
}

if (css.includes("opacity: 0.02") || css.includes("opacity: 0.011") || /opacity:\s*0\s*;/.test(css)) {
  fail("GIS overlay must not use near-zero opacity (Firefox treats it as inactive)");
} else if (css.includes(".caretip-oauth-circle__gsi") && css.includes("opacity: 1")) {
  pass("GIS overlay is fully opaque for hit-testing; branded logo covers it visually");
} else {
  fail("caretip-oauth-circle__gsi must be opacity: 1");
}

if (
  /:active[^{]*caretip-oauth-circle--google/.test(css) &&
  /@media\s*\(\s*hover:\s*hover/.test(css) &&
  css.includes("transform: none")
) {
  pass("Google circle is excluded from :hover/:active transforms that shift the GIS iframe");
} else {
  fail("Google circle must not apply :active/:hover transforms over the GIS iframe");
}

if (css.includes("touch-action: manipulation") && css.includes("margin: 0 !important")) {
  pass("GIS iframe is clipped to 44px with no auto-margin and touch-action: manipulation");
} else {
  fail("GIS iframe layout must reset auth.css iframe margin and keep a 44px hit target");
}

if (css.includes(".caretip-auth-oauth .caretip-oauth-circle__gsi iframe")) {
  pass("GIS iframe rules beat .caretip-auth-oauth iframe min-height/margin");
} else {
  fail("Need a more-specific GIS iframe override than caretip-auth.css");
}

if (authCss.includes(".caretip-auth-oauth iframe") && authCss.includes("min-height: 3rem !important")) {
  pass("caretip-auth.css still has generic oauth iframe rules (GIS override lives in circles CSS)");
} else {
  fail("Unexpected caretip-auth.css oauth iframe drift");
}

if (app.includes("GoogleOAuthProvider")) {
  fail("GoogleOAuthProvider must not wrap the public landing App tree");
} else {
  pass("Public App tree does not mount GIS on caretip.de first paint");
}

if (
  oauthScope.includes("GoogleOAuthProvider") &&
  row.includes("AuthGoogleOAuthScope") &&
  row.includes("GoogleLogin") &&
  row.includes("onSocialCredential")
) {
  pass("GIS still flows Provider → GoogleLogin → onSocialCredential (no custom fake button)");
} else {
  fail("Do not replace the official GIS button with a custom control");
}

if (
  verifier.includes("verifyIdToken") &&
  verifier.includes("audience") &&
  !row.includes("localStorage.setItem")
) {
  pass("Backend Google ID-token verification remains the source of identity");
} else {
  fail("Must not weaken backend Google credential verification");
}

const failed = results.filter((r) => r.startsWith("FAIL:"));
for (const line of results) console.log(line);
if (failed.length) {
  console.error(`\n${failed.length} Google GIS lifecycle check(s) failed`);
  process.exit(1);
}
console.log("\nAll google-signin-gsi lifecycle checks passed");
