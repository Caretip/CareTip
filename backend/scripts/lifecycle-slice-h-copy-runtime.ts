/**
 * GDPR lifecycle Slice H — UI/copy/FAQ alignment contracts (F-04, F-12).
 * Run: npm run test:lifecycle-slice-h (from backend/)
 *
 * Static checks only — no production data, no destructive flags.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function mustNotContain(label: string, haystack: string, needles: string[]) {
  const hits = needles.filter((n) => haystack.toLowerCase().includes(n.toLowerCase()));
  if (hits.length === 0) pass(label);
  else fail(`${label} — forbidden phrases still present: ${hits.join("; ")}`);
}

function mustContain(label: string, haystack: string, needles: string[]) {
  const missing = needles.filter((n) => !haystack.toLowerCase().includes(n.toLowerCase()));
  if (missing.length === 0) pass(label);
  else fail(`${label} — missing expected phrases: ${missing.join("; ")}`);
}

function main() {
  const en = JSON.parse(read("src/i18n/locales/en.json")) as {
    staticPages: { faq: { items: Array<{ q: string; a: string }> } };
    employee: { settings: Record<string, string> };
    business: { staffPage: Record<string, string> };
  };
  const de = JSON.parse(read("src/i18n/locales/de.json")) as {
    staticPages: { faq: { items: Array<{ q: string; a: string }> } };
    employee: { settings: Record<string, string> };
    business: { staffPage: Record<string, string> };
  };

  // T-F04-a: manager remove copy ≠ right to erasure / tip destroy
  const staffBodyEn = en.business.staffPage.deleteConfirmBody ?? "";
  const staffBodyDe = de.business.staffPage.deleteConfirmBody ?? "";
  mustNotContain("EN staff remove ≠ Art. 17 overclaim", staffBodyEn, [
    "right to erasure",
    "tip history associations",
  ]);
  mustContain("EN staff remove clarifies membership vs erasure", staffBodyEn, [
    "removes",
    "not the same as a full account erasure",
  ]);
  mustContain("EN staff remove says tips kept", staffBodyEn, ["Historical tip", "kept"]);
  mustNotContain("DE staff remove ≠ Recht auf Löschung", staffBodyDe, ["Recht auf Löschung"]);
  mustContain("DE staff remove clarifies not full erasure", staffBodyDe, [
    "nicht dasselbe wie eine vollständige",
  ]);

  // Employee self-delete: no "associated data" wipe claim
  const selfEn = en.employee.settings.deleteConfirmDesc ?? "";
  const selfDe = de.employee.settings.deleteConfirmDesc ?? "";
  mustNotContain("EN self-delete avoids associated-data wipe", selfEn, [
    "associated data",
    "permanently removes your Caretip staff account and associated data",
  ]);
  mustContain("EN self-delete mentions retention / export-first", selfEn, [
    "Download your data first",
    "retained",
  ]);
  mustContain("DE self-delete mentions export-first", selfDe, [
    "Laden Sie Ihre Daten vorher",
  ]);

  // FAQ GDPR overclaim (T-F12-a checklist item)
  const faqGdprEn =
    en.staticPages.faq.items.find((i) => /gdpr/i.test(i.q))?.a ?? "";
  const faqGdprDe =
    de.staticPages.faq.items.find((i) => /dsgvo|gdpr/i.test(i.q))?.a ?? "";
  mustNotContain("EN FAQ ≠ full control at all times", faqGdprEn, [
    "full control over their data at all times",
  ]);
  mustContain("EN FAQ mentions limited retention", faqGdprEn, ["retained", "Privacy Policy"]);
  mustNotContain("DE FAQ ≠ jederzeit volle Kontrolle", faqGdprDe, [
    "jederzeit volle Kontrolle",
  ]);

  // Landing AI knowledge
  const landing = read("backend/src/services/landingAiKnowledge.ts");
  mustNotContain("Landing AI ≠ clear retention policies overclaim", landing, [
    "clear retention policies",
  ]);
  mustContain("Landing AI acknowledges limited financial retention", landing, [
    "retained in limited form",
  ]);

  // Mobile copy
  const mobileEn = read("mobile/i18n/locales/en.ts");
  const mobileDe = read("mobile/i18n/locales/de.ts");
  mustNotContain("Mobile EN ≠ permanently delete employee account (hint)", mobileEn, [
    "permanently delete your employee account",
  ]);
  mustContain("Mobile EN delete body mentions retention", mobileEn, ["retained in limited form"]);
  mustNotContain("Mobile DE ≠ dauerhaft Mitarbeiterkonto (hint)", mobileDe, [
    "löschen Sie Ihr Mitarbeiterkonto dauerhaft",
  ]);

  // API contract source: manager delete returns membership (T-F04-b)
  const empCtrl = read("backend/src/controllers/employee.controller.ts");
  mustContain("Manager DELETE returns removal: membership", empCtrl, [
    'removal: "membership"',
    'financialRecords: "retained"',
  ]);

  // Toast honesty
  const toastEn = en.employee.settings.toastAccountDeleted ?? "";
  mustNotContain("EN toast ≠ account has been deleted absolute", toastEn, [
    "Your account has been deleted.",
  ]);
  mustContain("EN toast says access revoked", toastEn, ["revoked"]);

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  if (failed.length) {
    console.error(`\n${failed.length} failure(s)`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} Slice H copy checks passed.`);
}

main();
