/**
 * "Open in app" link in the employee tip email, asserted on the generated HTML.
 * Regression for Gmail showing `http:///employee/tip-history` (relative href).
 * Resend is mocked; no network, database, or real email.
 * Run: npm run test:employee-tip-email-deep-link
 */
import assert from "node:assert/strict";
import { buildTrustedAppUrl } from "../src/config/frontendUrl.ts";
import { employeeTipEmailCopy } from "../src/services/notifications/employeeTipNotificationPrefs.ts";
import { sendLocalizedUserNotificationEmail } from "../src/services/localizedNotificationEmail.service.ts";

type SentBody = { html: string; text: string };
const sent: SentBody[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  sent.push({ html: String(body.html ?? ""), text: String(body.text ?? "") });
  return new Response(JSON.stringify({ id: "msg_test" }), { status: 200 });
}) as typeof fetch;

const ENV_KEYS = ["NODE_ENV", "FRONTEND_URL", "RESEND_API_KEY", "RESEND_FROM", "RESEND_FROM_EMAIL"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const errors: string[] = [];
const realError = console.error;
const realInfo = console.info;
console.error = (...args: unknown[]) => {
  errors.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
};
console.info = () => {};

function setEnv(nodeEnv: string, frontendUrl: string | undefined) {
  process.env.NODE_ENV = nodeEnv;
  if (frontendUrl === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = frontendUrl;
  process.env.RESEND_API_KEY = "re_test_not_a_real_key";
  process.env.RESEND_FROM = "CareTip <noreply@mail.caretip.de>";
  delete process.env.RESEND_FROM_EMAIL;
}

async function renderTipEmail(locale: "en" | "de", actionUrl = "/employee/tip-history"): Promise<SentBody> {
  sent.length = 0;
  errors.length = 0;
  const copy = employeeTipEmailCopy(locale);
  const result = await sendLocalizedUserNotificationEmail({
    to: "staff@example.test",
    preferredLocale: locale,
    title: copy.title,
    bodyText: copy.bodyText,
    actionUrl,
  });
  assert.equal(result.accepted, true, "email is still delivered");
  assert.equal(sent.length, 1);
  return sent[0]!;
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
}

const CTA = { en: "Open in app", de: "In der App öffnen" } as const;

try {
  // Production, canonical domain (with trailing slash), EN + DE.
  for (const locale of ["en", "de"] as const) {
    setEnv("production", "https://caretip.de/");
    const email = await renderTipEmail(locale);
    assert.ok(email.html.includes(CTA[locale]), `${locale}: CTA label present`);
    const links = hrefs(email.html);
    assert.ok(links.includes("https://caretip.de/employee/tip-history"), `${locale}: absolute https CTA`);
    for (const link of links) {
      assert.ok(new URL(link).protocol === "https:" || link.startsWith("mailto:"), `${locale}: ${link} is absolute`);
    }
    assert.doesNotMatch(email.html, /href="\/|http:\/\/\/|localhost|caretip\.de\/\/employee/);
    assert.match(email.text, /https:\/\/caretip\.de\/employee\/tip-history/);
    if (locale === "de") {
      assert.match(email.html, /Hallo,<\/p>/);
      assert.match(email.html, />auf CareTip ist ein neues Trinkgeld für dich eingegangen\.<\/p>/);
      assert.match(email.html, />Öffne die App, um die Details zu sehen\.<\/p>/);
    }
  }

  // Production with comma-separated origins picks the public https one.
  setEnv("production", "http://localhost:5173, https://caretip.de");
  assert.ok(hrefs((await renderTipEmail("en")).html).includes("https://caretip.de/employee/tip-history"));

  // Development keeps the local frontend.
  setEnv("development", "http://localhost:5173/");
  assert.ok(hrefs((await renderTipEmail("en")).html).includes("http://localhost:5173/employee/tip-history"));
  setEnv("development", undefined);
  assert.ok(hrefs((await renderTipEmail("de")).html).includes("http://localhost:5173/employee/tip-history"));

  // Broken production config: email still sends, button omitted, actionable log, nothing malformed.
  const broken: Array<[string, string | undefined]> = [
    ["missing", undefined],
    ["empty", "   "],
    ["not a url", "not a url"],
    ["http", "http://caretip.de"],
    ["localhost", "https://localhost:5173"],
  ];
  for (const [label, value] of broken) {
    setEnv("production", value);
    const email = await renderTipEmail("en");
    assert.ok(!email.html.includes(CTA.en), `${label}: CTA omitted`);
    assert.doesNotMatch(email.html, /tip-history|http:\/\/\//, `${label}: no malformed link`);
    assert.doesNotMatch(email.text, /tip-history/, `${label}: no link in text part`);
    assert.ok(errors.some((e) => e.includes("FRONTEND_URL")), `${label}: actionable config error logged`);
    assert.ok(!errors.some((e) => e.includes("re_test_not_a_real_key") || e.includes("staff@example.test")), `${label}: no secrets or recipient in log`);
  }

  // Untrusted destinations are never linked.
  setEnv("production", "https://caretip.de");
  for (const target of ["https://evil.example/employee/tip-history", "//evil.example/x", "/\\evil.example", "javascript:alert(1)"]) {
    const email = await renderTipEmail("en", target);
    assert.ok(!email.html.includes(CTA.en), `${target}: CTA omitted`);
    assert.doesNotMatch(email.html, /evil|javascript:/);
  }
  assert.ok(hrefs((await renderTipEmail("en", "https://caretip.de/employee/tip-history")).html).includes("https://caretip.de/employee/tip-history"), "same-origin absolute URL allowed");

  // Helper contract.
  const prod = { NODE_ENV: "production", FRONTEND_URL: "https://caretip.de///" } as NodeJS.ProcessEnv;
  assert.equal(buildTrustedAppUrl("/employee/tip-history", prod), "https://caretip.de/employee/tip-history");
  assert.equal(buildTrustedAppUrl("/dashboard/settings", prod), "https://caretip.de/dashboard/settings");
  assert.throws(() => buildTrustedAppUrl("/employee/tip-history", { NODE_ENV: "production" } as NodeJS.ProcessEnv), /FRONTEND_URL is required/);
  assert.throws(() => buildTrustedAppUrl("", prod), /empty/);
  assert.throws(() => buildTrustedAppUrl("employee/tip-history", prod), /app path/);
} finally {
  globalThis.fetch = realFetch;
  console.error = realError;
  console.info = realInfo;
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

console.log("employee-tip-email-deep-link-runtime: ok");
