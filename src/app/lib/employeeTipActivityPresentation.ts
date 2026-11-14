import type { EmployeePayableActivityItem, EmployeePayableActivityFilter } from "./api";
import {
  employeePayoutActivityDisplayAt,
  employeePayoutActivityKind,
  type EmployeePayoutActivityKind,
} from "../components/employee/employeePayoutActivityPresentation";

export type TipActivityDateGroup = "today" | "yesterday" | "older";

export function employeeTipActivityKind(row: EmployeePayableActivityItem): EmployeePayoutActivityKind {
  return employeePayoutActivityKind(row);
}

export function employeeTipActivityDisplayAt(row: EmployeePayableActivityItem): string {
  return employeePayoutActivityDisplayAt(row);
}

export function employeeTipActivityPrimaryAmountCents(row: EmployeePayableActivityItem): number {
  const kind = employeeTipActivityKind(row);
  if (kind === "refunded") return row.refundedCents;
  if (
    kind === "transferred" ||
    kind === "destination_routed" ||
    kind === "transferring" ||
    kind === "venue_distributed"
  ) {
    return row.activityCents;
  }
  return row.grossCents ?? row.payableCents;
}

/**
 * Business-recorded distribution line for a venue-routed tip, or null when nothing was recorded.
 * Amounts come from the same allocation rows the business Tip Distribution page sums.
 */
export function employeeTipActivityDistributionNote(row: EmployeePayableActivityItem): {
  key: "employee.tipActivity.distribution.full" | "employee.tipActivity.distribution.partial";
  distributedCents: number;
  outstandingCents: number;
  at: string | null;
} | null {
  const distributedCents = Math.max(0, row.distributedCents ?? 0);
  if (distributedCents <= 0) return null;
  const outstandingCents = Math.max(0, (row.remainingPayableCents ?? 0) - distributedCents);
  return {
    key:
      row.distributionState === "partial"
        ? "employee.tipActivity.distribution.partial"
        : "employee.tipActivity.distribution.full",
    distributedCents,
    outstandingCents,
    at: row.lastDistributedAt ?? null,
  };
}

export function employeeTipActivityVenueLabel(row: EmployeePayableActivityItem): string | null {
  const parts = [row.locationName?.trim(), row.tableName?.trim()].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function employeeTipActivityReference(row: EmployeePayableActivityItem): string | null {
  if (row.receiptNumber?.trim()) return `#${row.receiptNumber.trim()}`;
  if (row.transactionId) return row.transactionId.slice(0, 10);
  return row.id.slice(0, 10);
}

export function employeeTipActivityDateGroup(
  iso: string,
  timezone: string,
  now = new Date(),
): TipActivityDateGroup {
  const tz = timezone.trim() || "UTC";
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const activityDay = fmt(new Date(iso));
  const today = fmt(now);
  const yesterday = fmt(new Date(now.getTime() - 86_400_000));
  if (activityDay === today) return "today";
  if (activityDay === yesterday) return "yesterday";
  return "older";
}

export const TIP_ACTIVITY_FILTERS: EmployeePayableActivityFilter[] = [
  "all",
  "tips",
  "transfers",
  "pending",
  "distributed",
  "issues",
];
