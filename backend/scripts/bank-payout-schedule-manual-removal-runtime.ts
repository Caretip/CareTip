/**
 * Manual payout schedule removal — API + Stripe mapping contract (every_3_days unchanged).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BusinessBankPayoutSchedule } from "@prisma/client";
import {
  parseBusinessBankPayoutSchedule,
  USER_SELECTABLE_BUSINESS_BANK_PAYOUT_SCHEDULE_VALUES,
} from "../src/services/businessBankPayoutSchedule.service.js";
import { stripePayoutScheduleUpdateForPreference } from "../src/services/connectBankPayoutSchedule.core.js";
import { StripeConnectError } from "../src/services/stripeConnect.service.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(backendRoot, "..");

function readBackend(rel: string): string {
  const abs = path.join(backendRoot, rel);
  if (!existsSync(abs)) throw new Error(`missing: ${rel}`);
  return readFileSync(abs, "utf8");
}

function readRepo(rel: string): string {
  const abs = path.join(repoRoot, rel);
  if (!existsSync(abs)) throw new Error(`missing: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(USER_SELECTABLE_BUSINESS_BANK_PAYOUT_SCHEDULE_VALUES.length === 4, "four user schedules");
assert(
  !USER_SELECTABLE_BUSINESS_BANK_PAYOUT_SCHEDULE_VALUES.includes(BusinessBankPayoutSchedule.manual),
  "manual not user-selectable",
);

let rejectedManual = false;
try {
  parseBusinessBankPayoutSchedule("manual");
} catch (err) {
  rejectedManual =
    err instanceof StripeConnectError && err.code === "BANK_PAYOUT_SCHEDULE_NOT_AVAILABLE";
}
assert(rejectedManual, "PATCH rejects manual");

assert(
  parseBusinessBankPayoutSchedule("every_3_days") === BusinessBankPayoutSchedule.every_3_days,
  "every_3_days still accepted",
);

const e3Stripe = stripePayoutScheduleUpdateForPreference(BusinessBankPayoutSchedule.every_3_days);
assert(e3Stripe.interval === "manual", "every_3_days maps to Stripe manual interval");

assert(
  stripePayoutScheduleUpdateForPreference(BusinessBankPayoutSchedule.daily).interval === "daily",
  "daily stripe automatic",
);
assert(
  stripePayoutScheduleUpdateForPreference(BusinessBankPayoutSchedule.weekly).interval === "weekly",
  "weekly stripe automatic",
);
assert(
  stripePayoutScheduleUpdateForPreference(BusinessBankPayoutSchedule.monthly).interval ===
    "monthly",
  "monthly stripe automatic",
);

const businessCard = readRepo(
  "src/app/components/business/settings/billing/BusinessBankPayoutScheduleCard.tsx",
);
const employeeCard = readRepo("src/app/components/employee/EmployeeBankPayoutScheduleCard.tsx");
const userOptions = readRepo("src/app/lib/bankPayoutScheduleUserOptions.ts");

assert(businessCard.includes("USER_SELECTABLE_BANK_PAYOUT_SCHEDULES"), "business card uses shared options");
assert(employeeCard.includes("USER_SELECTABLE_BANK_PAYOUT_SCHEDULES"), "employee card uses shared options");
assert(!businessCard.includes('"manual",'), "business card no manual option literal");
assert(!employeeCard.includes('"manual",'), "employee card no manual option literal");
assert(businessCard.includes('schedule === "manual"'), "business legacy manual notice");
assert(userOptions.includes('"every_3_days"'), "shared options include every_3_days");

const tick = readBackend("src/services/businessScheduledBankPayout.service.ts");
assert(tick.includes("every_3_days"), "scheduler still every_3_days only");

console.log("bank-payout-schedule-manual-removal-runtime: ok");
