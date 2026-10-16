/**
 * Orchestrates Stripe Connect bank payout schedule + settlement timing (no payouts.create).
 */
import { BusinessBankPayoutSchedule } from "@prisma/client";
import type Stripe from "stripe";
import type {
  ConnectPayoutPolicyApplyDto,
  SchedulePolicyResultDto,
  SettlementDelayReadDto,
  SettlementPolicyResultDto,
} from "./connectPayoutPolicy.types.js";
import { logServerError } from "../utils/httpErrors.js";
import { stripeKeyModeMatchesAccountLivemode, stripeSecretKeyMode } from "../utils/stripeKeyMode.js";
import {
  stripePayoutScheduleUpdateForPreference,
  syncStripeConnectAccountPayoutSchedule,
} from "./connectBankPayoutSchedule.core.js";
import { readSettlementDelayForConnectedAccount } from "./connectSettlementRead.service.js";
import {
  applyConnectSettlementMinimumDelay,
  type SettlementMinimumApplyResult,
} from "./stripeConnectBalanceSettings.service.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";

export type ConnectPayoutPolicyContext = "account_create" | "schedule_change" | "reconciliation";

let retrieveAccountFn: ((id: string) => Promise<Stripe.Account>) | null = null;

export function __setConnectPayoutPolicyRetrieveAccountForTests(
  fn: ((id: string) => Promise<Stripe.Account>) | null,
): void {
  retrieveAccountFn = fn;
}

async function retrieveAccount(stripeAccountId: string): Promise<Stripe.Account> {
  if (retrieveAccountFn) return retrieveAccountFn(stripeAccountId);
  return getStripeClient().accounts.retrieve(stripeAccountId);
}

export function expectedStripeIntervalForCareTipSchedule(
  schedule: BusinessBankPayoutSchedule,
): string {
  return stripePayoutScheduleUpdateForPreference(schedule).interval ?? "manual";
}

/**
 * Confirmed schedule drift — only when Stripe interval was read successfully.
 * Unknown (unreadable) intervals must not be treated as drift.
 */
export function detectStripeScheduleDrift(
  careTipSchedule: BusinessBankPayoutSchedule,
  stripeInterval: string | null | undefined,
  stripeScheduleReadable: boolean,
): boolean {
  if (!stripeScheduleReadable) return false;
  const expected = expectedStripeIntervalForCareTipSchedule(careTipSchedule);
  const actual = (stripeInterval ?? "").trim() || null;
  return actual !== expected;
}

export type StripeAccountReadErrorClass = "account_unreachable" | "permission_denied" | "transient" | "unknown";

export function classifyConnectAccountRetrieveError(
  err: ConnectAccountStripeReadError | null,
): StripeAccountReadErrorClass {
  if (!err) return "unknown";
  const code = (err.stripeCode ?? "").toLowerCase();
  const type = (err.stripeType ?? "").toLowerCase();
  if (code === "account_invalid") return "account_unreachable";
  if (type.includes("permission") || code.includes("permission")) return "permission_denied";
  if (
    type.includes("connection") ||
    type.includes("api") ||
    code === "rate_limit" ||
    code === "lock_timeout"
  ) {
    return "transient";
  }
  return "unknown";
}

function accountsV1DelayDays(acct: Stripe.Account): number | null {
  const d = acct.settings?.payouts?.schedule?.delay_days;
  return typeof d === "number" ? d : null;
}

export type ConnectAccountStripeReadError = {
  stripeType: string | null;
  stripeCode: string | null;
};

function stripeReadErrorFromUnknown(err: unknown): ConnectAccountStripeReadError {
  if (!err || typeof err !== "object") {
    return { stripeType: null, stripeCode: null };
  }
  const e = err as { type?: unknown; code?: unknown };
  return {
    stripeType: typeof e.type === "string" ? e.type : null,
    stripeCode: typeof e.code === "string" ? e.code : null,
  };
}

export async function readConnectPayoutConfigurationStatus(
  stripeAccountId: string,
  careTipSchedule: BusinessBankPayoutSchedule,
): Promise<{
  stripeScheduleInterval: string | null;
  /** True only when accounts.retrieve succeeded for this run. */
  stripeScheduleReadable: boolean;
  /** Confirmed mismatch after a successful Stripe read — never true when unreadable. */
  scheduleDrift: boolean;
  settlement: SettlementDelayReadDto;
  accountsV1DelayDays: number | null;
  stripeAccountCountry: string | null;
  accountRetrieveError: ConnectAccountStripeReadError | null;
  accountRetrieveErrorClass: StripeAccountReadErrorClass;
}> {
  let stripeScheduleInterval: string | null = null;
  let accountsV1: number | null = null;
  let stripeAccountCountry: string | null = null;
  let accountRetrieveError: ConnectAccountStripeReadError | null = null;
  let stripeScheduleReadable = false;
  if (isStripeConfigured() || retrieveAccountFn) {
    try {
      const acct = await retrieveAccount(stripeAccountId);
      stripeScheduleInterval = acct.settings?.payouts?.schedule?.interval ?? null;
      accountsV1 = accountsV1DelayDays(acct);
      stripeAccountCountry = acct.country ?? null;
      stripeScheduleReadable = true;
    } catch (err) {
      accountRetrieveError = stripeReadErrorFromUnknown(err);
      logServerError("connectPayoutConfiguration.retrieveAccount", err, {
        accountSuffix: stripeAccountId.slice(-8),
      });
    }
  }

  const settlement = await readSettlementDelayForConnectedAccount({
    stripeAccountId,
    accountsV1DelayDays: accountsV1,
  });

  return {
    stripeScheduleInterval,
    stripeScheduleReadable,
    scheduleDrift: detectStripeScheduleDrift(
      careTipSchedule,
      stripeScheduleInterval,
      stripeScheduleReadable,
    ),
    settlement,
    accountsV1DelayDays: accountsV1,
    stripeAccountCountry,
    accountRetrieveError,
    accountRetrieveErrorClass: classifyConnectAccountRetrieveError(accountRetrieveError),
  };
}

function settlementSyncRequested(context: ConnectPayoutPolicyContext): boolean {
  const raw = process.env.STRIPE_CONNECT_SETTLEMENT_MINIMUM_ON_CREATE?.trim().toLowerCase();
  if (context === "reconciliation") return true;
  // Payout interval changes must not be blocked by settlement timing apply (reconciliation / account_create handle DE override).
  if (context === "schedule_change") return false;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

function mapSettlementResult(r: SettlementMinimumApplyResult): SettlementPolicyResultDto {
  return {
    status: r.status,
    message: r.message,
    before: r.before,
    after: r.after,
    stripeSupportMayBeRequired: r.stripeSupportMayBeRequired,
  };
}

function isSettlementOutcomeAcceptable(status: SettlementPolicyResultDto["status"]): boolean {
  return (
    status === "settlement_configured" ||
    status === "settlement_unchanged" ||
    status === "settlement_reset" ||
    status === "already_at_account_default" ||
    status === "skipped_ineligible" ||
    status === "skipped_disabled"
  );
}

function buildPolicyComplete(
  schedule: SchedulePolicyResultDto,
  settlement: SettlementPolicyResultDto | null,
): boolean {
  if (schedule.status !== "schedule_synced" && schedule.status !== "schedule_unchanged") {
    return false;
  }
  if (!settlement) return true;
  return isSettlementOutcomeAcceptable(settlement.status);
}

/**
 * Sync Stripe payout interval from CareTip preference and optionally apply DE settlement override (delay_days_override = 3).
 */
export async function applyConnectPayoutPolicy(args: {
  stripeAccountId: string;
  careTipSchedule: BusinessBankPayoutSchedule;
  context: ConnectPayoutPolicyContext;
  syncSchedule?: boolean;
  attemptSettlementMinimum?: boolean;
}): Promise<ConnectPayoutPolicyApplyDto> {
  const syncSchedule = args.syncSchedule !== false;
  const attemptSettlement =
    args.attemptSettlementMinimum ?? settlementSyncRequested(args.context);

  const expected = expectedStripeIntervalForCareTipSchedule(args.careTipSchedule);

  const scheduleFailed = (message: string, status: SchedulePolicyResultDto["status"]): ConnectPayoutPolicyApplyDto => {
    const schedule: SchedulePolicyResultDto = {
      status,
      message,
      expectedStripeInterval: expected,
      verifiedStripeInterval: null,
      scheduleDrift: false,
    };
    return {
      schedule,
      settlement: null,
      policyComplete: false,
    };
  };

  if (!isStripeConfigured() && !retrieveAccountFn) {
    return scheduleFailed("stripe_not_configured", "skipped_not_configured");
  }

  let verifiedStripeInterval: string | null = null;
  let accountsV1: number | null = null;

  try {
    const acct = await retrieveAccount(args.stripeAccountId);
    const accountLive =
      typeof (acct as unknown as { livemode?: unknown }).livemode === "boolean"
        ? (acct as unknown as { livemode: boolean }).livemode
        : false;
    accountsV1 = accountsV1DelayDays(acct);
    verifiedStripeInterval = acct.settings?.payouts?.schedule?.interval ?? null;
    if (!stripeKeyModeMatchesAccountLivemode(accountLive)) {
      return {
        schedule: {
          status: "skipped_key_mode_mismatch",
          message: "stripe_secret_key_mode_mismatch",
          expectedStripeInterval: expected,
          verifiedStripeInterval,
          scheduleDrift: detectStripeScheduleDrift(
            args.careTipSchedule,
            verifiedStripeInterval,
            true,
          ),
        },
        settlement: null,
        policyComplete: false,
      };
    }
  } catch (err) {
    const readErr = stripeReadErrorFromUnknown(err);
    logServerError("connectPayoutConfiguration.preflight", err, {
      accountSuffix: args.stripeAccountId.slice(-8),
    });
    const unverifiedMessage = `stripe_account_unreadable:${readErr.stripeCode ?? readErr.stripeType ?? "unknown"}`;
    return {
      schedule: {
        status: "skipped_unverified_account",
        message: unverifiedMessage,
        expectedStripeInterval: expected,
        verifiedStripeInterval: null,
        scheduleDrift: false,
      },
      settlement: attemptSettlement
        ? {
            status: "skipped_unverified_account",
            message: unverifiedMessage,
            before: null,
            after: null,
            stripeSupportMayBeRequired: false,
          }
        : null,
      policyComplete: false,
    };
  }

  let scheduleStatus: SchedulePolicyResultDto["status"] = "failed";
  let scheduleMessage = "schedule_sync_failed";

  if (syncSchedule) {
    const driftBefore = detectStripeScheduleDrift(
      args.careTipSchedule,
      verifiedStripeInterval,
      true,
    );
    if (!driftBefore) {
      scheduleStatus = "schedule_unchanged";
      scheduleMessage = "stripe_interval_already_matches_preference";
    } else {
      try {
        await syncStripeConnectAccountPayoutSchedule(args.stripeAccountId, args.careTipSchedule);
        const after = await retrieveAccount(args.stripeAccountId);
        verifiedStripeInterval = after.settings?.payouts?.schedule?.interval ?? null;
        const stillDrift = detectStripeScheduleDrift(
          args.careTipSchedule,
          verifiedStripeInterval,
          true,
        );
        if (stillDrift) {
          scheduleStatus = "failed";
          scheduleMessage = "schedule_readback_drift";
        } else {
          scheduleStatus = "schedule_synced";
          scheduleMessage = "stripe_interval_updated";
        }
      } catch (err) {
        scheduleStatus = "failed";
        scheduleMessage = "schedule_sync_failed";
        logServerError("connectPayoutConfiguration.scheduleSync", err, {
          accountSuffix: args.stripeAccountId.slice(-8),
          schedule: args.careTipSchedule,
        });
      }
    }
  } else {
    scheduleStatus = "schedule_unchanged";
    scheduleMessage = "schedule_sync_not_requested";
  }

  const schedule: SchedulePolicyResultDto = {
    status: scheduleStatus,
    message: scheduleMessage,
    expectedStripeInterval: expected,
    verifiedStripeInterval,
    scheduleDrift: detectStripeScheduleDrift(
      args.careTipSchedule,
      verifiedStripeInterval,
      true,
    ),
  };

  let settlement: SettlementPolicyResultDto | null = null;
  const scheduleOk =
    schedule.status === "schedule_synced" || schedule.status === "schedule_unchanged";

  if (attemptSettlement && scheduleOk) {
    settlement = mapSettlementResult(
      await applyConnectSettlementMinimumDelay(args.stripeAccountId, accountsV1),
    );
  } else if (attemptSettlement && !scheduleOk) {
    settlement = {
      status: "skipped_schedule_not_synced",
      message: "settlement_skipped_schedule_not_synced",
      before: null,
      after: null,
      stripeSupportMayBeRequired: false,
    };
  }

  return {
    schedule,
    settlement,
    policyComplete: buildPolicyComplete(schedule, settlement),
  };
}

export function connectPayoutPolicyDiagnostics(result: ConnectPayoutPolicyApplyDto): Record<string, unknown> {
  return {
    scheduleStatus: result.schedule.status,
    scheduleMessage: result.schedule.message,
    expectedStripeInterval: result.schedule.expectedStripeInterval,
    verifiedStripeInterval: result.schedule.verifiedStripeInterval,
    scheduleDrift: result.schedule.scheduleDrift,
    settlementStatus: result.settlement?.status ?? null,
    settlementMessage: result.settlement?.message ?? null,
    policyComplete: result.policyComplete,
    stripeKeyMode: stripeSecretKeyMode(),
  };
}

/** @deprecated Use ConnectPayoutPolicyApplyDto */
export type ConnectPayoutPolicyResult = ConnectPayoutPolicyApplyDto;
