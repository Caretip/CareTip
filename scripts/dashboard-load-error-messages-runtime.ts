/**
 * Every failure the dashboard's API chain can produce must map to copy that names the problem.
 * "Something went wrong" is reserved for failures nothing is known about.
 */
import assert from "node:assert/strict";
import i18n from "../src/i18n/i18n";
import { ApiRequestError } from "../src/app/lib/apiError";
import { GENERIC_UNKNOWN_ERROR, toUserFriendlyMessage } from "../src/app/lib/errorMessages";
import { classifyDashboardLoadFailure } from "../src/app/lib/dashboardLoadDiagnostics";

const CONNECTION = "Unable to connect to the server. Check your connection and try again.";
const RATE_LIMITED = "Too many requests. Please wait a moment and try again.";
const SERVER = "Our servers hit a problem. Please try again in a few minutes.";
const SIGN_IN = "Please sign in to continue.";

const api = (message: string, status: number, code?: string) =>
  new ApiRequestError(message, status, code);

const cases: Array<[string, unknown, string]> = [
  ["global limiter 429", api("Too many requests. Please slow down.", 429), RATE_LIMITED],
  ["other limiter 429", api("Too many payment attempts. Please try again later.", 429), RATE_LIMITED],
  ["expired access token", api("Access token expired", 401, "TOKEN_EXPIRED"), SIGN_IN],
  ["errorHandler 500", api("Something went wrong. Please try again later.", 500), SERVER],
  ["unmapped 503", api("<!DOCTYPE html><html><body>starting</body></html>", 503), "Service temporarily unavailable"],
  ["unlisted 5xx", api("<html>origin error</html>", 520), SERVER],
  ["WebKit Load failed", new TypeError("Load failed"), CONNECTION],
  ["WebKit connection lost", new TypeError("The network connection was lost."), CONNECTION],
  ["WebKit timed out", new TypeError("The request timed out."), CONNECTION],
  ["WebKit offline", new TypeError("The Internet connection appears to be offline."), CONNECTION],
  ["WebKit no connect", new TypeError("Could not connect to the server."), CONNECTION],
  ["WebKit cancelled", new TypeError("cancelled"), CONNECTION],
];

for (const [name, error, expected] of cases) {
  assert.equal(toUserFriendlyMessage(error), expected, name);
}

// Unknown failures stay generic: a code bug must not be reported as a network or server problem.
assert.equal(
  toUserFriendlyMessage(new TypeError("undefined is not an object (evaluating 'a.b')")),
  GENERIC_UNKNOWN_ERROR,
);
assert.equal(toUserFriendlyMessage(api("Unrecognised business rule", 400)), GENERIC_UNKNOWN_ERROR);

// Internals never reach the UI, whatever the status.
assert.ok(!toUserFriendlyMessage(api("PrismaClientKnownRequestError P2010", 500)).includes("Prisma"));

assert.equal(classifyDashboardLoadFailure(api("x", 429)), "rate_limited");
assert.equal(classifyDashboardLoadFailure(api("x", 401)), "session");
assert.equal(classifyDashboardLoadFailure(api("x", 500)), "server");
assert.equal(classifyDashboardLoadFailure(api("x", 503)), "connectivity");
assert.equal(classifyDashboardLoadFailure(new TypeError("Load failed")), "connectivity");
assert.equal(classifyDashboardLoadFailure(new Error("boom")), "unknown");

// apiRequest localizes, then callers map again: German copy must survive the second pass.
const lng = i18n as unknown as { language?: string; resolvedLanguage?: string };
lng.language = "de";
lng.resolvedLanguage = "de";
const localized = toUserFriendlyMessage(new TypeError("Load failed"));
assert.notEqual(localized, CONNECTION);
assert.equal(toUserFriendlyMessage(new Error(localized)), localized);
assert.equal(
  toUserFriendlyMessage(api("Too many requests. Please slow down.", 429)),
  "Zu viele Anfragen. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
);

console.log("dashboard-load-error-messages: ok");
