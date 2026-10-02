/**
 * Bank payout schedule UI — four user-facing options only.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const userOptions = read("src/app/lib/bankPayoutScheduleUserOptions.ts");
assert(userOptions.includes('"daily"'), "daily");
assert(userOptions.includes('"every_3_days"'), "every_3_days");
assert(userOptions.includes('"weekly"'), "weekly");
assert(userOptions.includes('"monthly"'), "monthly");
assert(!userOptions.includes('"manual"'), "no manual in user options");

const en = read("src/i18n/locales/en.json");
const de = read("src/i18n/locales/de.json");
assert(en.includes("legacyManualNotice"), "EN legacy notice");
assert(de.includes("legacyManualNotice"), "DE legacy notice");
assert(!en.includes('"manual": "Manual"'), "EN removed manual schedule label");
assert(!de.includes('"manual": "Manuell"'), "DE removed manual schedule label");

console.log("bank-payout-schedule-ui-runtime: ok");
