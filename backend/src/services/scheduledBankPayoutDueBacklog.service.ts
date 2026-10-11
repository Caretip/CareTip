/**
 * Due-account counts for every_3_days scheduled bank payout ticks (observability only).
 * Predicates must stay aligned with tick selection queries in employee/business scheduled services.
 */
import { prisma } from "../prisma.js";
import {
  businessDueScheduledBankPayoutWhere,
  employeeDueScheduledBankPayoutWhere,
} from "./scheduledBankPayoutDueSelection.service.js";

export type ScheduledPayoutDueBacklogStream = "business" | "employee";

/** Exact count of accounts matching the employee tick due predicate (indexed). */
export async function countDueEmployeeScheduledBankPayoutAccounts(now = new Date()): Promise<number> {
  return prisma.employeeStripeAccount.count({
    where: employeeDueScheduledBankPayoutWhere(now),
  });
}

/**
 * Exact count of businesses matching the business tick due predicate.
 * Note: Business table has no composite index on (bank_payout_schedule, bank_payout_next_scheduled_at);
 * at high volume this count may be slower than the employee stream (documented in D3 ops note).
 */
export async function countDueBusinessScheduledBankPayoutAccounts(now = new Date()): Promise<number> {
  return prisma.business.count({
    where: businessDueScheduledBankPayoutWhere(now),
  });
}

export async function countDueScheduledBankPayoutAccountsByStream(
  stream: ScheduledPayoutDueBacklogStream,
  now = new Date(),
): Promise<number> {
  return stream === "employee"
    ? countDueEmployeeScheduledBankPayoutAccounts(now)
    : countDueBusinessScheduledBankPayoutAccounts(now);
}
