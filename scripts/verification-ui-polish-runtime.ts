import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const qrPanel = read("src/app/components/business/QrStudioAccessPanel.tsx");
assert(!qrPanel.includes("verificationInReviewLimitedAccess"), "in-review QR notice should not render long limited-access copy");
assert(qrPanel.includes('role="status"'), "in-review notice is status region");
assert(qrPanel.includes("verificationInReviewBody"), "uses i18n body key");

const en = read("src/i18n/locales/en.json");
assert(
  en.includes("Your business verification is under review. We'll notify you when it's complete."),
  "EN copy",
);
const de = read("src/i18n/locales/de.json");
assert(
  de.includes("Ihre Unternehmensverifizierung wird geprüft. Wir benachrichtigen Sie, sobald die Prüfung abgeschlossen ist."),
  "DE copy",
);

const adminPage = read("src/app/pages/platform/BusinessVerificationPage.tsx");
assert(adminPage.includes("overflow-x-auto"), "admin table scroll container");
assert(adminPage.includes("table-fixed"), "admin table fixed layout");
assert(adminPage.includes("min-w-[56rem]"), "admin table min width");

console.log("verification-ui-polish-runtime: ok");
