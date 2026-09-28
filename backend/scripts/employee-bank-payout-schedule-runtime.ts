/**
 * Employee bank payout schedule — static contract + shared tick wiring.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeNextEvery3DaysPayoutAt,
  isCareTipControlledBankSchedule,
} from "../src/services/businessBankPayoutSchedule.service.js";
import { employeeScheduledBankPayoutStripeIdempotencyKey } from "../src/services/employeeScheduledBankPayout.service.js";

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
const empSchedule = read("src/services/employeeBankPayoutSchedule.service.ts");
const empTick = read("src/services/employeeScheduledBankPayout.service.ts");
const businessTick = read("src/services/businessScheduledBankPayout.service.ts");
const core = read("src/services/connectBankPayoutSchedule.core.ts");

assert(schema.includes("employee_stripe_accounts") && schema.includes("bank_payout_schedule"), "employee schedule columns");
assert(schema.includes("EmployeeStripeScheduledPayoutRequest"), "employee scheduled ledger");
assert(empSchedule.includes("resolveActiveEmployeeForConnect"), "employee auth context");
assert(empSchedule.includes("syncStripeConnectAccountPayoutSchedule"), "shared stripe sync");
assert(empTick.includes("caretip_employee_scheduled_payout"), "employee idempotency prefix");
assert(empTick.includes("isPrismaUniqueViolation"), "P2002 handling");
assert(businessTick.includes("tickEmployeeScheduledBankPayouts"), "single cron tick processes employees");
assert(core.includes("stripePayoutScheduleUpdateForPreference"), "shared stripe schedule mapping");
assert(!empTick.includes("employeeTipRelease"), "does not replace tip release");

const dueAt = new Date("2026-03-01T08:00:00.000Z");
const key = employeeScheduledBankPayoutStripeIdempotencyKey("emp_1", dueAt);
assert(key.includes("emp_1"), "idempotency includes employee id");

assert(isCareTipControlledBankSchedule("every_3_days" as never), "every_3_days caretip controlled");
const step = computeNextEvery3DaysPayoutAt({ timezone: "Europe/Berlin", previousAnchorUtc: dueAt });
assert(step.getTime() > dueAt.getTime(), "3-day step");

assert(read("src/routes/employeeConnect.routes.ts").includes("bank-payout-schedule"), "employee API routes");

console.log("employee-bank-payout-schedule-runtime: ok");
