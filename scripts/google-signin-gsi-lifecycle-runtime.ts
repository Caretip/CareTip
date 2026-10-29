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
const googleButton = read("src/app/components/auth/AuthGoogleLoginButton.tsx");
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
  row.includes("if (!showGoogle) return null;") &&
  row.includes("<AuthGoogleLoginButton") &&
  googleButton.includes("<GoogleLogin") &&
  !row.includes("gsiMounted && showGoogle && !disabled")
) {
  pass("GoogleLogin stays mounted while Google is configured (not torn down on disabled)");
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

if (
  googleButton.includes('type="standard"') &&
  googleButton.includes('text="continue_with"') &&
  googleButton.includes('shape="rectangular"') &&
  googleButton.includes("containerProps") &&
  /Math\.min\(GSI_MAX_WIDTH, Math\.max\(GSI_MIN_WIDTH/.test(googleButton)
) {
  pass("GIS renders the standard Continue with Google button within its 200–400px width limits");
} else {
  fail("GoogleLogin must be the standard rectangular button with a clamped pixel width");
}

if (!row.includes("caretip-oauth-circle__gsi") && !row.includes("OAUTH_LOGO_SRC.google")) {
  pass("No branded logo overlay sits on top of the GIS iframe");
} else {
  fail("The Google button must not be covered by a logo overlay");
}

if (css.includes("opacity: 0.02") || css.includes("opacity: 0.011") || /opacity:\s*0\s*;/.test(css)) {
  fail("GIS button must not use near-zero opacity (Firefox treats it as inactive)");
} else {
  pass("GIS button is not hidden behind near-zero opacity");
}

const googleSlotCss = css.slice(css.indexOf(".caretip-oauth-google-slot {"));
if (
  /\.caretip-oauth-google-slot \{[^}]*transform: none/.test(css) &&
  !/\.caretip-oauth-google[^{]*:(hover|active)/.test(googleSlotCss)
) {
  pass("Google button is excluded from :hover/:active transforms that shift the GIS iframe");
} else {
  fail("Google button must not apply :active/:hover transforms over the GIS iframe");
}

if (css.includes("touch-action: manipulation") && css.includes("margin: 0 !important")) {
  pass("GIS iframe has no auto-margin and keeps touch-action: manipulation");
} else {
  fail("GIS iframe layout must reset auth.css iframe margin");
}

if (css.includes(".caretip-auth-oauth .caretip-oauth-google-button iframe")) {
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
  row.includes("AuthGoogleLoginButton") &&
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
