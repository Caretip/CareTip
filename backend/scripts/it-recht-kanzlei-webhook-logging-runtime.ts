/**
 * IT-Recht Kanzlei webhook production logging tests.
 * Run: npm run test:it-recht-kanzlei-webhook-logging (backend)
 */
import {
  assertLogPayloadIsSafe,
  formatItRechtAuthenticatedUser,
  logItRechtAuthFailure,
  logItRechtAuthSuccess,
  logItRechtPushCompleted,
  logItRechtXmlError,
  logItRechtXmlIncoming,
  LOG_PREFIX,
  maskItRechtAuthToken,
  resolveItRechtAuthFailureReason,
} from "../src/utils/legalWebhookLogging.js";
import type { Request } from "express";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

type CapturedLog = { level: "info" | "warn" | "error"; args: unknown[] };

function captureLogs(run: () => void): CapturedLog[] {
  const captured: CapturedLog[] = [];
  const original = {
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  console.info = (...args: unknown[]) => captured.push({ level: "info", args });
  console.warn = (...args: unknown[]) => captured.push({ level: "warn", args });
  console.error = (...args: unknown[]) => captured.push({ level: "error", args });

  try {
    run();
  } finally {
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }

  return captured;
}

function findLog(captured: CapturedLog[], message: string): CapturedLog | undefined {
  return captured.find((entry) => typeof entry.args[0] === "string" && entry.args[0].includes(message));
}

function mockRequest(overrides: Partial<Request> = {}): Request {
  const headers: Record<string, string> = {
    "x-request-id": "req-test-123",
  };
  return {
    method: "POST",
    originalUrl: "/api/legal/webhook",
    path: "/webhook",
    ip: "203.0.113.10",
    get(name: string) {
      return headers[name.toLowerCase()] ?? overrides.headers?.[name.toLowerCase()];
    },
    ...overrides,
  } as Request;
}

function main(): void {
  if (maskItRechtAuthToken("ME2ssmzzWxOa2HoNgpfeLM14KvJAIKKo") === "****IKKo") {
    pass("maskItRechtAuthToken masks all but last four characters");
  } else {
    fail("maskItRechtAuthToken masks all but last four characters");
  }

  const userLabel = formatItRechtAuthenticatedUser({
    userAuthToken: "secret-token-value",
  });
  if (userLabel === "token:****alue") pass("formatItRechtAuthenticatedUser masks token");
  else fail("formatItRechtAuthenticatedUser masks token");

  if (resolveItRechtAuthFailureReason(undefined) === "Missing user_auth_token") {
    pass("resolveItRechtAuthFailureReason detects missing token");
  } else {
    fail("resolveItRechtAuthFailureReason detects missing token");
  }

  if (resolveItRechtAuthFailureReason({ userAuthToken: "wrong" }) === "Invalid token") {
    pass("resolveItRechtAuthFailureReason detects invalid token");
  } else {
    fail("resolveItRechtAuthFailureReason detects invalid token");
  }

  const incomingLogs = captureLogs(() => {
    logItRechtXmlIncoming(mockRequest(), {
      requestId: "req-test-123",
      parsed: {
        apiVersion: "1.0",
        action: "push",
        userAuthToken: "super-secret-token",
        userAccountId: "0",
        rechtstextType: "datenschutz",
        rechtstextLanguage: "de",
        rechtstextCountry: "DE",
        rechtstextHtml: "<p>secret html</p>",
        rechtstextText: "secret text",
        rechtstextPdf: "JVBERi0xLjA=",
      },
      action: "push",
    });
  });

  const incoming = findLog(incomingLogs, "Incoming XML request");
  if (incoming) {
    pass("incoming XML request generates log");
    try {
      assertLogPayloadIsSafe(incoming.args[1]);
      pass("incoming log payload is safe (no secrets/content)");
    } catch (err) {
      fail(`incoming log payload is safe: ${err instanceof Error ? err.message : "unknown"}`);
    }
    const payload = incoming.args[1] as Record<string, string>;
    if (payload.authenticatedUser?.includes("****") && !JSON.stringify(incoming.args).includes("super-secret-token")) {
      pass("incoming log never includes full auth token");
    } else {
      fail("incoming log never includes full auth token");
    }
  } else {
    fail("incoming XML request generates log");
  }

  const authSuccessLogs = captureLogs(() => {
    logItRechtAuthSuccess("getversion", "req-test-123");
  });
  if (findLog(authSuccessLogs, "Authentication successful")) pass("auth success generates log");
  else fail("auth success generates log");

  const authFailureLogs = captureLogs(() => {
    logItRechtAuthFailure("Invalid token", "req-test-123", "getversion");
  });
  const authFail = findLog(authFailureLogs, "Authentication failed");
  if (authFail) {
    pass("auth failure generates log");
    const payload = authFail.args[1] as Record<string, string>;
    if (payload.reason === "Invalid token" && payload.requestId === "req-test-123") {
      pass("auth failure log includes reason and requestId");
    } else {
      fail("auth failure log includes reason and requestId");
    }
  } else {
    fail("auth failure generates log");
  }

  const missingTokenLogs = captureLogs(() => {
    logItRechtAuthFailure("Missing user_auth_token", "req-test-456", "push");
  });
  const missingToken = findLog(missingTokenLogs, "Authentication failed");
  if (missingToken && (missingToken.args[1] as Record<string, string>).reason === "Missing user_auth_token") {
    pass("missing token auth failure log");
  } else {
    fail("missing token auth failure log");
  }

  const pushLogs = captureLogs(() => {
    logItRechtPushCompleted(
      {
        created: false,
        rechtstextType: "datenschutz",
        language: "de",
        country: "DE",
        accountId: "0",
        targetUrl: "https://caretip.de/privacy",
      },
      48,
      "req-test-123",
    );
  });
  const pushLog = findLog(pushLogs, "Push completed");
  if (pushLog) {
    pass("push processing generates log");
    const payload = pushLog.args[1] as Record<string, unknown>;
    if (
      payload.type === "datenschutz" &&
      payload.language === "de" &&
      payload.country === "DE" &&
      payload.updated === true &&
      payload.durationMs === 48
    ) {
      pass("push log includes type, language, country, updated, duration");
    } else {
      fail("push log includes type, language, country, updated, duration");
    }
  } else {
    fail("push processing generates log");
  }

  const parseErrorLogs = captureLogs(() => {
    logItRechtXmlError(12, "req-test-123", { action: "push", err: new Error("Invalid XML format") });
  });
  if (findLog(parseErrorLogs, "Malformed XML")) pass("XML parsing error generates log");
  else fail("XML parsing error generates log");

  const authErrorLogs = captureLogs(() => {
    logItRechtXmlError(3, "req-test-123", { action: "getversion" });
  });
  if (findLog(authErrorLogs, "Authentication failed")) pass("authentication error code 3 generates log");
  else fail("authentication error code 3 generates log");

  const actionErrorLogs = captureLogs(() => {
    logItRechtXmlError(10, "req-test-123", { action: "invalid" });
  });
  if (findLog(actionErrorLogs, "Invalid action")) pass("invalid action error code 10 generates log");
  else fail("invalid action error code 10 generates log");

  if (LOG_PREFIX === "[legal.webhook]") pass("log prefix unchanged");
  else fail("log prefix unchanged");
}

main();

const failures = results.filter((line) => line.startsWith("FAIL:"));
for (const line of results) console.log(line);
console.log(`\n${results.length - failures.length}/${results.length} logging checks passed`);
if (failures.length > 0) process.exit(1);
