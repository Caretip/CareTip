/**
 * Notification email delivery and copy checks. No network, database or real email:
 * Resend is reached only through the test seams or a mocked fetch.
 * Run: npm run test:notification-email-reliability
 */
import assert from "node:assert/strict";
import {
  __setSendResendEmailOutcomeFnForTests,
  sendResendEmailWithOutcome,
  type ResendMailPayload,
  type ResendSendOutcome,
} from "../src/services/resendClient.ts";
import {
  __setNotificationEmailRetryDelayForTests,
  sendLocalizedUserNotificationEmail,
} from "../src/services/localizedNotificationEmail.service.ts";
import {
  buildGenericNotificationContent,
  notificationPreheaderFromBody,
} from "../src/emails/i18nEmail.ts";
import { buildAccountSecurityEmail } from "../src/emails/accountSecurityEmail.ts";
import { renderNotificationTemplate, type NotificationTemplate } from "../src/notifications/notificationI18n.ts";
import { TRIAL_REMINDER_BILLING_PATH } from "../src/services/trialReminderEmail.service.ts";

process.env.FRONTEND_URL = "https://caretip.example";
process.env.NODE_ENV = "test";

const quietInfo = console.info;
const quietWarn = console.warn;
const quietError = console.error;
console.info = () => {};
console.warn = () => {};
console.error = () => {};

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    console.error = quietError;
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

__setNotificationEmailRetryDelayForTests(() => 0);

function scripted(outcomes: ResendSendOutcome[]) {
  const calls: ResendMailPayload[] = [];
  __setSendResendEmailOutcomeFnForTests(async (_tag, payload) => {
    calls.push(payload);
    return outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
  });
  return calls;
}

const baseRequest = {
  to: "manager@example.test",
  preferredLocale: "en",
  title: "Your CareTip subscription payment failed",
  bodyText: "We could not process the payment. Please update your payment method.",
  actionUrl: "/dashboard/billing/subscription",
};

// --- Retry and idempotency ---

await check("retryable failure is retried with the same idempotency key", async () => {
  const calls = scripted([{ kind: "retryable", httpStatus: 503 }, { kind: "sent", messageId: "m1" }]);
  const result = await sendLocalizedUserNotificationEmail({ ...baseRequest, idempotencyKey: "notification-email:n1" });
  assert.equal(result.accepted, true);
  assert.equal(result.messageId, "m1");
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.idempotencyKey),
    ["notification-email:n1", "notification-email:n1"],
  );
});

await check("retries stop after three attempts", async () => {
  const calls = scripted([{ kind: "retryable", httpStatus: 429 }]);
  const result = await sendLocalizedUserNotificationEmail({ ...baseRequest, idempotencyKey: "k-3" });
  assert.equal(result.accepted, false);
  assert.equal(result.outcome, "retryable");
  assert.equal(calls.length, 3);
});

await check("permanent failure is not retried", async () => {
  const calls = scripted([{ kind: "permanent", httpStatus: 422 }]);
  const result = await sendLocalizedUserNotificationEmail({ ...baseRequest, idempotencyKey: "k-perm" });
  assert.equal(result.outcome, "permanent");
  assert.equal(calls.length, 1);
});

await check("without an idempotency key the email is sent once (no duplicate risk)", async () => {
  const calls = scripted([{ kind: "retryable", httpStatus: 503 }]);
  const result = await sendLocalizedUserNotificationEmail({ ...baseRequest });
  assert.equal(result.accepted, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idempotencyKey, undefined);
});

await check("not_configured is reported, not retried", async () => {
  const calls = scripted([{ kind: "not_configured" }]);
  const result = await sendLocalizedUserNotificationEmail({ ...baseRequest, idempotencyKey: "k-nc" });
  assert.equal(result.outcome, "not_configured");
  assert.equal(calls.length, 1);
});

__setSendResendEmailOutcomeFnForTests(null);

await check("Resend adapter sends the Idempotency-Key header", async () => {
  const realFetch = globalThis.fetch;
  const saved = { key: process.env.RESEND_API_KEY, mocked: process.env.CARETIP_RESEND_FETCH_IS_MOCKED };
  const seen: (string | null)[] = [];
  process.env.RESEND_API_KEY = "re_test_not_a_real_key";
  process.env.CARETIP_RESEND_FETCH_IS_MOCKED = "1";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get("idempotency-key"));
    return new Response(JSON.stringify({ id: "msg_mock" }), { status: 200 });
  }) as typeof fetch;
  try {
    const base = { from: "CareTip <noreply@mail.caretip.example>", to: ["a@example.test"], subject: "s", html: "<p>h</p>" };
    await sendResendEmailWithOutcome("t", { ...base, idempotencyKey: "trial-reminder:sub_1:3" });
    await sendResendEmailWithOutcome("t", base);
    assert.deepEqual(seen, ["trial-reminder:sub_1:3", null]);
  } finally {
    globalThis.fetch = realFetch;
    process.env.RESEND_API_KEY = saved.key;
    if (saved.mocked === undefined) delete process.env.CARETIP_RESEND_FETCH_IS_MOCKED;
    else process.env.CARETIP_RESEND_FETCH_IS_MOCKED = saved.mocked;
  }
});

// --- Generic notification email content ---

await check("preheader is the first sentence of the body", () => {
  assert.equal(
    notificationPreheaderFromBody("Your QR order has shipped. Tracking number: X1."),
    "Your QR order has shipped.",
  );
  const long = notificationPreheaderFromBody("word ".repeat(60));
  assert.ok(long.length <= 121 && long.endsWith("…"));
  const r = buildGenericNotificationContent({ locale: "en", title: "T", bodyText: "First line here. Second." });
  assert.match(r.html, /display:none[^>]*>First line here\.<\/div>/);
});

await check("notification footer no longer says the reader requested the email", () => {
  for (const locale of ["en", "de"] as const) {
    const r = buildGenericNotificationContent({ locale, title: "T", bodyText: "Body." });
    assert.doesNotMatch(r.html + r.text, /did not request|nicht angefordert/);
  }
  const en = buildGenericNotificationContent({ locale: "en", title: "T", bodyText: "Body." });
  assert.match(en.text, /You are receiving this email because of activity on your CareTip account\.$/);
  const de = buildGenericNotificationContent({ locale: "de", title: "T", bodyText: "Body." });
  assert.match(de.text, /Sie erhalten diese E-Mail aufgrund von Aktivitäten in Ihrem CareTip-Konto\.$/);
});

await check("explicit preheader and footer are honoured verbatim", () => {
  const r = buildGenericNotificationContent({
    locale: "de",
    title: "T",
    bodyText: "B.",
    preheader: "Vorschau.",
    footerNote: "Fußzeile.",
  });
  assert.match(r.html, />Vorschau\.<\/div>/);
  assert.ok(r.text.endsWith("Fußzeile."));
});

await check("layout is mobile aware and Outlook safe", () => {
  const r = buildGenericNotificationContent({
    locale: "en",
    title: "T",
    bodyText: "B.",
    actionUrl: "https://caretip.example/x",
  });
  assert.match(r.html, /@media only screen and \(max-width:600px\)/);
  assert.match(r.html, /class="ct-body"/);
  assert.match(r.html, /class="ct-h1"/);
  assert.match(r.html, /mso-padding-alt:12px 22px/);
  assert.match(r.html, /bgcolor="#eb992c"/);
});

await check("account security emails carry the standard footer and support contact", () => {
  for (const locale of ["en", "de"] as const) {
    const r = buildAccountSecurityEmail({ kind: "email_changed", locale });
    assert.match(r.html, /mailto:/);
    assert.match(r.text, /© \d{4} CareTip/);
    assert.match(r.text, locale === "de" ? /Sicherheitshinweis/ : /security notice/);
  }
});

await check("trial reminder links to the subscription billing page", () => {
  assert.equal(TRIAL_REMINDER_BILLING_PATH, "/dashboard/billing/subscription");
});

// --- In-app / push copy ---

await check("support status uses readable labels, never the raw enum", () => {
  const en = renderNotificationTemplate("en", { id: "support_status_updated", params: { status: "PENDING" } });
  const de = renderNotificationTemplate("de", { id: "support_status_updated", params: { status: "OPEN" } });
  assert.equal(en.body, "Your ticket status is now: Pending.");
  assert.equal(de.body, "Der Status Ihres Tickets ist jetzt: Offen.");
});

await check("inactivity warning has a distinct title and a full sentence body", () => {
  for (const locale of ["en", "de"] as const) {
    const r = renderNotificationTemplate(locale, { id: "employee_inactivity_warning" });
    assert.notEqual(r.title, r.body);
    assert.match(r.body, /\.$/);
  }
});

await check("QR order updates name the order in the title", () => {
  const ids: NotificationTemplate[] = [
    { id: "physical_qr_printing" },
    { id: "physical_qr_shipped", params: { trackingNumber: null } },
    { id: "physical_qr_delivered" },
  ];
  for (const t of ids) {
    assert.match(renderNotificationTemplate("en", t).title, /QR order/);
    assert.match(renderNotificationTemplate("de", t).title, /QR-Bestellung/);
  }
});

const permitted: NotificationTemplate[] = [
  { id: "tip_received_business", params: { amount: 5, employeeName: "Lea" } },
  { id: "payout_completed", params: { amount: 5 } },
  { id: "login_security" },
  { id: "employee_invited_manager", params: { employeeName: "Lea", businessName: "Café" } },
  { id: "employee_activated", params: { businessName: "Café" } },
  { id: "qr_scan", params: { place: "Tisch 4" } },
  { id: "qr_payment_success", params: { amount: 5, employeeName: "Lea" } },
  { id: "business_verification_approved", params: { businessName: "Café" } },
  { id: "business_verification_rejected", params: { businessName: "Café" } },
  { id: "support_created_business", params: { ticketNumber: "T-1", subject: "Hilfe" } },
  { id: "support_status_resolved" },
  { id: "support_status_closed" },
  { id: "physical_qr_paid" },
  { id: "physical_qr_order_received" },
  { id: "physical_qr_printing" },
  { id: "physical_qr_shipped", params: { trackingNumber: "TR1" } },
  { id: "physical_qr_delivered" },
  { id: "employee_inactivity_warning" },
  { id: "employee_inactivity_admin", params: { employeeName: "Lea" } },
];

await check("German compounds keep their required hyphens", () => {
  const text = permitted.map((t) => Object.values(renderNotificationTemplate("de", t)).join(" ")).join(" ");
  for (const broken of [
    "QR Code",
    "QR Zahlung",
    "QR Bestellung",
    "Trinkgeld Seite",
    "Support Anfrage",
    "Support Ticket",
    "CareTip Konto",
  ]) {
    assert.ok(!text.includes(broken), `broken German compound: ${broken}`);
  }
});

await check("no em or en dashes in permitted notification copy", () => {
  for (const locale of ["en", "de"] as const) {
    for (const t of permitted) {
      const r = renderNotificationTemplate(locale, t);
      assert.doesNotMatch(`${r.title} ${r.body}`, /[—–]/, `${locale} ${t.id}`);
    }
  }
});

await check("German support quote uses matching typographic quotes", () => {
  const r = renderNotificationTemplate("de", {
    id: "support_created_business",
    params: { ticketNumber: "T-1", subject: "Rechnung" },
  });
  assert.ok(r.body.includes("„Rechnung“"));
});

console.info = quietInfo;
console.warn = quietWarn;
console.error = quietError;
console.log(`notification-email-reliability-runtime: ok (${passed} checks)`);
