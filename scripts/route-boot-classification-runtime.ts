/**
 * Route classification behind the first-paint boot screen.
 *
 * Misclassified paths kept `#caretip-html-boot` up indefinitely: `/subscription/success`,
 * `/subscription/canceled` and `/account/recovery` looked like a venue's tip page (and showed
 * "Preparing your tipping experience…"), and `/reset-password/:token` and `/join/:code` looked like
 * tip journeys waiting for a ready marker they never set.
 *
 *   node ./backend/node_modules/tsx/dist/cli.mjs ./scripts/route-boot-classification-runtime.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isAuthenticatedAppShellPath,
  isPublicBusinessSlugPath,
  isPublicShellPath,
} from "../src/app/lib/publicRoutes";
import { isCustomerJourneyPath } from "../src/app/lib/appLoadingJourney";

let checks = 0;
function check(name: string, fn: () => void) {
  fn();
  checks++;
  console.log(`PASS: ${name}`);
}

check("app routes are never venue slugs", () => {
  for (const p of [
    "/subscription/success",
    "/subscription/canceled",
    "/account/recovery",
    "/account/recovery/verify",
    "/account/email-change/confirm",
    "/mobile-auth",
    "/awaiting-approval",
    "/dashboard",
    "/login",
  ]) {
    assert.equal(isPublicBusinessSlugPath(p), false, p);
  }
});

check("every static first segment in routes.tsx is reserved from venue slugs", () => {
  const routes = readFileSync("src/app/routes.tsx", "utf8");
  const heads = new Set<string>();
  for (const m of routes.matchAll(/path:\s*['"](\/[^'"]+)['"]/g)) {
    const head = m[1]!.split("/").filter(Boolean)[0];
    if (head && !head.startsWith(":")) heads.add(head);
  }
  const notReserved = [...heads].filter((h) => isPublicBusinessSlugPath(`/${h}`));
  assert.deepEqual(notReserved, [], `add to RESERVED_TOP_LEVEL_SEGMENTS: ${notReserved.join(", ")}`);
});

check("auth and recovery pages are not tip journeys", () => {
  for (const p of [
    "/reset-password/abc123",
    "/join/ABCD12",
    "/join/signup",
    "/account/recovery",
    "/account/email-change/confirm",
    "/login",
    "/forgot-password",
  ]) {
    assert.equal(isCustomerJourneyPath(p), false, p);
  }
});

check("real guest tip paths are still journeys", () => {
  for (const p of ["/brasserie-linden/anna", "/staff/anna", "/qr-landing/b1", "/table/t1", "/tip-amount", "/success"]) {
    assert.equal(isCustomerJourneyPath(p), true, p);
  }
});

check("public recovery pages stay public; protected returns are app pages", () => {
  for (const p of ["/account/recovery", "/account/email-change/confirm", "/mobile-auth", "/reset-password/x"]) {
    assert.equal(isPublicShellPath(p), true, p);
  }
  for (const p of ["/subscription/success", "/subscription/canceled", "/awaiting-approval"]) {
    assert.equal(isPublicShellPath(p), false, p);
    assert.equal(isAuthenticatedAppShellPath(p), true, p);
  }
});

console.log(`\nroute-boot-classification: ok (${checks} checks)`);
