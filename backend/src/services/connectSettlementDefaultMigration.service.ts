/**
 * Inventory and optional clear of redundant test-mode settlement overrides.
 * Does not create payouts, change payout intervals, or touch live accounts.
 *
 * Stripe's AI assistant says an empty-string clear returns the lowest available default,
 * expected to be 3 business days for eligible German Express accounts. Risk criteria can
 * leave another delay. That statement is not a read of CareTip accounts. An explicit
 * override hides the default underneath it, so those accounts stay excluded until a
 * read can show the default. Success is only
 * a following Balance Settings read with no override and effective delay 3. A failed
 * read-back is reported and not repaired by writing override 3 again.
 */
import { prisma } from "../prisma.js";
import { isStripeConnectedAccountId } from "./stripeConnect.service.js";
import {
  STRIPE_CONNECT_DE_SETTLEMENT_DELAY_DAYS_OVERRIDE,
  STRIPE_SETTLEMENT_DELAY_DAYS_OVERRIDE_CLEAR,
} from "../config/stripeBalanceSettings.js";
import type { SettlementDelayReadDto } from "./connectPayoutPolicy.types.js";
import {
  classifyConnectDashboard,
  postSettlementDelayDaysOverride,
  readConnectedAccountSettlementContext,
} from "./stripeConnectBalanceSettings.service.js";
import { stripeSecretKeyMode, type StripeSecretKeyMode } from "../utils/stripeKeyMode.js";
import { logServerError } from "../utils/httpErrors.js";

export type SettlementMigrationKind = "business" | "employee";

export type StoredConnectAccountRef = {
  kind: SettlementMigrationKind;
  careTipId: string;
  stripeAccountId: string;
};

export type SettlementMigrationDisposition =
  | "already_default"
  | "candidate"
  | "excluded"
  | "migrated"
  | "failed"
  | "not_attempted";

export type SettlementMigrationAssessment = {
  stripeAccountId: string;
  careTipKind: SettlementMigrationKind;
  careTipIdSuffix: string;
  mode: "test" | "live" | "unknown";
  country: string | null;
  accountType: string | null;
  stripeDashboardType: string | null;
  override: number | null;
  effectiveDelayDays: number | null;
  eligibilityConfirmed: boolean;
  safeToMigrate: boolean;
  disposition: SettlementMigrationDisposition;
  reason: string;
};

export type SettlementMigrationReport = {
  mode: "dry_run" | "apply";
  stripeKeyMode: StripeSecretKeyMode;
  writesEnabled: boolean;
  inspected: number;
  alreadyDefault: number;
  candidates: number;
  excluded: number;
  migrated: number;
  failed: number;
  notAttempted: number;
  rows: SettlementMigrationAssessment[];
  blocker: string | null;
};

const PAGE = 100;

function suffix(id: string): string {
  return id.length <= 8 ? "(short)" : `…${id.slice(-8)}`;
}

function platformDefaultObserved(settlement: SettlementDelayReadDto): boolean {
  const target = STRIPE_CONNECT_DE_SETTLEMENT_DELAY_DAYS_OVERRIDE;
  return (
    settlement.source === "balance_settings" &&
    settlement.settlementOverrideRecognized !== false &&
    settlement.delayDaysOverride == null &&
    settlement.delayDays === target &&
    settlement.effectiveDelayDays === target
  );
}

function explicitOverrideT3(settlement: SettlementDelayReadDto): boolean {
  const target = STRIPE_CONNECT_DE_SETTLEMENT_DELAY_DAYS_OVERRIDE;
  return (
    settlement.source === "balance_settings" &&
    settlement.settlementOverrideRecognized !== false &&
    settlement.delayDaysOverride === target &&
    settlement.effectiveDelayDays === target
  );
}

export function assessSettlementMigrationAccount(args: {
  kind: SettlementMigrationKind;
  careTipId: string;
  stripeAccountId: string;
  keyMode: StripeSecretKeyMode;
  livemode: boolean | null;
  country: string | null;
  accountType: string | null;
  stripeDashboardType?: string | null;
  settlement: SettlementDelayReadDto | null;
}): SettlementMigrationAssessment {
  const base = {
    stripeAccountId: args.stripeAccountId,
    careTipKind: args.kind,
    careTipIdSuffix: suffix(args.careTipId),
    country: args.country,
    accountType: args.accountType,
    stripeDashboardType: args.stripeDashboardType ?? null,
    override: args.settlement?.delayDaysOverride ?? null,
    effectiveDelayDays: args.settlement?.effectiveDelayDays ?? null,
    eligibilityConfirmed: false,
    safeToMigrate: false,
  };

  if (args.keyMode !== "test" || args.livemode !== false) {
    const live = args.keyMode === "live" || args.livemode === true;
    return {
      ...base,
      mode: live ? "live" : "unknown",
      disposition: "excluded",
      reason: live ? "live_account_excluded" : "key_account_mode_mismatch",
    };
  }

  const testBase = { ...base, mode: "test" as const };
  if (!args.settlement || args.settlement.source !== "balance_settings" || args.settlement.settlementOverrideRecognized === false) {
    return { ...testBase, disposition: "excluded", reason: "balance_settings_incomplete" };
  }
  const country = (args.country ?? "").trim().toLowerCase();
  if (country !== "de") {
    return { ...testBase, disposition: "excluded", reason: "country_outside_confirmed_scope" };
  }
  const dashboard = classifyConnectDashboard({
    accountType: args.accountType,
    stripeDashboardType: args.stripeDashboardType,
  });
  if (dashboard === "unknown") {
    return { ...testBase, disposition: "excluded", reason: "account_dashboard_unconfirmed" };
  }
  if (dashboard !== "express") {
    return { ...testBase, disposition: "excluded", reason: "account_not_express" };
  }
  if (args.kind === "employee") {
    return {
      ...testBase,
      disposition: "excluded",
      reason: "employee_recipient_only_eligibility_unconfirmed",
    };
  }
  if (platformDefaultObserved(args.settlement)) {
    return {
      ...testBase,
      disposition: "already_default",
      reason: "inherits_platform_default_t3",
    };
  }
  if (explicitOverrideT3(args.settlement)) {
    return {
      ...testBase,
      disposition: "excluded",
      reason: "underlying_default_hidden_by_override",
    };
  }
  return {
    ...testBase,
    disposition: "excluded",
    reason: "effective_delay_not_confirmed_t3",
  };
}

async function listStoredConnectAccounts(): Promise<StoredConnectAccountRef[]> {
  const out: StoredConnectAccountRef[] = [];
  let businessCursor: string | undefined;
  for (;;) {
    const batch = await prisma.business.findMany({
      where: { deletedAt: null, stripeAccountId: { not: null } },
      select: { id: true, stripeAccountId: true },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(businessCursor ? { skip: 1, cursor: { id: businessCursor } } : {}),
    });
    if (batch.length === 0) break;
    businessCursor = batch[batch.length - 1]?.id;
    for (const row of batch) {
      const stripeAccountId = row.stripeAccountId?.trim() ?? "";
      if (!isStripeConnectedAccountId(stripeAccountId)) continue;
      out.push({ kind: "business", careTipId: row.id, stripeAccountId });
    }
    if (batch.length < PAGE) break;
  }

  let employeeCursor: string | undefined;
  for (;;) {
    const batch = await prisma.employeeStripeAccount.findMany({
      select: { employeeId: true, stripeAccountId: true },
      orderBy: { employeeId: "asc" },
      take: PAGE,
      ...(employeeCursor ? { skip: 1, cursor: { employeeId: employeeCursor } } : {}),
    });
    if (batch.length === 0) break;
    employeeCursor = batch[batch.length - 1]?.employeeId;
    for (const row of batch) {
      const stripeAccountId = row.stripeAccountId?.trim() ?? "";
      if (!isStripeConnectedAccountId(stripeAccountId)) continue;
      out.push({ kind: "employee", careTipId: row.employeeId, stripeAccountId });
    }
    if (batch.length < PAGE) break;
  }
  return out;
}

function counts(rows: SettlementMigrationAssessment[]): Omit<
  SettlementMigrationReport,
  "mode" | "stripeKeyMode" | "writesEnabled" | "rows" | "blocker" | "inspected"
> {
  return {
    alreadyDefault: rows.filter((row) => row.disposition === "already_default").length,
    candidates: rows.filter((row) => row.disposition === "candidate").length,
    excluded: rows.filter((row) => row.disposition === "excluded").length,
    migrated: rows.filter((row) => row.disposition === "migrated").length,
    failed: rows.filter((row) => row.disposition === "failed").length,
    notAttempted: rows.filter((row) => row.disposition === "not_attempted").length,
  };
}

function verificationFailureReason(settlement: SettlementDelayReadDto | null): string {
  if (!settlement) return "verification_read_failed_manual_review";
  const override = settlement.delayDaysOverride == null ? "absent" : String(settlement.delayDaysOverride);
  const effective = settlement.effectiveDelayDays == null ? "unknown" : String(settlement.effectiveDelayDays);
  return `verification_failed_override_${override}_effective_${effective}_manual_review`;
}

async function clearAndVerify(stripeAccountId: string): Promise<{
  ok: boolean;
  settlement: SettlementDelayReadDto | null;
  reason: string;
}> {
  await postSettlementDelayDaysOverride(stripeAccountId, STRIPE_SETTLEMENT_DELAY_DAYS_OVERRIDE_CLEAR);
  try {
    const after = await readConnectedAccountSettlementContext(stripeAccountId);
    if (platformDefaultObserved(after.settlement)) {
      return {
        ok: true,
        settlement: after.settlement,
        reason: "override_cleared_effective_delay_still_3",
      };
    }
    return {
      ok: false,
      settlement: after.settlement,
      reason: verificationFailureReason(after.settlement),
    };
  } catch (err) {
    logServerError("settlementDefaultMigration.readback", err, {
      accountSuffix: stripeAccountId.slice(-8),
    });
    return { ok: false, settlement: null, reason: "verification_read_failed_manual_review" };
  }
}

export async function runSettlementDefaultMigration(args: {
  mode: "dry_run" | "apply";
  confirmTestModeClear: boolean;
  confirmBusinessExpressEligibility: boolean;
  accounts?: StoredConnectAccountRef[];
}): Promise<SettlementMigrationReport> {
  const keyMode = stripeSecretKeyMode();
  const writesRequested = args.mode === "apply" && args.confirmTestModeClear && args.confirmBusinessExpressEligibility;
  if (keyMode !== "test") {
    return {
      mode: args.mode,
      stripeKeyMode: keyMode,
      writesEnabled: false,
      inspected: 0,
      alreadyDefault: 0,
      candidates: 0,
      excluded: 0,
      migrated: 0,
      failed: 0,
      notAttempted: 0,
      rows: [],
      blocker: "refusing_non_test_stripe_key",
    };
  }

  const accounts = args.accounts ?? (await listStoredConnectAccounts());
  const rows: SettlementMigrationAssessment[] = [];
  let stopWrites = false;
  const writesEnabled = writesRequested;

  for (const account of accounts) {
    let context: Awaited<ReturnType<typeof readConnectedAccountSettlementContext>>;
    try {
      context = await readConnectedAccountSettlementContext(account.stripeAccountId);
    } catch (err) {
      logServerError("settlementDefaultMigration.read", err, {
        accountSuffix: account.stripeAccountId.slice(-8),
      });
      rows.push({
        stripeAccountId: account.stripeAccountId,
        careTipKind: account.kind,
        careTipIdSuffix: account.careTipId.length <= 8 ? "(short)" : `…${account.careTipId.slice(-8)}`,
        mode: "unknown",
        country: null,
        accountType: null,
        stripeDashboardType: null,
        override: null,
        effectiveDelayDays: null,
        eligibilityConfirmed: false,
        safeToMigrate: false,
        disposition: "excluded",
        reason: "balance_settings_read_failed",
      });
      continue;
    }

    const assessed = assessSettlementMigrationAccount({
      kind: account.kind,
      careTipId: account.careTipId,
      stripeAccountId: account.stripeAccountId,
      keyMode,
      livemode: context.livemode,
      country: context.country,
      accountType: context.type,
      stripeDashboardType: context.stripeDashboardType,
      settlement: context.settlement,
    });

    if (args.mode !== "apply" || !writesEnabled || assessed.disposition !== "candidate" || stopWrites) {
      if (args.mode === "apply" && writesEnabled && assessed.disposition === "candidate" && stopWrites) {
        rows.push({ ...assessed, disposition: "not_attempted", reason: "stopped_after_verification_failure" });
      } else {
        rows.push(assessed);
      }
      continue;
    }

    let again: Awaited<ReturnType<typeof readConnectedAccountSettlementContext>>;
    try {
      again = await readConnectedAccountSettlementContext(account.stripeAccountId);
    } catch (err) {
      logServerError("settlementDefaultMigration.reread", err, {
        accountSuffix: account.stripeAccountId.slice(-8),
      });
      rows.push({ ...assessed, disposition: "failed", reason: "reread_before_clear_failed" });
      stopWrites = true;
      continue;
    }
    const fresh = assessSettlementMigrationAccount({
      kind: account.kind,
      careTipId: account.careTipId,
      stripeAccountId: account.stripeAccountId,
      keyMode,
      livemode: again.livemode,
      country: again.country,
      accountType: again.type,
      stripeDashboardType: again.stripeDashboardType,
      settlement: again.settlement,
    });
    if (fresh.disposition !== "candidate") {
      rows.push(fresh);
      continue;
    }

    try {
      const outcome = await clearAndVerify(account.stripeAccountId);
      if (outcome.ok) {
        rows.push({
          ...fresh,
          override: null,
          effectiveDelayDays: STRIPE_CONNECT_DE_SETTLEMENT_DELAY_DAYS_OVERRIDE,
          eligibilityConfirmed: true,
          disposition: "migrated",
          reason: outcome.reason,
        });
      } else {
        rows.push({
          ...fresh,
          override: outcome.settlement?.delayDaysOverride ?? null,
          effectiveDelayDays: outcome.settlement?.effectiveDelayDays ?? null,
          disposition: "failed",
          reason: outcome.reason,
        });
        stopWrites = true;
      }
    } catch (err) {
      logServerError("settlementDefaultMigration.clear", err, {
        accountSuffix: account.stripeAccountId.slice(-8),
      });
      let observed: SettlementDelayReadDto | null = null;
      try {
        observed = (await readConnectedAccountSettlementContext(account.stripeAccountId)).settlement;
      } catch (readErr) {
        logServerError("settlementDefaultMigration.clear.read_after_error", readErr, {
          accountSuffix: account.stripeAccountId.slice(-8),
        });
      }
      rows.push({
        ...fresh,
        override: observed?.delayDaysOverride ?? fresh.override,
        effectiveDelayDays: observed?.effectiveDelayDays ?? fresh.effectiveDelayDays,
        disposition: "failed",
        reason: observed ? `clear_request_failed_${verificationFailureReason(observed)}` : "clear_request_failed",
      });
      stopWrites = true;
    }
  }

  return {
    mode: args.mode,
    stripeKeyMode: keyMode,
    writesEnabled,
    inspected: rows.length,
    ...counts(rows),
    rows,
    blocker:
      args.mode === "apply" && !writesEnabled
        ? "apply_requires_confirm_test_mode_clear_and_confirm_business_express_eligibility"
        : null,
  };
}

export function formatSettlementMigrationReport(report: SettlementMigrationReport): string {
  const lines = [
    `mode=${report.mode} keyMode=${report.stripeKeyMode} writesEnabled=${report.writesEnabled} inspected=${report.inspected} alreadyDefault=${report.alreadyDefault} candidates=${report.candidates} excluded=${report.excluded} migrated=${report.migrated} failed=${report.failed} notAttempted=${report.notAttempted}`,
  ];
  if (report.blocker) lines.push(`blocker=${report.blocker}`);
  for (const row of report.rows) {
    lines.push(
      [
        `acct=${row.stripeAccountId}`,
        `kind=${row.careTipKind}`,
        `careTip=${row.careTipIdSuffix}`,
        `mode=${row.mode}`,
        `country=${row.country ?? "unknown"}`,
        `type=${row.accountType ?? "unknown"}`,
        `dashboard=${row.stripeDashboardType ?? "absent"}`,
        `override=${row.override == null ? "none" : String(row.override)}`,
        `effective=${row.effectiveDelayDays == null ? "unknown" : String(row.effectiveDelayDays)}`,
        `eligibilityConfirmed=${row.eligibilityConfirmed}`,
        `safeToMigrate=${row.safeToMigrate}`,
        `disposition=${row.disposition}`,
        `reason=${row.reason}`,
      ].join(" "),
    );
  }
  return lines.join("\n");
}
