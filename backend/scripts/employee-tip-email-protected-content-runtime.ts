/**
 * PROTECTED CONTENT GUARD. The German employee tip notification is frozen copy.
 * Its subject, heading, greeting, body, CTA label, preheader, footer, punctuation and
 * hyphenation must render exactly as recorded here. Layout markup may change; words may not.
 *
 * If this fails, restore the German wording. Do not update the expected strings unless the
 * product owner has approved new German copy.
 *
 * No network, database or real email.
 * Run: npm run test:employee-tip-email-protected-content
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  employeeTipEmailCopy,
  employeeTipEmailRequest,
} from "../src/services/notifications/employeeTipNotificationPrefs.ts";
import { buildGenericNotificationContent } from "../src/emails/i18nEmail.ts";
import { sendLocalizedUserNotificationEmail } from "../src/services/localizedNotificationEmail.service.ts";
import { __setSendResendEmailOutcomeFnForTests } from "../src/services/resendClient.ts";
import { renderNotificationTemplate } from "../src/notifications/notificationI18n.ts";
import { resolveTipCustomerDisplayName } from "../src/notifications/tipCustomerName.ts";

process.env.FRONTEND_URL = "https://caretip.example";
process.env.NODE_ENV = "test";
process.env.CARETIP_SUPPORT_EMAIL = "support@caretip.example";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const YEAR = String(new Date().getFullYear());
const fill = (s: string) => s.split("{{YEAR}}").join(YEAR);

const SUBJECT = "Du hast ein neues Trinkgeld erhalten";
const BODY = "auf CareTip ist ein neues Trinkgeld für dich eingegangen.\n\nÖffne die App, um die Details zu sehen.";
const PREHEADER = "Neue Benachrichtigung von CareTip.";
const CTA = "In der App öffnen";
const FOOTER = "Wenn Sie diese E-Mail nicht angefordert haben, können Sie sie ignorieren.";

function expectedText(greeting: string, withCta: boolean): string {
  const cta = withCta ? `\n${CTA}: https://caretip.example/employee/tip-history\n` : "";
  return fill(
    `${greeting}\n\n${SUBJECT}\n\n${BODY}${cta}\nCareTip\n© {{YEAR}} CareTip\nsupport@caretip.example\n\n${FOOTER}`,
  );
}

function expectedVisible(greeting: string, withCta: boolean): string {
  const cta = withCta ? `[LINK:https://caretip.example/employee/tip-history]${CTA} ` : "";
  return fill(
    `[TITLE:${SUBJECT}] [PREHEADER:${PREHEADER}] [IMG:CareTip] CareTip ${SUBJECT} ${greeting} ` +
      `auf CareTip ist ein neues Trinkgeld für dich eingegangen. Öffne die App, um die Details zu sehen. ` +
      `${cta}CareTip [LINK:mailto:support@caretip.example]support@caretip.example © {{YEAR}} CareTip ${FOOTER}`,
  );
}

/** Every customer-visible word in the HTML, in order, with layout markup removed. */
function visibleText(html: string): string {
  return html
    .replace(/<div style="display:none[^>]*>[\s\S]*?<\/div>/i, (m) => `[PREHEADER:${m.replace(/<[^>]+>/g, "")}]`)
    .replace(/<title>([\s\S]*?)<\/title>/i, "[TITLE:$1]")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, "[IMG:$1]")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>/gi, "[LINK:$1]")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

let checks = 0;

// 1. Source copy (email body and browser push).
assert.deepEqual(employeeTipEmailCopy("de"), { title: SUBJECT, bodyText: BODY });
checks += 1;

// 2. The request the orchestrator sends for a German tip email.
assert.deepEqual(employeeTipEmailRequest("de"), {
  title: SUBJECT,
  bodyText: BODY,
  preheader: PREHEADER,
  actionLabel: CTA,
  footerNote: FOOTER,
});
checks += 1;

// 3. End to end through the notification email service (Resend seam captures the payload).
const captured: { subject: string; html: string; text: string }[] = [];
__setSendResendEmailOutcomeFnForTests(async (_tag, payload) => {
  captured.push({ subject: payload.subject, html: payload.html, text: payload.text ?? "" });
  return { kind: "sent", messageId: "protected" };
});
const quiet = console.info;
console.info = () => {};
for (const withCta of [true, false]) {
  captured.length = 0;
  await sendLocalizedUserNotificationEmail({
    to: "staff@example.test",
    preferredLocale: "de",
    ...employeeTipEmailRequest("de"),
    actionUrl: withCta ? "/employee/tip-history" : null,
  });
  const c = captured[0];
  assert.equal(c.subject, SUBJECT);
  assert.equal(c.text, expectedText("Hallo,", withCta));
  assert.equal(visibleText(c.html), expectedVisible("Hallo,", withCta));
  checks += 3;
}
console.info = quiet;
__setSendResendEmailOutcomeFnForTests(null);

// 4. Personalised greetings.
for (const [greeting, personal] of [
  ["Hallo Anna,", { recipientName: "Anna Müller", businessName: "Café Sonne" }],
  ["Hallo Café Sonne,", { recipientName: null, businessName: "Café Sonne" }],
] as const) {
  const r = buildGenericNotificationContent({
    locale: "de",
    ...employeeTipEmailRequest("de"),
    actionUrl: "https://caretip.example/employee/tip-history",
    ...personal,
  });
  assert.equal(r.subject, SUBJECT);
  assert.equal(r.text, expectedText(greeting, true));
  assert.equal(visibleText(r.html), expectedVisible(greeting, true));
  checks += 3;
}

// 5. In-app tip notification (backend render and web locale).
assert.deepEqual(
  renderNotificationTemplate("de", { id: "tip_received_employee", params: { amount: 12.5, customerName: "Max" } }),
  // Intl puts a no-break space (U+00A0) between amount and currency.
  { title: "Sie haben ein neues Trinkgeld erhalten", body: "Max hat Ihnen 12,50 € Trinkgeld gegeben" },
);
assert.deepEqual(
  renderNotificationTemplate("de", { id: "tip_received_employee", params: { amount: 3, customerName: null } }),
  { title: "Sie haben ein neues Trinkgeld erhalten", body: "Anonym hat Ihnen 3,00 € Trinkgeld gegeben" },
);
assert.equal(resolveTipCustomerDisplayName(null, "de"), "Anonym");
const de = JSON.parse(readFileSync(path.join(root, "src/i18n/locales/de.json"), "utf8"));
assert.deepEqual(de.notifications.templates.tip_received_employee, {
  title: "Sie haben ein neues Trinkgeld erhalten",
  body: "{{customerName}} hat Ihnen {{amount}} Trinkgeld gegeben",
});
assert.equal(de.employee.dashboard.anonymous, "Anonym");
checks += 5;

console.log(`employee-tip-email-protected-content-runtime: ok (${checks} exact checks)`);
