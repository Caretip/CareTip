/**
 * Full-account dry-run / apply reconciliation for Connect payout policy.
 */
import { BusinessBankPayoutSchedule } from "@prisma/client";
import { stripeSecretKeyMode } from "../utils/stripeKeyMode.js";
import {
  enumerateAllEligibleBusinessConnectAccounts,
  enumerateAllEligibleEmployeeConnectAccounts,
  type EligibleConnectAccount,
  type SkippedConnectAccount,
} from "./connectPayoutAccountEnumeration.service.js";
import {
  applyConnectPayoutPolicy,
  connectPayoutPolicyDiagnostics,
  expectedStripeIntervalForCareTipSchedule,
  readConnectPayoutConfigurationStatus,
  type StripeAccountReadErrorClass,
} from "./connectPayoutConfiguration.service.js";
import {
  businessHasPendingScheduledPayoutLedger,
  employeeHasPendingScheduledPayoutLedger,
} from "./connectPayoutScheduleTransition.service.js";
import { isStripeConfigured } from "./stripe.service.js";
import { decideConnectSettlement } from "./stripeConnectBalanceSettings.service.js";

export type ReconciliationMode = "dry_run" | "apply";

export type ReconciliationAccountDisposition =
  | "would_update"
  | "updated"
  | "already_correct"
  | "confirmed_schedule_drift"
  | "blocked_unverified_account"
  | "skipped_pending_ledger"
  | "skipped_not_eligible"
  | "needs_investigation"
  | "failed";

export type ReconciliationAccountRow = {
  kind: "business" | "employee";
  careTipIdSuffix: string;
  stripeAccountSuffix: string;
  careTipSchedule: BusinessBankPayoutSchedule;
  stripeScheduleInterval: string | null;
  stripeScheduleReadable: boolean;
  /** Confirmed drift after successful Stripe read only. */
  scheduleDrift: boolean;
  settlementSource: string;
  effectiveSettlementDelayDays: number | null;
  proposedActions: string[];
  disposition: ReconciliationAccountDisposition;
  skipReason: string | null;
  policyDiagnostics: Record<string, unknown> | null;
  expectedStripeInterval: string;
  settlementDelayDaysOverride: number | null;
  stripeAccountReadError: string | null;
  stripeAccountReadErrorClass: StripeAccountReadErrorClass | null;
};

export type ReconciliationReport = {
  mode: ReconciliationMode;
  stripeKeyMode: ReturnType<typeof stripeSecretKeyMode>;
  discovered: number;
  eligible: number;
  enumerationSkipped: number;
  processed: number;
  wouldUpdate: number;
  updated: number;
  alreadyCorrect: number;
  confirmedScheduleDrift: number;
  blockedUnverified: number;
  skippedPendingLedger: number;
  skippedNotEligible: number;
  needsInvestigation: number;
  failed: number;
  rows: ReconciliationAccountRow[];
  enumerationSkippedRows: SkippedConnectAccount[];
};

function suffix(id: string): string {
  return id.length <= 8 ? "(short)" : `…${id.slice(-8)}`;
}

function proposedActionsForAccount(args: {
  confirmedScheduleDrift: boolean;
  settlementAction: string;
  settlementNeedsApply: boolean;
  stripeScheduleReadable: boolean;
}): string[] {
  const actions: string[] = [];
  if (!args.stripeScheduleReadable) {
    actions.push("review_stripe_account_access");
    return actions;
  }
  if (args.confirmedScheduleDrift) actions.push("resync_stripe_payout_interval");
  if (args.settlementNeedsApply || args.settlementAction !== "settlement_and_schedule_verified") {
    actions.push(args.settlementAction);
  }
  if (actions.length === 0) actions.push("settlement_and_schedule_verified");
  return actions;
}

export async function processReconciliationAccount(
  account: EligibleConnectAccount,
  mode: ReconciliationMode,
): Promise<ReconciliationAccountRow> {
  const status = await readConnectPayoutConfigurationStatus(
    account.stripeAccountId,
    account.bankPayoutSchedule,
  );

  const readErr = status.accountRetrieveError;
  const stripeAccountReadError =
    readErr?.stripeType || readErr?.stripeCode
      ? `${readErr.stripeType ?? "?"}:${readErr.stripeCode ?? "?"}`
      : null;

  const settlementDecision = decideConnectSettlement({
    keyMode: stripeSecretKeyMode(),
    livemode: status.stripeAccountLivemode,
    country: status.stripeAccountCountry,
    accountType: status.stripeAccountType,
    stripeDashboardType: status.stripeDashboardType,
    settlement: status.settlement,
  });
  const settlementNeedsApply = settlementDecision.needsBalanceSettingsWrite;
  const settlementInvestigation =
    settlementDecision.state === "eligibility_unknown" ||
    settlementDecision.state === "delay_mismatch" ||
    settlementDecision.state === "unverified";

  const proposed = proposedActionsForAccount({
    confirmedScheduleDrift: status.scheduleDrift,
    settlementAction: settlementDecision.action,
    settlementNeedsApply,
    stripeScheduleReadable: status.stripeScheduleReadable,
  });

  const needsVerifiedMutation =
    status.stripeScheduleReadable && (status.scheduleDrift || settlementNeedsApply);

  const baseRow = {
    kind: account.kind,
    careTipIdSuffix: suffix(account.careTipId),
    stripeAccountSuffix: suffix(account.stripeAccountId),
    careTipSchedule: account.bankPayoutSchedule,
    stripeScheduleInterval: status.stripeScheduleInterval,
    stripeScheduleReadable: status.stripeScheduleReadable,
    scheduleDrift: status.scheduleDrift,
    settlementSource: status.settlement.source,
    effectiveSettlementDelayDays: status.settlement.effectiveDelayDays,
    proposedActions: proposed,
    expectedStripeInterval: expectedStripeIntervalForCareTipSchedule(account.bankPayoutSchedule),
    settlementDelayDaysOverride: status.settlement.delayDaysOverride,
    stripeAccountReadError,
    stripeAccountReadErrorClass: status.stripeScheduleReadable
      ? null
      : status.accountRetrieveErrorClass,
  };

  const pendingLedger =
    account.kind === "business"
      ? await businessHasPendingScheduledPayoutLedger(account.careTipId)
      : await employeeHasPendingScheduledPayoutLedger(account.careTipId);

  if (pendingLedger) {
    return {
      ...baseRow,
      disposition: "skipped_pending_ledger",
      skipReason: "pending_scheduled_payout_ledger",
      policyDiagnostics: null,
    };
  }

  if (!status.stripeScheduleReadable) {
    return {
      ...baseRow,
      disposition: "blocked_unverified_account",
      skipReason: stripeAccountReadError ?? "stripe_schedule_unreadable",
      policyDiagnostics: null,
    };
  }

  if (!needsVerifiedMutation && settlementInvestigation) {
    return {
      ...baseRow,
      disposition: "needs_investigation",
      skipReason: settlementDecision.message,
      policyDiagnostics: null,
    };
  }

  if (!needsVerifiedMutation) {
    return {
      ...baseRow,
      disposition: "already_correct",
      skipReason: null,
      policyDiagnostics: null,
    };
  }

  if (mode === "dry_run") {
    return {
      ...baseRow,
      disposition: status.scheduleDrift ? "confirmed_schedule_drift" : "would_update",
      skipReason: null,
      policyDiagnostics: null,
    };
  }

  if (!status.stripeScheduleReadable) {
    return {
      ...baseRow,
      disposition: "blocked_unverified_account",
      skipReason: "stripe_schedule_unreadable",
      policyDiagnostics: null,
    };
  }

  try {
    const policy = await applyConnectPayoutPolicy({
      stripeAccountId: account.stripeAccountId,
      careTipSchedule: account.bankPayoutSchedule,
      context: "reconciliation",
    });
    const diagnostics = connectPayoutPolicyDiagnostics(policy);
    if (policy.schedule.status === "skipped_unverified_account") {
      return {
        ...baseRow,
        disposition: "blocked_unverified_account",
        skipReason: policy.schedule.message,
        policyDiagnostics: diagnostics,
      };
    }
    const failed = !policy.policyComplete;
    const skipReason = failed
      ? policy.schedule.status === "failed"
        ? policy.schedule.message
        : policy.settlement?.message ?? policy.schedule.message
      : null;
    return {
      ...baseRow,
      disposition: failed ? "failed" : "updated",
      skipReason,
      policyDiagnostics: diagnostics,
    };
  } catch {
    return {
      ...baseRow,
      disposition: "failed",
      skipReason: "apply_threw",
      policyDiagnostics: null,
    };
  }
}

export type ReconciliationRunOptions = {
  mode: ReconciliationMode;
  pilotBusinessId?: string | null;
  pilotEmployeeId?: string | null;
};

export async function runConnectPayoutConfigReconciliation(
  opts: ReconciliationRunOptions,
): Promise<ReconciliationReport> {
  const rows: ReconciliationAccountRow[] = [];
  const enumerationSkippedRows: SkippedConnectAccount[] = [];

  const emptyCounts = {
    wouldUpdate: 0,
    updated: 0,
    alreadyCorrect: 0,
    confirmedScheduleDrift: 0,
    blockedUnverified: 0,
    skippedPendingLedger: 0,
    needsInvestigation: 0,
    failed: 0,
  };

  if (!isStripeConfigured()) {
    return {
      mode: opts.mode,
      stripeKeyMode: stripeSecretKeyMode(),
      discovered: 0,
      eligible: 0,
      enumerationSkipped: 0,
      processed: 0,
      ...emptyCounts,
      skippedNotEligible: 0,
      rows: [],
      enumerationSkippedRows: [],
    };
  }

  const [biz, emp] = await Promise.all([
    enumerateAllEligibleBusinessConnectAccounts({ pilotBusinessId: opts.pilotBusinessId }),
    enumerateAllEligibleEmployeeConnectAccounts({ pilotEmployeeId: opts.pilotEmployeeId }),
  ]);

  enumerationSkippedRows.push(...biz.skipped, ...emp.skipped);
  const accounts: EligibleConnectAccount[] = [...biz.eligible, ...emp.eligible];
  const discovered = accounts.length + enumerationSkippedRows.length;

  for (const account of accounts) {
    rows.push(await processReconciliationAccount(account, opts.mode));
  }

  const counts = { ...emptyCounts };
  for (const row of rows) {
    if (row.disposition === "would_update") counts.wouldUpdate += 1;
    if (row.disposition === "updated") counts.updated += 1;
    if (row.disposition === "already_correct") counts.alreadyCorrect += 1;
    if (row.disposition === "confirmed_schedule_drift") counts.confirmedScheduleDrift += 1;
    if (row.disposition === "blocked_unverified_account") counts.blockedUnverified += 1;
    if (row.disposition === "skipped_pending_ledger") counts.skippedPendingLedger += 1;
    if (row.disposition === "needs_investigation") counts.needsInvestigation += 1;
    if (row.disposition === "failed") counts.failed += 1;
  }

  return {
    mode: opts.mode,
    stripeKeyMode: stripeSecretKeyMode(),
    discovered,
    eligible: accounts.length,
    enumerationSkipped: enumerationSkippedRows.length,
    processed: rows.length,
    wouldUpdate: counts.wouldUpdate,
    updated: counts.updated,
    alreadyCorrect: counts.alreadyCorrect,
    confirmedScheduleDrift: counts.confirmedScheduleDrift,
    blockedUnverified: counts.blockedUnverified,
    skippedPendingLedger: counts.skippedPendingLedger,
    needsInvestigation: counts.needsInvestigation,
    skippedNotEligible: enumerationSkippedRows.length,
    failed: counts.failed,
    rows,
    enumerationSkippedRows,
  };
}

export function formatReconciliationReportForLog(report: ReconciliationReport): string {
  const lines = [
    `mode=${report.mode} keyMode=${report.stripeKeyMode} discovered=${report.discovered} eligible=${report.eligible} enumSkipped=${report.enumerationSkipped} processed=${report.processed}`,
    `confirmedDrift=${report.confirmedScheduleDrift} wouldUpdate=${report.wouldUpdate} updated=${report.updated} alreadyCorrect=${report.alreadyCorrect} needsInvestigation=${report.needsInvestigation} blockedUnverified=${report.blockedUnverified} skippedLedger=${report.skippedPendingLedger} failed=${report.failed}`,
  ];
  for (const skip of report.enumerationSkippedRows) {
    lines.push(
      `enum_skip kind=${skip.kind} careTip=${suffix(skip.careTipId)} reason=${skip.reason}`,
    );
  }
  for (const row of report.rows) {
    const settlementLabel =
      row.settlementSource === "unavailable"
        ? "unavailable"
        : row.effectiveSettlementDelayDays != null
          ? String(row.effectiveSettlementDelayDays)
          : "unknown";
    const stripeIv = row.stripeScheduleReadable
      ? (row.stripeScheduleInterval ?? "null")
      : "unreadable";
    const readErr = row.stripeAccountReadError ? ` stripeReadError=${row.stripeAccountReadError}` : "";
    const errClass = row.stripeAccountReadErrorClass
      ? ` readErrorClass=${row.stripeAccountReadErrorClass}`
      : "";
    const override =
      row.settlementDelayDaysOverride != null
        ? ` settlementOverride=${row.settlementDelayDaysOverride}`
        : "";
    lines.push(
      `${row.kind} careTip=${row.careTipIdSuffix} acct=${row.stripeAccountSuffix} careTipSchedule=${row.careTipSchedule} expectedStripe=${row.expectedStripeInterval} stripeInterval=${stripeIv} disposition=${row.disposition} confirmedDrift=${row.scheduleDrift} settlement=${settlementLabel}(${row.settlementSource})${override}${readErr}${errClass} actions=${row.proposedActions.join("|")}`,
    );
  }
  return lines.join("\n");
}

export { connectPayoutPolicyDiagnostics };
