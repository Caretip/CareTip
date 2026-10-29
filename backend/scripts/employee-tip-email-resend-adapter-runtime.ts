/**
 * Employee tip email through the real Resend adapter, with fetch mocked.
 * No network, database, or real email.
 * Run: npm run test:employee-tip-email-resend-adapter
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { employeeTipEmailCopy } from "../src/services/notifications/employeeTipNotificationPrefs.ts";
import { sendLocalizedUserNotificationEmail } from "../src/services/localizedNotificationEmail.service.ts";
import { sendResendEmailWithOutcome } from "../src/services/resendClient.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Captured = { url: string; auth: string | null; body: Record<string, unknown> };
const calls: Captured[] = [];
let nextResponse: () => Promise<Response> = async () =>
  new Response(JSON.stringify({ id: "msg_test" }), { status: 200 });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  calls.push({
    url: String(input),
    auth: headers.get("authorization"),
    body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
  });
  return nextResponse();
}) as typeof fetch;

const savedEnv = {
  key: process.env.RESEND_API_KEY,
  from: process.env.RESEND_FROM,
  fromEmail: process.env.RESEND_FROM_EMAIL,
  nodeEnv: process.env.NODE_ENV,
};
process.env.RESEND_API_KEY = "re_test_not_a_real_key";
process.env.RESEND_FROM = "CareTip <noreply@mail.caretip.de>";
delete process.env.RESEND_FROM_EMAIL;
process.env.NODE_ENV = "test";

const quietError = console.error;
const quietInfo = console.info;
console.error = () => {};
console.info = () => {};

async function sendEmployeeTip(locale: "en" | "de") {
  const copy = employeeTipEmailCopy(locale);
  return sendLocalizedUserNotificationEmail({
    to: "Staff.Member@Example.test",
    preferredLocale: locale,
    title: copy.title,
    bodyText: copy.bodyText,
    actionUrl: "/employee/tip-history",
  });
}

try {
  const accepted = await sendEmployeeTip("en");
  assert.deepEqual(accepted, { accepted: true, messageId: "msg_test", outcome: "sent" });
  assert.equal(calls.length, 1, "real adapter posts once");
  const sent = calls[0]!;
  assert.equal(sent.url, "https://api.resend.com/emails");
  assert.equal(sent.auth, "Bearer re_test_not_a_real_key");
  assert.deepEqual(sent.body.to, ["staff.member@example.test"]);
  assert.equal(sent.body.from, "CareTip <noreply@mail.caretip.de>");
  assert.match(String(sent.body.subject), /tip/i);
  const rendered = `${sent.body.subject} ${sent.body.html} ${sent.body.text}`;
  assert.doesNotMatch(rendered, /€|pi_|cs_|stripe/i, "no amount or payment reference");

  calls.length = 0;
  await sendEmployeeTip("de");
  assert.match(String(calls[0]?.body.subject), /Trinkgeld/);

  const outcomes: Array<[number, string, string]> = [
    [422, JSON.stringify({ name: "validation_error" }), "permanent"],
    [403, JSON.stringify({ name: "invalid_from_address" }), "permanent"],
    [429, "{}", "retryable"],
    [503, "", "retryable"],
  ];
  for (const [status, body, kind] of outcomes) {
    nextResponse = async () => new Response(body, { status });
    const outcome = await sendResendEmailWithOutcome("notification", {
      from: "CareTip <noreply@mail.caretip.de>",
      to: ["staff@example.test"],
      subject: "s",
      html: "<p>h</p>",
    });
    assert.equal(outcome.kind, kind, `HTTP ${status} -> ${kind}`);
  }

  nextResponse = async () => {
    throw new TypeError("network down");
  };
  const network = await sendResendEmailWithOutcome("notification", {
    from: "CareTip <noreply@mail.caretip.de>",
    to: ["staff@example.test"],
    subject: "s",
    html: "<p>h</p>",
  });
  assert.equal(network.kind, "retryable");

  nextResponse = async () => new Response("", { status: 200 });
  const noBody = await sendResendEmailWithOutcome("notification", {
    from: "CareTip <noreply@mail.caretip.de>",
    to: ["staff@example.test"],
    subject: "s",
    html: "<p>h</p>",
  });
  assert.deepEqual(noBody, { kind: "sent" }, "accepted without an id body");

  nextResponse = async () => new Response(JSON.stringify({ name: "validation_error" }), { status: 422 });
  const rejected = await sendEmployeeTip("en");
  assert.deepEqual(rejected, { accepted: false, outcome: "permanent" }, "rejection is not reported as accepted");

  delete process.env.RESEND_API_KEY;
  calls.length = 0;
  const missing = await sendResendEmailWithOutcome("notification", {
    from: "CareTip <noreply@mail.caretip.de>",
    to: ["staff@example.test"],
    subject: "s",
    html: "<p>h</p>",
  });
  assert.equal(missing.kind, "not_configured");
  assert.equal(calls.length, 0, "no request without an API key");
} finally {
  globalThis.fetch = realFetch;
  console.error = quietError;
  console.info = quietInfo;
  for (const [name, value] of [
    ["RESEND_API_KEY", savedEnv.key],
    ["RESEND_FROM", savedEnv.from],
    ["RESEND_FROM_EMAIL", savedEnv.fromEmail],
    ["NODE_ENV", savedEnv.nodeEnv],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

const orchestrator = readFileSync(
  path.join(root, "src/services/notifications/notificationOrchestrator.service.ts"),
  "utf8",
);
const emailBranch = orchestrator.slice(orchestrator.indexOf('if (channels.includes("email"))'));
assert.match(emailBranch, /sendLocalizedUserNotificationEmail\(/);
assert.match(emailBranch, /\.catch\(\(err\) => \{\s*logServerError\("notifications\.deliverUserNotification\.email"/);
const emailLog = emailBranch.slice(emailBranch.indexOf('"[notifications] email"'), emailBranch.indexOf(".catch("));
assert.match(emailLog, /messageId: result\.messageId/);
assert.match(emailLog, /accepted: result\.accepted/);
assert.doesNotMatch(emailLog, /\bto\b|user\.email/, "acceptance log omits the recipient address");
const beforeEmail = orchestrator.slice(0, orchestrator.indexOf('if (channels.includes("email"))'));
assert.match(beforeEmail, /if \(!notification\) return \{ notification: null, skipped: true \}/);

console.log("employee-tip-email-resend-adapter-runtime: ok");
