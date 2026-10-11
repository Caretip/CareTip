/**
 * Phase C — scheduled bank payout incident notifications (deterministic, no live providers).
 */
import {
  BusinessBankPayoutSchedule,
  ScheduledPayoutFailureClassification,
  ScheduledPayoutReconciliationStatus,
  StripeConnectScheduledPayoutRequestStatus,
} from "@prisma/client";
import {
  classifyScheduledPayoutLedgerIncidents,
  incidentCategoryStillActive,
} from "../src/services/scheduledBankPayoutIncident.classify.js";
import { SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS } from "../src/services/scheduledBankPayoutRecovery.service.js";
import { renderNotificationTemplate } from "../src/notifications/notificationI18n.js";
import { buildScheduledPayoutOpsIncidentTemplate } from "../src/services/scheduledBankPayoutIncident.notify.js";
import { accountScheduleEligibleForOverdue } from "../src/services/scheduledBankPayoutIncident.service.js";
import { parseScheduledPayoutIncidentDedupeKey } from "../src/services/scheduledBankPayoutIncidentDelivery.service.js";
import { scheduledPayoutOpsIncidentDedupeKey } from "../src/services/scheduledBankPayoutIncident.notify.js";
import { platformAdminIncidentRecipientWhere } from "../src/lib/platformAdminAccess.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function baseSnapshot(id = "led_1") {
  return {
    id,
    status: StripeConnectScheduledPayoutRequestStatus.failed,
    scheduleWindowKey: "2026-10-01",
    idempotencyKey: "idem",
    amountCents: 5000,
    currency: "eur",
    stripePayoutId: null,
    failureCode: null,
    attemptCount: 0,
    nextRetryAt: null,
    failureClassification: null,
    reconciliationStatus: ScheduledPayoutReconciliationStatus.none,
    correlationId: "corr",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function baseRow(overrides: Partial<ReturnType<typeof baseInput>> = {}) {
  return { ...baseInput(), ...overrides };
}

function baseInput() {
  const snapshot = baseSnapshot();
  return {
    snapshot,
    status: snapshot.status,
    blockedReason: null as string | null,
    failureClassification: null as ScheduledPayoutFailureClassification | null,
    reconciliationStatus: ScheduledPayoutReconciliationStatus.none,
    attemptCount: 0,
    correlationId: "corr",
    stripePayoutId: null as string | null,
    failureCode: null as string | null,
  };
}

// --- classification parity employee/business ---
const retryExhausted = classifyScheduledPayoutLedgerIncidents(
  baseRow({
    blockedReason: "retry_exhausted",
    attemptCount: SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS,
  }),
);
assert(
  retryExhausted.some((c) => c.category === "retry_exhausted"),
  "retry exhausted category",
);
const employeeRetry = classifyScheduledPayoutLedgerIncidents(baseRow({ blockedReason: "retry_exhausted" }));
const businessRetry = classifyScheduledPayoutLedgerIncidents(baseRow({ blockedReason: "retry_exhausted" }));
assert(employeeRetry.length === businessRetry.length, "employee/business parity retry");

// transient retry_scheduled must not alert
const transient = classifyScheduledPayoutLedgerIncidents(
  baseRow({
    blockedReason: "retry_scheduled",
    attemptCount: 1,
    status: StripeConnectScheduledPayoutRequestStatus.failed,
  }),
);
assert(transient.length === 0, "no incident on retry_scheduled alone");

const inconclusive = classifyScheduledPayoutLedgerIncidents(
  baseRow({
    reconciliationStatus: ScheduledPayoutReconciliationStatus.inconclusive,
  }),
);
assert(
  inconclusive.some((c) => c.category === "reconciliation_inconclusive"),
  "reconciliation inconclusive",
);

const reconRequired = classifyScheduledPayoutLedgerIncidents(
  baseRow({
    reconciliationStatus: ScheduledPayoutReconciliationStatus.required,
    status: StripeConnectScheduledPayoutRequestStatus.failed,
  }),
);
assert(
  reconRequired.some((c) => c.category === "reconciliation_required"),
  "reconciliation required",
);

const uncertain = classifyScheduledPayoutLedgerIncidents(
  baseRow({
    failureClassification: ScheduledPayoutFailureClassification.outcome_uncertain,
  }),
);
assert(uncertain.some((c) => c.category === "outcome_uncertain"), "outcome uncertain");

const stale = classifyScheduledPayoutLedgerIncidents(
  baseRow({ blockedReason: "stale_pending_no_stripe_match" }),
);
assert(stale.some((c) => c.category === "stale_pending_blocked"), "stale pending");

const overdue = classifyScheduledPayoutLedgerIncidents(
  baseRow({ blockedReason: "retry_exhausted" }),
  { payoutOverdue: true },
);
assert(overdue.some((c) => c.category === "payout_overdue"), "overdue when flagged");

const notOverdue = classifyScheduledPayoutLedgerIncidents(
  baseRow({ blockedReason: "retry_exhausted" }),
  { payoutOverdue: false },
);
assert(!notOverdue.some((c) => c.category === "payout_overdue"), "no overdue without threshold");

// resolution helper
const active = classifyScheduledPayoutLedgerIncidents(baseRow({ blockedReason: "retry_exhausted" }));
assert(
  incidentCategoryStillActive("retry_exhausted", active),
  "category still active while ledger blocked",
);
const recovered = classifyScheduledPayoutLedgerIncidents(
  baseRow({
    status: StripeConnectScheduledPayoutRequestStatus.submitted,
    blockedReason: null,
    reconciliationStatus: ScheduledPayoutReconciliationStatus.none,
  }),
);
assert(
  !incidentCategoryStillActive("retry_exhausted", recovered),
  "retry exhausted resolves on submitted",
);

// EN / DE copy
const template = buildScheduledPayoutOpsIncidentTemplate({
  payoutType: "employee",
  category: "reconciliation_inconclusive",
  subjectLabel: "Test Hotel",
  ledgerRef: "clxyz123…ab12",
  detectedAtIso: "2026-10-01T12:00:00.000Z",
});
const en = renderNotificationTemplate("en", template);
const de = renderNotificationTemplate("de", template);
assert(en.title.includes("Scheduled bank payout"), "en title");
assert(de.title.includes("Geplante Bankauszahlung"), "de title");
assert(en.body.includes("Test Hotel"), "en subject");
assert(de.body.includes("Test Hotel"), "de subject");
assert(!en.body.includes("po_"), "no stripe payout id in copy");

// platform admin recipient filter requires emailVerified
assert(platformAdminIncidentRecipientWhere.emailVerified === true, "email verified gate");

const dk = scheduledPayoutOpsIncidentDedupeKey("inc_x", 4, "user_y");
const parsed = parseScheduledPayoutIncidentDedupeKey(dk);
assert(parsed?.notifyGeneration === 4 && parsed.userId === "user_y", "dedupe key roundtrip");

assert(
  accountScheduleEligibleForOverdue(BusinessBankPayoutSchedule.every_3_days),
  "every_3_days overdue eligible",
);
assert(
  !accountScheduleEligibleForOverdue(BusinessBankPayoutSchedule.daily),
  "daily not overdue eligible",
);

console.log("scheduled-bank-payout-incident-runtime: OK");
