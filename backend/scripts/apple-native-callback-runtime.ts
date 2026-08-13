/**
 * Apple Android form_post bounce helpers (no live Apple / no session creation).
 *
 *   npm run test:apple-native-callback
 *   npx tsx scripts/apple-native-callback-runtime.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  androidPackageForScheme,
  appleNameFromUserField,
  buildAppleNativeCallbackHtml,
  buildAppleNativeDeepLink,
  schemeFromAppleState,
} from "../src/services/oauth/appleNativeCallbackBounce.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function main(): void {
  assert.equal(schemeFromAppleState("caretip.abc123"), "caretip");
  assert.equal(schemeFromAppleState("caretip-dev.abc123"), "caretip-dev");
  assert.equal(schemeFromAppleState("https://evil.example"), "caretip");
  assert.equal(schemeFromAppleState(undefined), "caretip");
  assert.equal(androidPackageForScheme("caretip"), "de.caretip.app");
  assert.equal(androidPackageForScheme("caretip-dev"), "de.caretip.app.dev");

  const name = appleNameFromUserField(
    JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" } }),
  );
  assert.equal(name, "Ada Lovelace");
  assert.equal(appleNameFromUserField("not-json"), undefined);

  const idToken = "aaa.bbb.ccc";
  const html = buildAppleNativeCallbackHtml({
    id_token: idToken,
    user: JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" } }),
    state: "caretip.nonce1",
  });
  assert.equal(html.status, 200);
  assert.match(html.body, /caretip:\/\/apple-auth/);
  assert.match(html.body, /id_token=/);
  assert.match(html.body, /Ada\+Lovelace|Ada%20Lovelace/);
  assert.doesNotMatch(html.body, /authorization.?code/i);

  const cancelled = buildAppleNativeCallbackHtml({
    error: "user_cancelled_authorize",
    state: "caretip-dev.nonce2",
  });
  assert.equal(cancelled.status, 200);
  assert.match(cancelled.body, /caretip-dev:\/\/apple-auth/);
  assert.match(cancelled.body, /error=user_cancelled_authorize/);
  assert.doesNotMatch(cancelled.body, /id_token=/);

  const invalid = buildAppleNativeCallbackHtml({ id_token: "not-a-jwt" });
  assert.equal(invalid.status, 200);
  assert.match(invalid.body, /error=invalid_request/);
  assert.doesNotMatch(invalid.body, /id_token=/);

  const missing = buildAppleNativeCallbackHtml({});
  assert.equal(missing.status, 200);
  assert.match(missing.body, /error=invalid_request/);

  const deep = buildAppleNativeDeepLink({
    scheme: "caretip",
    idToken,
    name: "Ada",
    state: "caretip.nonce1",
  });
  assert.ok(deep.startsWith("caretip://apple-auth"));
  assert.match(deep, /id_token=aaa\.bbb\.ccc/);

  const bounceSrc = fs.readFileSync(
    path.join(repoRoot, "backend/src/services/oauth/appleNativeCallbackBounce.ts"),
    "utf8",
  );
  assert.match(bounceSrc, /Never log/);
  assert.doesNotMatch(bounceSrc, /console\.(log|info|debug|error).*id_token/);

  const controller = fs.readFileSync(
    path.join(repoRoot, "backend/src/controllers/auth.controller.ts"),
    "utf8",
  );
  const start = controller.indexOf("Apple HTTPS Return URL bounce");
  const next = controller.indexOf("export async function listLinkedOAuthAccounts", start);
  assert.ok(start >= 0 && next > start);
  const bounceHandler = controller.slice(start, next);
  assert.match(bounceHandler, /Never logs id_token/);
  assert.doesNotMatch(bounceHandler, /console\.(log|info|debug)/);

  const routes = fs.readFileSync(path.join(repoRoot, "backend/src/routes/auth.routes.ts"), "utf8");
  assert.match(routes, /\/apple\/native-callback/);
  assert.match(routes, /urlencoded/);
  assert.match(routes, /authController\.oauth/);

  const verifier = fs.readFileSync(
    path.join(repoRoot, "backend/src/services/oauth/appleVerifier.ts"),
    "utf8",
  );
  assert.match(verifier, /APPLE_CLIENT_IDS/);
  assert.match(verifier, /appleid\.apple\.com/);

  const oauthAuth = fs.readFileSync(
    path.join(repoRoot, "backend/src/services/oauthAuth.service.ts"),
    "utf8",
  );
  assert.match(oauthAuth, /never auto-link by email/);

  const appleMobile = fs.readFileSync(
    path.join(repoRoot, "mobile/services/apple/appleSignIn.ts"),
    "utf8",
  );
  assert.doesNotMatch(appleMobile, /EXPO_PUBLIC_APPLE_PRIVATE/);
  assert.doesNotMatch(appleMobile, /APPLE_PRIVATE_KEY/);
  const appleConfig = fs.readFileSync(path.join(repoRoot, "mobile/constants/config.ts"), "utf8");
  assert.doesNotMatch(appleConfig, /EXPO_PUBLIC_APPLE_PRIVATE/);
  assert.doesNotMatch(appleConfig, /APPLE_PRIVATE_KEY/);

  console.log("apple-native-callback-runtime: OK");
}

main();
