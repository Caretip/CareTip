/**
 * Plain-language summary of one dispute for non-technical admins. Derived on the server from fields that
 * come from Stripe (status, amounts, deadline, submissions, funds, reversals) or from CareTip's own records
 * (marked as such). Returns codes + parameters; the page translates them (EN/DE).
 *
 * Rules: never present a guess as a fact. Where CareTip cannot know something (for example whether the
 * beneficiary already paid the money out to their bank), say so. When the latest Stripe state could not
 * be confirmed, everything is shown as "reconciliation required".
 */
import type { StripeDispute } from "@prisma/client";

export type ExplainSource = "stripe" | "caretip_record" | "not_determinable";

export type DisputeExplanation = {
  happened: {
    amountCents: number;
    currency: string;
    paymentDate: string | null;
    paymentDateSource: ExplainSource;
    businessName: string | null;
    employeeName: string | null;
    subject: string;
  };
  confirmed: Array<{ code: string; params?: Record<string, string | number> }>;
  money: Array<{ location: "platform" | "business_account" | "employee_account" | "bank" | "unknown"; code: string; amountCents?: number; currency?: string; source: ExplainSource }>;
  nextStep: string;
  adminAction: string;
  needsAttention: boolean;
  verification: { lastStripeSyncAt: string; stale: boolean; syncError: boolean; mixedCurrency: boolean };
};

const OPEN = new Set(["needs_response", "under_review", "warning_needs_response", "warning_under_review"]);
const WON = new Set(["won", "warning_closed", "prevented"]);
const STALE_OPEN_MS = 24 * 3600_000;

type Input = Pick<
  StripeDispute,
  | "stripeStatus"
  | "amountCents"
  | "currency"
  | "subjectKind"
  | "evidenceDueBy"
  | "evidencePastDue"
  | "evidenceSubmissionCount"
  | "fundsWithdrawnCents"
  | "fundsReinstatedCents"
  | "fundsCurrency"
  | "fundsCurrencyMixed"
  | "lastStripeSyncAt"
  | "lastSyncError"
  | "recoveryStatus"
  | "recoveredCents"
  | "recoveryCancelledAt"
  | "destinationTransferId"
>;

export function explainDispute(
  row: Input,
  extra: {
    businessName: string | null;
    employeeName: string | null;
    paymentDate: Date | null;
    /** Platform hold only: CareTip's payable record of what was transferred to the employee. */
    platformHoldTransferredCents: number | null;
    outstandingCents: number;
    now?: Date;
  },
): DisputeExplanation {
  const now = extra.now ?? new Date();
  const stale = OPEN.has(row.stripeStatus) && now.getTime() - row.lastStripeSyncAt.getTime() > STALE_OPEN_MS;
  const syncError = Boolean(row.lastSyncError);
  const fundsCurrency = row.fundsCurrency ?? row.currency;
  const confirmed: DisputeExplanation["confirmed"] = [{ code: `status_${WON.has(row.stripeStatus) ? "won" : row.stripeStatus === "lost" ? "lost" : OPEN.has(row.stripeStatus) ? (row.stripeStatus.endsWith("under_review") ? "under_review" : "needs_response") : "other"}` }];
  if (row.fundsWithdrawnCents > 0) confirmed.push({ code: "funds_withdrawn", params: { amountCents: row.fundsWithdrawnCents, currency: fundsCurrency } });
  if (row.fundsReinstatedCents > 0) confirmed.push({ code: "funds_reinstated", params: { amountCents: row.fundsReinstatedCents, currency: fundsCurrency } });
  if (row.evidenceSubmissionCount > 0) confirmed.push({ code: "evidence_submitted", params: { count: row.evidenceSubmissionCount } });
  if (row.evidenceDueBy && OPEN.has(row.stripeStatus)) confirmed.push({ code: "evidence_due", params: { at: row.evidenceDueBy.toISOString() } });
  if (row.recoveredCents > 0) confirmed.push({ code: "recovered", params: { amountCents: row.recoveredCents, currency: row.currency } });

  const money: DisputeExplanation["money"] = [];
  const netWithdrawn = Math.max(0, row.fundsWithdrawnCents - row.fundsReinstatedCents);
  if (row.fundsWithdrawnCents > 0) {
    money.push({ location: "platform", code: netWithdrawn > 0 ? "taken_from_platform" : "returned_to_platform", amountCents: netWithdrawn > 0 ? netWithdrawn : row.fundsReinstatedCents, currency: fundsCurrency, source: "stripe" });
  } else if (OPEN.has(row.stripeStatus)) {
    money.push({ location: "platform", code: "not_withdrawn_yet", source: "stripe" });
  }
  const tipToBusiness = row.subjectKind === "tip_destination_business";
  const tipToEmployee = row.subjectKind === "tip_destination_employee" || row.subjectKind === "tip_platform_hold";
  if (tipToBusiness || tipToEmployee) {
    const location = tipToBusiness ? "business_account" : "employee_account";
    if (row.subjectKind === "tip_platform_hold" && (extra.platformHoldTransferredCents ?? 0) === 0) {
      money.push({ location: "employee_account", code: "tip_not_paid_out_yet", source: "caretip_record" });
    } else {
      money.push({ location, code: "tip_sent_to_account", source: row.subjectKind === "tip_platform_hold" ? "caretip_record" : "stripe" });
      if (row.recoveredCents > 0) money.push({ location, code: "recovered_from_account", amountCents: row.recoveredCents, currency: row.currency, source: "stripe" });
      // Stripe does not link bank payouts to individual tips: CareTip cannot know this.
      money.push({ location: "bank", code: "bank_payout_unknown", source: "not_determinable" });
    }
  } else if (row.subjectKind === "physical_qr_order" || row.subjectKind === "subscription") {
    money.push({ location: "platform", code: "caretip_own_sale", source: "caretip_record" });
  } else {
    money.push({ location: "unknown", code: "payment_not_attributed", source: "not_determinable" });
  }

  let nextStep: string;
  let adminAction: string;
  let needsAttention = false;
  if (syncError || stale || row.fundsCurrencyMixed) {
    nextStep = "reconciliation_required";
    adminAction = "sync_or_tell_developer";
    needsAttention = true;
  } else if (row.stripeStatus === "needs_response" || row.stripeStatus === "warning_needs_response") {
    if (row.evidencePastDue || (row.evidenceDueBy && row.evidenceDueBy <= now)) {
      nextStep = "deadline_passed";
      adminAction = "none_wait_for_bank";
    } else {
      nextStep = "evidence_required";
      adminAction = "prepare_evidence";
      needsAttention = true;
    }
  } else if (row.stripeStatus === "under_review" || row.stripeStatus === "warning_under_review") {
    nextStep = "awaiting_bank";
    adminAction = "none_wait_for_bank";
  } else if (WON.has(row.stripeStatus)) {
    if (row.recoveryCancelledAt && row.recoveredCents > 0) {
      nextStep = "won_after_recovery";
      adminAction = "ask_owner_return_recovered";
      needsAttention = true;
    } else {
      nextStep = row.fundsReinstatedCents > 0 ? "won_funds_returned" : "won";
      adminAction = "none";
    }
  } else if (row.stripeStatus === "lost") {
    if (row.subjectKind === "physical_qr_order" || row.subjectKind === "subscription") {
      nextStep = "lost_caretip_sale";
      adminAction = "none";
    } else if (row.subjectKind === "unattributed") {
      nextStep = "lost_not_attributed";
      adminAction = "tell_developer";
      needsAttention = true;
    } else {
      switch (row.recoveryStatus) {
        case "not_required":
          nextStep = "lost_tip_not_paid_out";
          adminAction = "none";
          break;
        case "outstanding":
          nextStep = "recovery_waiting_funds";
          adminAction = "none_retries_scheduled";
          break;
        case "in_progress":
          nextStep = "recovery_waiting_confirmation";
          adminAction = "none_wait_for_stripe";
          break;
        case "partially_recovered":
          nextStep = extra.outstandingCents > 0 ? "recovery_partial" : "recovery_confirmed";
          adminAction = extra.outstandingCents > 0 ? "none_retries_scheduled" : "none";
          break;
        case "recovered":
          nextStep = "recovery_confirmed";
          adminAction = "none";
          break;
        case "failed":
          nextStep = "recovery_failed";
          adminAction = "ask_owner";
          needsAttention = true;
          break;
        case "cancelled":
          nextStep = "recovery_cancelled";
          adminAction = row.recoveredCents > 0 ? "ask_owner_return_recovered" : "none";
          needsAttention = row.recoveredCents > 0;
          break;
        default:
          nextStep = "lost_recovery_review";
          adminAction = "decide_recovery_with_policy";
          needsAttention = true;
      }
    }
  } else {
    nextStep = "reconciliation_required";
    adminAction = "sync_or_tell_developer";
    needsAttention = true;
  }

  return {
    happened: {
      amountCents: row.amountCents,
      currency: row.currency,
      paymentDate: extra.paymentDate?.toISOString() ?? null,
      paymentDateSource: extra.paymentDate ? "caretip_record" : "not_determinable",
      businessName: extra.businessName,
      employeeName: extra.employeeName,
      subject: row.subjectKind,
    },
    confirmed,
    money,
    nextStep,
    adminAction,
    needsAttention,
    verification: { lastStripeSyncAt: row.lastStripeSyncAt.toISOString(), stale, syncError, mixedCurrency: row.fundsCurrencyMixed },
  };
}
