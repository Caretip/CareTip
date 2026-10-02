/**
 * Business bank payout schedule — static + compute contract.
 * Run: node ./backend/node_modules/tsx/dist/cli.mjs ./backend/scripts/business-bank-payout-schedule-runtime.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DateTime } from "luxon";
import {
  computeNextEvery3DaysPayoutAt,
  isCareTipControlledBankSchedule,
  USER_SELECTABLE_BUSINESS_BANK_PAYOUT_SCHEDULE_VALUES,
} from "../src/services/businessBankPayoutSchedule.service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const schema = read("prisma/schema.prisma");
const scheduleSvc = read("src/services/businessBankPayoutSchedule.service.ts");
const scheduleCore = read("src/services/connectBankPayoutSchedule.core.ts");
const tickSvc = read("src/services/businessScheduledBankPayout.service.ts");
const instantSvc = read("src/services/stripeConnectInstantPayout.service.ts");

assert(schema.includes("enum BusinessBankPayoutSchedule"), "schema enum");
assert(schema.includes("every_3_days"), "every_3_days enum value");
assert(schema.includes("StripeConnectScheduledPayoutRequest"), "scheduled payout ledger");
assert(schema.includes("bankPayoutSchedule"), "business preference field");

assert(scheduleCore.includes("stripePayoutScheduleUpdateForPreference"), "shared stripe schedule mapping");
assert(scheduleCore.includes('"daily"'), "daily stripe sync");
assert(!scheduleCore.includes("3_days"), "no fake stripe interval");

assert(tickSvc.includes("idempotencyKey"), "deterministic idempotency");
assert(tickSvc.includes("isPrismaUniqueViolation"), "P2002 ledger race handling");
assert(tickSvc.includes("businessScheduledBankPayout.tick.business"), "tick batch error isolation");
assert(tickSvc.includes("skipped_zero_balance"), "zero balance handling");
assert(tickSvc.includes("balance.available"), "stripe available balance only");

assert(instantSvc.includes('method: "instant"'), "instant payout unchanged");

assert(isCareTipControlledBankSchedule("every_3_days" as never), "every_3_days caretip controlled");
assert(!isCareTipControlledBankSchedule("daily" as never), "daily stripe native");
assert(!isCareTipControlledBankSchedule("manual" as never), "legacy manual not caretip scheduled");
assert(USER_SELECTABLE_BUSINESS_BANK_PAYOUT_SCHEDULE_VALUES.length === 4, "four user schedules");

const first = computeNextEvery3DaysPayoutAt({ timezone: "Europe/Berlin" });
const second = computeNextEvery3DaysPayoutAt({
  timezone: "Europe/Berlin",
  previousAnchorUtc: first,
});
const diffDays = DateTime.fromJSDate(second).diff(DateTime.fromJSDate(first), "days").days;
assert(diffDays >= 2.9 && diffDays <= 3.1, `expected ~3 day step, got ${diffDays}`);

assert(read("src/routes/internalJobs.routes.ts").includes("scheduled-bank-payout-tick"), "cron route");
assert(read("src/routes/connect.routes.ts").includes("bank-payout-schedule"), "manager API");

console.log("business-bank-payout-schedule-runtime: ok");
