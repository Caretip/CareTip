/**
 * Contact Demo/Support frontend delivery UX regression.
 * Run: npm run test:contact-lead-frontend
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(path.join(repoRoot, rel));
}

for (const rel of [
  "src/components/contact/ContactDemoForm.tsx",
  "src/components/contact/ContactSupportForm.tsx",
  "src/app/lib/leadApi.ts",
  "src/app/lib/caretipContactEmails.ts",
]) {
  if (exists(rel)) pass(`present ${rel}`);
  else fail(`missing ${rel}`);
}

const demo = read("src/components/contact/ContactDemoForm.tsx");
const support = read("src/components/contact/ContactSupportForm.tsx");
const leadApi = read("src/app/lib/leadApi.ts");
const emails = read("src/app/lib/caretipContactEmails.ts");
const en = read("src/i18n/locales/en.json");
const de = read("src/i18n/locales/de.json");

if (demo.includes('submitDemoLead') && demo.includes('"/api/leads/demo"') === false) {
  // path is in leadApi
  pass("demo form uses submitDemoLead helper");
} else if (demo.includes("submitDemoLead")) {
  pass("demo form uses submitDemoLead helper");
} else fail("demo form missing submitDemoLead");

if (support.includes("submitSupportLead")) pass("support form uses submitSupportLead helper");
else fail("support form missing submitSupportLead");

if (leadApi.includes('"/api/leads/demo"') && leadApi.includes('"/api/leads/support"')) {
  pass("leadApi posts to /api/leads/demo and /api/leads/support");
} else fail("leadApi endpoints incorrect");

if (leadApi.includes("info@caretip.de") && leadApi.includes("support@caretip.de")) {
  pass("leadApi failure copy names correct inboxes");
} else fail("leadApi failure inbox copy missing");

if (!demo.includes("openCaretipMailto") && !support.includes("openCaretipMailto")) {
  pass("forms do not auto-open mailto on failure");
} else fail("forms still auto-open mailto (confusing UX)");

if (demo.includes("fallbackMailto") && support.includes("fallbackMailto")) {
  pass("forms expose explicit mailto fallback link state");
} else fail("explicit mailto fallback link missing");

if (demo.includes('setStatus("success")') && demo.includes("if (result.ok)")) {
  pass("demo success state only after result.ok");
} else fail("demo success gating incorrect");

if (support.includes('setStatus("success")') && support.includes("if (result.ok)")) {
  pass("support success state only after result.ok");
} else fail("support success gating incorrect");

if (demo.includes('setStatus("error")') && support.includes('setStatus("error")')) {
  pass("forms set error status on failure");
} else fail("forms missing error status on failure");

if (
  demo.includes("staticPages.contact.form.notDelivered") &&
  support.includes("staticPages.contact.form.notDelivered")
) {
  pass("forms use not-delivered copy on failure");
} else fail("not-delivered copy missing in forms");

if (en.includes('"notDelivered"') && de.includes('"notDelivered"') && en.includes('"emailFallbackLink"')) {
  pass("en/de i18n include notDelivered + emailFallbackLink");
} else fail("i18n notDelivered/emailFallbackLink missing");

if (
  emails.includes('CARETIP_INFO_EMAIL = "info@caretip.de"') &&
  emails.includes('CARETIP_SUPPORT_EMAIL = "support@caretip.de"')
) {
  pass("public contact constants point at info@ and support@");
} else fail("caretipContactEmails constants incorrect");

if (!leadApi.includes("RESEND_API_KEY") && !demo.includes("RESEND_API_KEY") && !support.includes("RESEND_API_KEY")) {
  pass("Resend API key never referenced in frontend contact path");
} else fail("frontend must not reference RESEND_API_KEY");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL:")).length;
console.log(`\nSummary: ${results.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
