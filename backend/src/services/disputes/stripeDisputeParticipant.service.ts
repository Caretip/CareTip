/**
 * Read-only dispute views for the people affected, scoped on the server from the JWT:
 *  - a business manager sees disputes on tips paid at their own business (never another business,
 *    never CareTip's own sales such as QR orders or subscriptions);
 *  - an employee sees disputes on their own tips only.
 * No Stripe IDs of other parties, no cardholder data, no internal admin notes or evidence.
 */
import { StripeDisputeSubjectKind } from "@prisma/client";
import { prisma } from "../../prisma.js";

const TIP_KINDS = [
  StripeDisputeSubjectKind.tip_destination_business,
  StripeDisputeSubjectKind.tip_destination_employee,
  StripeDisputeSubjectKind.tip_platform_hold,
];
const EMPLOYEE_KINDS = [StripeDisputeSubjectKind.tip_destination_employee, StripeDisputeSubjectKind.tip_platform_hold];

/** Stripe's status reduced to what a participant needs to know. */
export function participantDisputeOutcome(stripeStatus: string): "open" | "won" | "lost" {
  if (stripeStatus === "won" || stripeStatus === "warning_closed" || stripeStatus === "prevented") return "won";
  if (stripeStatus === "lost") return "lost";
  return "open";
}

type Row = {
  id: string;
  subjectKind: StripeDisputeSubjectKind;
  stripeStatus: string;
  amountCents: number;
  currency: string;
  stripeCreatedAt: Date;
  transactionId: string | null;
  recoveryStatus: string;
  recoveredCents: number;
  recoveryApprovedCents: number | null;
  recoveryApprovedAt: Date | null;
  recoveryCancelledAt: Date | null;
  recoveryNextRetryAt: Date | null;
  fundsReinstatedCents: number;
};

function recoveryView(r: Row, beneficiary: boolean) {
  const approved = r.recoveryApprovedCents;
  if (!beneficiary || approved == null || !r.recoveryApprovedAt) return null;
  return {
    status: r.recoveryStatus,
    approvedCents: approved,
    recoveredCents: r.recoveredCents,
    outstandingCents: r.recoveryCancelledAt ? 0 : Math.max(0, approved - r.recoveredCents),
    nextAttemptAt: r.recoveryNextRetryAt?.toISOString() ?? null,
  };
}

const select = {
  id: true,
  subjectKind: true,
  stripeStatus: true,
  amountCents: true,
  currency: true,
  stripeCreatedAt: true,
  transactionId: true,
  employeeId: true,
  recoveryStatus: true,
  recoveredCents: true,
  recoveryApprovedCents: true,
  recoveryApprovedAt: true,
  recoveryCancelledAt: true,
  recoveryNextRetryAt: true,
  fundsReinstatedCents: true,
} as const;

export async function listDisputesForBusiness(businessId: string) {
  const rows = await prisma.stripeDispute.findMany({
    where: { businessId, subjectKind: { in: TIP_KINDS } },
    select,
    orderBy: { stripeCreatedAt: "desc" },
    take: 100,
  });
  const employeeIds = [...new Set(rows.map((r) => r.employeeId).filter((v): v is string => Boolean(v)))];
  const employees = employeeIds.length
    ? await prisma.employee.findMany({ where: { id: { in: employeeIds }, businessId }, select: { id: true, name: true } })
    : [];
  const names = new Map(employees.map((e) => [e.id, e.name]));
  return {
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.stripeCreatedAt.toISOString(),
      amountCents: r.amountCents,
      currency: r.currency,
      outcome: participantDisputeOutcome(r.stripeStatus),
      paidTo: r.subjectKind === StripeDisputeSubjectKind.tip_destination_business ? ("business" as const) : ("employee" as const),
      employeeName: r.employeeId ? names.get(r.employeeId) ?? null : null,
      fundsReinstated: r.fundsReinstatedCents > 0,
      // Recovery details only where the business itself was paid (it is the one affected).
      recovery: recoveryView(r, r.subjectKind === StripeDisputeSubjectKind.tip_destination_business),
    })),
  };
}

export async function listDisputesForEmployee(employeeId: string) {
  const rows = await prisma.stripeDispute.findMany({
    where: { employeeId, subjectKind: { in: EMPLOYEE_KINDS } },
    select,
    orderBy: { stripeCreatedAt: "desc" },
    take: 100,
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.stripeCreatedAt.toISOString(),
      amountCents: r.amountCents,
      currency: r.currency,
      outcome: participantDisputeOutcome(r.stripeStatus),
      fundsReinstated: r.fundsReinstatedCents > 0,
      recovery: recoveryView(r, true),
    })),
  };
}
