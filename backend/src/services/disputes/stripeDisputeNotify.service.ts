/**
 * Dispute and recovery notifications through the existing orchestrator (in-app, push, email; EN/DE
 * templates). Each (dispute, event, generation) is claimed once in stripe_disputes.notified_keys, so
 * webhook retries, reconciliation, scheduled retries and several instances never send it twice.
 * Messages carry no cardholder data and no amounts; dashboards show the details to authorised users.
 *
 * Recipients:
 *  - platform admins: every event;
 *  - the business manager: open/won/lost of tips paid at the business; recovery events only when the
 *    business itself is the beneficiary (destination charge to the business);
 *  - the employee: open/won/lost and recovery events for their own tips (destination to the employee
 *    or a platform-hold tip transferred to them).
 * Businesses are never told about their own purchases from CareTip (QR orders, subscriptions).
 */
import { StripeDisputeSubjectKind } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { deliverNotificationToUsers } from "../notifications/notificationOrchestrator.service.js";
import { listPlatformAdminUserIds } from "../push/notification.triggers.js";
import { NotificationType } from "../push/notification.types.js";
import { logServerError } from "../../utils/httpErrors.js";

export type DisputeNotifyEvent =
  | "opened"
  | "evidence_due"
  | "evidence_failed"
  | "lost"
  | "won"
  | "funds_reinstated"
  | "recovery_failed"
  | "recovery_approved"
  | "recovery_insufficient_funds"
  | "recovery_partial"
  | "recovery_succeeded"
  | "recovery_cancelled"
  | "recovery_retries_exhausted";

const OUTCOME_EVENTS = new Set<DisputeNotifyEvent>(["opened", "won", "lost"]);
const RECOVERY_EVENTS = new Set<DisputeNotifyEvent>([
  "recovery_approved",
  "recovery_insufficient_funds",
  "recovery_partial",
  "recovery_succeeded",
  "recovery_cancelled",
]);
const TIP_KINDS = new Set<StripeDisputeSubjectKind>([
  StripeDisputeSubjectKind.tip_destination_business,
  StripeDisputeSubjectKind.tip_destination_employee,
  StripeDisputeSubjectKind.tip_platform_hold,
]);
const EMPLOYEE_BENEFICIARY = new Set<StripeDisputeSubjectKind>([
  StripeDisputeSubjectKind.tip_destination_employee,
  StripeDisputeSubjectKind.tip_platform_hold,
]);

export function shortDisputeRef(stripeDisputeId: string): string {
  return stripeDisputeId.length > 12 ? `${stripeDisputeId.slice(0, 5)}…${stripeDisputeId.slice(-6)}` : stripeDisputeId;
}

/** Atomically claims the key; true when this caller is the first. */
async function claimNotificationKey(rowId: string, key: string): Promise<boolean> {
  const claimed = await prisma.$executeRaw`
    UPDATE stripe_disputes SET notified_keys = array_append(notified_keys, ${key})
    WHERE id = ${rowId} AND NOT (${key} = ANY(notified_keys))`;
  return claimed === 1;
}

export async function notifyStripeDisputeEvent(rowId: string, event: DisputeNotifyEvent, keySuffix = ""): Promise<boolean> {
  const row = await prisma.stripeDispute.findUnique({
    where: { id: rowId },
    select: {
      id: true,
      stripeDisputeId: true,
      subjectKind: true,
      employeeId: true,
      business: { select: { name: true, userId: true } },
    },
  });
  if (!row) return false;
  const key = `${event}${keySuffix ? `:${keySuffix}` : ""}`;
  if (!(await claimNotificationKey(row.id, key))) return false;

  const ref = shortDisputeRef(row.stripeDisputeId);
  try {
    const adminIds = await listPlatformAdminUserIds();
    if (adminIds.length > 0) {
      await deliverNotificationToUsers(
        adminIds,
        {
          type: NotificationType.SYSTEM_ALERT,
          title: "Stripe dispute",
          body: "",
          localeTemplate: {
            id: "stripe_dispute_admin",
            params: { event, disputeRef: ref, businessName: row.business?.name ?? "", subjectKind: row.subjectKind },
          },
          url: `/platform-admin/revenue/disputes?dispute=${encodeURIComponent(row.id)}`,
          timestamp: new Date().toISOString(),
          metadata: { entityId: row.id, source: "stripe_dispute", event },
        },
        { dedupeKeyPrefix: `stripe_dispute:${row.id}:${key}`, channels: { in_app: true, push: true, email: event !== "won" } },
      );
    }
    if (!TIP_KINDS.has(row.subjectKind)) return true;

    const businessIsBeneficiary = row.subjectKind === StripeDisputeSubjectKind.tip_destination_business;
    if (row.business?.userId && (OUTCOME_EVENTS.has(event) || (businessIsBeneficiary && RECOVERY_EVENTS.has(event)))) {
      await deliverNotificationToUsers(
        [row.business.userId],
        {
          type: NotificationType.SYSTEM_ALERT,
          title: "Tip payment disputed",
          body: "",
          localeTemplate: { id: "stripe_dispute_business", params: { event } },
          url: "/dashboard/stripe/disputes",
          timestamp: new Date().toISOString(),
          metadata: { entityId: row.id, source: "stripe_dispute", event },
        },
        { dedupeKeyPrefix: `stripe_dispute_business:${row.id}:${key}`, channels: { in_app: true, push: false, email: true } },
      );
    }
    if (row.employeeId && EMPLOYEE_BENEFICIARY.has(row.subjectKind) && (OUTCOME_EVENTS.has(event) || RECOVERY_EVENTS.has(event))) {
      const employee = await prisma.employee.findUnique({ where: { id: row.employeeId }, select: { userId: true } });
      if (employee?.userId) {
        await deliverNotificationToUsers(
          [employee.userId],
          {
            type: NotificationType.SYSTEM_ALERT,
            title: "Tip disputed",
            body: "",
            localeTemplate: { id: "stripe_dispute_employee", params: { event } },
            url: "/employee/payments/disputes",
            timestamp: new Date().toISOString(),
            metadata: { entityId: row.id, source: "stripe_dispute", event },
          },
          { dedupeKeyPrefix: `stripe_dispute_employee:${row.id}:${key}`, channels: { in_app: true, push: false, email: true } },
        );
      }
    }
  } catch (err) {
    logServerError("stripeDispute.notify.deliver", err, { rowId: row.id, event });
  }
  return true;
}
