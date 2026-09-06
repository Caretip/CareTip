/**
 * CareTip transactional email branding + layout regression.
 * Run from backend/: npm run test:email-branding
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildWelcomeEmailContent,
  buildVerifyEmailContent,
  buildPasswordResetContent,
  buildEmployeeActivationContent,
  buildLoginAlertContent,
  buildGenericNotificationContent,
  formatEmailGreeting,
} from "../src/emails/i18nEmail.js";
import { getCareTipSupportEmail } from "../src/config/emailEnv.js";
import { buildLeadNotificationContent } from "../src/services/leadNotification.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewDir = path.join(backendRoot, "..", "docs", "email-branding-previews");

const dashboardUrl = "https://caretip.de/dashboard";
const verifyUrl = "https://caretip.de/verify-email?token=sample-token";
const resetUrl = "https://caretip.de/reset-password/sample";
const activateUrl = "https://caretip.de/activate?token=sample";

const longName = "Alexandria-Maximiliane-Constantinopolis";
const longBiz = "Riverside Conservatory & Seasonal Tasting Room International";

function imgCount(html: string): number {
  return html.match(/<img\b/gi)?.length ?? 0;
}

function hasBrandHeader(html: string): boolean {
  const hosted =
    html.includes("https://caretip.de/brand/caretip-app-icon.png") &&
    !html.includes("localhost") &&
    !html.includes("127.0.0.1") &&
    !html.includes("caretip-email-mark.png");
  const wordmark = /color:#ffffff[^>]*>CareTip</.test(html);
  const darkBar = html.includes("background-color:#111111");
  return hosted && wordmark && darkBar && !html.includes("cid:caretip-logo");
}

const welcomeEn = buildWelcomeEmailContent({
  locale: "en",
  dashboardUrl,
  recipientName: "Sonwa",
  businessName: "Harbor Bistro",
  accountKind: "employee",
});
const welcomeMissing = buildWelcomeEmailContent({
  locale: "en",
  dashboardUrl,
  accountKind: "employee",
});
const welcomeLong = buildWelcomeEmailContent({
  locale: "en",
  dashboardUrl,
  recipientName: longName,
  businessName: longBiz,
  accountKind: "manager",
});
const welcomeDe = buildWelcomeEmailContent({
  locale: "de",
  dashboardUrl,
  recipientName: "Madu",
  accountKind: "employee",
});

if (welcomeEn.subject === "Welcome to CareTip" && welcomeEn.html.includes(dashboardUrl)) {
  pass("Welcome subject and dashboard CTA URL preserved");
} else fail("Welcome subject/CTA URL");

if (
  welcomeEn.html.includes("Hi Sonwa,") &&
  welcomeEn.html.includes("Your account is ready.") &&
  welcomeEn.html.includes("Receive tips via QR") &&
  welcomeEn.html.includes("Go to dashboard")
) {
  pass("Welcome employee copy and intent preserved");
} else fail("Welcome employee copy");

if (welcomeMissing.html.includes("Hello,") && !welcomeMissing.html.includes("Hi null")) {
  pass("Welcome falls back when name/business are missing");
} else fail("Welcome missing-name fallback");

if (
  welcomeLong.html.includes(longName.split(/\s+/)[0]) &&
  welcomeLong.html.includes("overflow-wrap:anywhere") &&
  welcomeLong.html.includes(dashboardUrl)
) {
  pass("Long dynamic names wrap and CTA URL stays intact");
} else fail("Long dynamic name handling");

if (hasBrandHeader(welcomeEn.html) && welcomeEn.html.includes("max-width:600px")) {
  pass("Shared layout: icon+wordmark header and 600px column");
} else fail("Shared layout header/width");

if (imgCount(welcomeEn.html) === 1 && welcomeEn.html.includes('alt="CareTip"')) {
  pass("Welcome email has a single CareTip header image");
} else fail("Welcome email image count / alt");

if (!welcomeEn.html.includes("cid:caretip-logo") && !welcomeEn.html.includes("localhost")) {
  pass("Welcome HTML uses hosted logo URL, not CID or localhost");
} else fail("Welcome HTML still references CID or localhost logo");

if (
  welcomeEn.html.includes("background-color:#111111") &&
  welcomeEn.html.includes("color:#ffffff") &&
  welcomeEn.html.includes("https://caretip.de/brand/caretip-app-icon.png")
) {
  pass("Dark header with white CareTip wordmark and live public PNG");
} else fail("Dark header / white wordmark / live PNG");

if (
  welcomeEn.html.includes("border:1px solid") &&
  !welcomeEn.html.includes("border-radius:12px") &&
  welcomeEn.html.includes("text-align:center")
) {
  pass("Single thin 1px frame, no nested card chrome");
} else fail("Thin frame / no nested cards");

if (
  welcomeEn.html.includes("color-scheme") &&
  welcomeEn.html.includes("padding:12px 22px") &&
  !welcomeEn.html.includes("ChatGPT") &&
  !welcomeEn.html.includes("openai")
) {
  pass("Light color-scheme, tappable CTA, no third-party branding");
} else fail("CTA/color-scheme/brand isolation");

const verify = buildVerifyEmailContent({
  locale: "en",
  verifyUrl,
  recipientName: "Max",
});
if (verify.html.includes(verifyUrl) && verify.html.includes("Verify email") && hasBrandHeader(verify.html)) {
  pass("Verify email CTA URL and layout");
} else fail("Verify email");

const reset = buildPasswordResetContent({
  locale: "en",
  resetUrl,
  recipientName: "Max",
});
if (reset.html.includes(resetUrl) && reset.subject === "Reset your password") {
  pass("Password reset CTA URL and subject");
} else fail("Password reset");

const invite = buildEmployeeActivationContent({
  locale: "en",
  businessName: longBiz,
  activationUrl: activateUrl,
  recipientName: "Madu",
});
if (
  invite.html.includes(activateUrl) &&
  invite.html.includes("Riverside Conservatory") &&
  invite.html.includes("&amp;") &&
  invite.subject.includes(longBiz)
) {
  pass("Invitation keeps activation URL and escapes business name in HTML");
} else fail("Invitation");

const alert = buildLoginAlertContent({
  locale: "en",
  recipientName: "Max",
  appBaseUrl: "https://caretip.de",
});
if (alert.html.includes("https://caretip.de/forgot-password") && hasBrandHeader(alert.html)) {
  pass("Login alert security CTA URL");
} else fail("Login alert");

const note = buildGenericNotificationContent({
  locale: "en",
  title: "New tip received",
  bodyText: "You received a €5.00 tip.",
  actionUrl: dashboardUrl,
  recipientName: "Madu",
});
if (note.html.includes(dashboardUrl) && note.html.includes("New tip received")) {
  pass("Notification email title and action URL");
} else fail("Notification email");

if (welcomeDe.html.includes("Zum Dashboard") && welcomeDe.html.includes("Hallo Madu,")) {
  pass("German welcome still localized");
} else fail("German welcome");

if (formatEmailGreeting("en", {}) === "Hello," && formatEmailGreeting("de", {}) === "Hallo,") {
  pass("Generic greeting fallbacks");
} else fail("Generic greetings");

if (getCareTipSupportEmail() === "support@caretip.de") {
  pass("Support email default is support@caretip.de");
} else fail("Support email default");

const lead = buildLeadNotificationContent({
  source: "caretip_contact",
  type: "demo",
  submittedAt: "2026-09-02T12:00:00.000Z",
  locale: "en",
  fields: {
    fullName: "Alex Example",
    workEmail: "alex@example.com",
    businessName: "Cafe",
    businessType: "cafe",
    teamSize: "12",
    message: "Hello",
  },
  metadata: {},
});
if (lead.html.includes("Demo Request") && lead.html.includes("alex@example.com") && hasBrandHeader(lead.html)) {
  pass("Lead demo email uses shared header and keeps fields");
} else fail("Lead demo email");

const sharedLayoutSamples = [
  ["verify", verify.html],
  ["reset", reset.html],
  ["invite", invite.html],
  ["login-alert", alert.html],
  ["notification", note.html],
  ["lead", lead.html],
] as const;
if (sharedLayoutSamples.every(([, html]) => imgCount(html) === 1 && hasBrandHeader(html))) {
  pass("All shared-layout templates have one hosted header mark outside the card");
} else fail("A shared-layout template is missing the single header mark");

const resendSrc = readFileSync(path.join(backendRoot, "src/services/resendClient.ts"), "utf8");
const logoSrc = readFileSync(path.join(backendRoot, "src/emails/emailLogo.ts"), "utf8");
if (resendSrc.includes("payload.replyTo ?? getCareTipSupportEmail()")) {
  pass("Transactional mail defaults Reply-To to CareTip support when unset");
} else {
  fail("Resend client missing support Reply-To default");
}
if (resendSrc.includes("needsLogo") && resendSrc.includes("CARETIP_EMAIL_LOGO_CID")) {
  pass("Logo MIME attach only when HTML still uses CID");
} else {
  fail("Resend client no longer gates logo attach on CID");
}
if (logoSrc.includes('content_disposition: "inline"') && logoSrc.includes("caretip-app-icon.png")) {
  pass("Email logo resolver prefers live public PNG and inline CID fallback");
} else {
  fail("Email logo resolver missing live public PNG or inline disposition");
}

mkdirSync(previewDir, { recursive: true });
const previews = [
  ["welcome-en-employee", welcomeEn],
  ["welcome-en-long-name", welcomeLong],
  ["welcome-de-employee", welcomeDe],
  ["verify-en", verify],
  ["password-reset-en", reset],
  ["employee-invite-en", invite],
  ["login-alert-en", alert],
  ["notification-en", note],
] as const;
for (const [name, sample] of previews) {
  writeFileSync(path.join(previewDir, `${name}.html`), sample.html, "utf8");
  writeFileSync(path.join(previewDir, `${name}.txt`), sample.text, "utf8");
}
pass(`Wrote ${previews.length} HTML previews to docs/email-branding-previews`);

const failed = results.filter((r) => r.startsWith("FAIL:")).length;
console.log(results.join("\n"));
if (failed) {
  console.error(`\n${failed} email-branding check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} email-branding checks passed`);
