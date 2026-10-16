/**
 * Read-only / update settlement timing via Stripe Balance Settings API.
 * Never calls payouts.create or mutates bank details.
 */
import type Stripe from "stripe";
import {
  STRIPE_BALANCE_SETTINGS_API_VERSION,
  STRIPE_BALANCE_SETTINGS_PATH,
  connectSettlementDelayDaysOverrideTarget,
} from "../config/stripeBalanceSettings.js";
import type { SettlementPolicyStatus } from "./connectPayoutPolicy.types.js";
import {
  readSettlementDelayForConnectedAccount,
  settlementReadFromBalanceSettings,
  settlementReadUnavailable,
} from "./connectSettlementRead.service.js";
import type { SettlementDelayReadDto } from "./connectPayoutPolicy.types.js";
import { logServerError } from "../utils/httpErrors.js";
import { stripeKeyModeMatchesAccountLivemode } from "../utils/stripeKeyMode.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";

export type ConnectBalanceSettingsSnapshot = {
  payoutInterval: string | null;
  delayDays: number | null;
  delayDaysOverride: number | null;
  effectiveSettlementDelayDays: number | null;
  debitNegativeBalances: boolean | null;
};

export type SettlementMinimumApplyResult = {
  status: SettlementPolicyStatus;
  message: string;
  before: SettlementDelayReadDto | null;
  after: SettlementDelayReadDto | null;
  stripeSupportMayBeRequired: boolean;
};

type RawRequestFn = (
  method: string,
  path: string,
  data?: unknown,
  options?: Stripe.RawRequestOptions,
) => Promise<unknown>;

let rawRequestFn: RawRequestFn | null = null;
let retrieveAccountLivemodeFn:
  | ((id: string) => Promise<{ livemode: boolean; country?: string | null }>)
  | null = null;

export function __setConnectBalanceSettingsRawRequestForTests(fn: RawRequestFn | null): void {
  rawRequestFn = fn;
}

export function __setConnectBalanceSettingsRetrieveAccountForTests(
  fn: ((id: string) => Promise<{ livemode: boolean; country?: string | null }>) | null,
): void {
  retrieveAccountLivemodeFn = fn;
}

function balanceSettingsOptions(stripeAccountId: string): Stripe.RawRequestOptions {
  return {
    stripeAccount: stripeAccountId,
    apiVersion: STRIPE_BALANCE_SETTINGS_API_VERSION,
  };
}

async function rawBalanceRequest(
  method: string,
  stripeAccountId: string,
  data?: unknown,
): Promise<unknown> {
  const options = balanceSettingsOptions(stripeAccountId);
  if (rawRequestFn) return rawRequestFn(method, STRIPE_BALANCE_SETTINGS_PATH, data, options);
  if (!isStripeConfigured()) {
    throw new Error("STRIPE_NOT_CONFIGURED");
  }
  return getStripeClient().rawRequest(
    method,
    STRIPE_BALANCE_SETTINGS_PATH,
    data as { [key: string]: unknown } | undefined,
    options,
  );
}

function parseDelayDays(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  return null;
}

export function parseConnectBalanceSettingsPayload(payload: unknown): ConnectBalanceSettingsSnapshot {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const payments =
    root.payments && typeof root.payments === "object"
      ? (root.payments as Record<string, unknown>)
      : {};
  const payouts =
    payments.payouts && typeof payments.payouts === "object"
      ? (payments.payouts as Record<string, unknown>)
      : {};
  const schedule =
    payouts.schedule && typeof payouts.schedule === "object"
      ? (payouts.schedule as Record<string, unknown>)
      : {};
  const settlement =
    payments.settlement_timing && typeof payments.settlement_timing === "object"
      ? (payments.settlement_timing as Record<string, unknown>)
      : {};

  const delayDays = parseDelayDays(settlement.delay_days);
  const delayDaysOverride = parseDelayDays(settlement.delay_days_override);
  const effective =
    delayDaysOverride != null ? delayDaysOverride : delayDays != null ? delayDays : null;

  const interval = typeof schedule.interval === "string" ? schedule.interval : null;
  const debit =
    payments.debit_negative_balances === true
      ? true
      : payments.debit_negative_balances === false
        ? false
        : null;

  return {
    payoutInterval: interval,
    delayDays,
    delayDaysOverride,
    effectiveSettlementDelayDays: effective,
    debitNegativeBalances: debit,
  };
}

export async function retrieveConnectBalanceSettings(
  stripeAccountId: string,
): Promise<ConnectBalanceSettingsSnapshot> {
  const payload = await rawBalanceRequest("GET", stripeAccountId);
  return parseConnectBalanceSettingsPayload(payload);
}

/** Whether Balance Settings read-back matches the Stripe-confirmed DE settlement override target. */
export function connectSettlementMatchesConfirmedTarget(
  settlement: SettlementDelayReadDto,
  country: string | null | undefined,
): boolean {
  const target = connectSettlementDelayDaysOverrideTarget(country);
  if (target == null) return true;
  return settlement.delayDaysOverride === target && settlement.effectiveDelayDays === target;
}

export function connectSettlementNeedsConfirmedTargetApply(
  settlement: SettlementDelayReadDto,
  country: string | null | undefined,
): boolean {
  const target = connectSettlementDelayDaysOverrideTarget(country);
  if (target == null) return false;
  return !connectSettlementMatchesConfirmedTarget(settlement, country);
}

function settlementMinimumSyncEnabled(): boolean {
  const raw = process.env.STRIPE_CONNECT_SETTLEMENT_MINIMUM_SYNC?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

function isPermanentSettlementConfigError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message =
    typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message.toLowerCase()
      : "";
  if (message.includes("cannot lower") && message.includes("delay")) return true;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") {
    return (
      code === "balance_settings_invalid_parameter" ||
      code === "parameter_unknown" ||
      code.includes("not_allowed") ||
      code.includes("permission")
    );
  }
  const status = (err as { statusCode?: unknown }).statusCode;
  return status === 403;
}

async function readBefore(
  stripeAccountId: string,
  accountsV1DelayDays: number | null,
): Promise<{ settlement: SettlementDelayReadDto; snapshot: ConnectBalanceSettingsSnapshot | null }> {
  try {
    const snap = await retrieveConnectBalanceSettings(stripeAccountId);
    return { settlement: settlementReadFromBalanceSettings(snap), snapshot: snap };
  } catch {
    const settlement = await readSettlementDelayForConnectedAccount({
      stripeAccountId,
      accountsV1DelayDays,
    });
    return { settlement, snapshot: null };
  }
}

function settlementReadBackMatchesTarget(
  after: SettlementDelayReadDto,
  snapshot: ConnectBalanceSettingsSnapshot | null,
  targetOverride: number,
): boolean {
  if (after.delayDaysOverride !== targetOverride) return false;
  if (after.effectiveDelayDays !== targetOverride) return false;
  if (snapshot?.payoutInterval != null && snapshot.payoutInterval !== "daily") return false;
  return true;
}

/**
 * Apply Stripe Support–confirmed DE settlement timing: delay_days_override = 3 (business days).
 * Verifies read-back; never reports success without Stripe confirming override and effective delay.
 */
export async function applyConnectSettlementMinimumDelay(
  stripeAccountId: string,
  accountsV1DelayDays: number | null = null,
): Promise<SettlementMinimumApplyResult> {
  if (!settlementMinimumSyncEnabled()) {
    return {
      status: "skipped_disabled",
      message: "STRIPE_CONNECT_SETTLEMENT_MINIMUM_SYNC is disabled",
      before: null,
      after: null,
      stripeSupportMayBeRequired: false,
    };
  }

  let before: SettlementDelayReadDto;
  let beforeSnap: ConnectBalanceSettingsSnapshot | null;
  try {
    const read = await readBefore(stripeAccountId, accountsV1DelayDays);
    before = read.settlement;
    beforeSnap = read.snapshot;
  } catch (err) {
    logServerError("stripeConnectBalanceSettings.retrieve.before", err, {
      accountSuffix: stripeAccountId.slice(-8),
    });
    return {
      status: "failed",
      message: "balance_settings_retrieve_failed",
      before: settlementReadUnavailable(),
      after: null,
      stripeSupportMayBeRequired: false,
    };
  }

  let accountCountry: string | null = null;
  try {
    const acct = retrieveAccountLivemodeFn
      ? await retrieveAccountLivemodeFn(stripeAccountId)
      : await getStripeClient().accounts.retrieve(stripeAccountId);
    const accountLive =
      typeof (acct as unknown as { livemode?: unknown }).livemode === "boolean"
        ? (acct as unknown as { livemode: boolean }).livemode
        : false;
    const countryField = (acct as Stripe.Account).country;
    accountCountry = typeof countryField === "string" ? countryField : null;
    if (!stripeKeyModeMatchesAccountLivemode(accountLive)) {
      return {
        status: "skipped_key_mode_mismatch",
        message: "stripe_secret_key_mode_mismatch",
        before,
        after: null,
        stripeSupportMayBeRequired: false,
      };
    }
  } catch (err) {
    logServerError("stripeConnectBalanceSettings.account.livemode", err, {
      accountSuffix: stripeAccountId.slice(-8),
    });
    return {
      status: "failed",
      message: "account_retrieve_failed",
      before,
      after: null,
      stripeSupportMayBeRequired: false,
    };
  }

  const targetOverride = connectSettlementDelayDaysOverrideTarget(accountCountry);
  if (targetOverride == null) {
    return {
      status: "skipped_ineligible",
      message: "settlement_override_target_not_configured_for_country",
      before,
      after: before,
      stripeSupportMayBeRequired: false,
    };
  }

  if (connectSettlementMatchesConfirmedTarget(before, accountCountry)) {
    if (beforeSnap?.payoutInterval != null && beforeSnap.payoutInterval !== "daily") {
      return {
        status: "readback_mismatch",
        message: "settlement_ok_but_balance_payout_interval_not_daily",
        before,
        after: before,
        stripeSupportMayBeRequired: true,
      };
    }
    return {
      status: "settlement_unchanged",
      message: "settlement_already_at_confirmed_override",
      before,
      after: before,
      stripeSupportMayBeRequired: false,
    };
  }

  try {
    await rawBalanceRequest("POST", stripeAccountId, {
      "payments[settlement_timing][delay_days_override]": targetOverride,
    });
  } catch (err) {
    if (isPermanentSettlementConfigError(err)) {
      const msg =
        typeof (err as { message?: unknown }).message === "string"
          ? (err as { message: string }).message
          : "";
      return {
        status: "skipped_ineligible",
        message: msg.toLowerCase().includes("cannot lower")
          ? "settlement_override_below_account_minimum"
          : "settlement_override_not_permitted",
        before,
        after: null,
        stripeSupportMayBeRequired: true,
      };
    }
    logServerError("stripeConnectBalanceSettings.update", err, {
      accountSuffix: stripeAccountId.slice(-8),
    });
    return {
      status: "failed",
      message: "balance_settings_update_failed",
      before,
      after: null,
      stripeSupportMayBeRequired: false,
    };
  }

  try {
    const readAfter = await readBefore(stripeAccountId, accountsV1DelayDays);
    const after = readAfter.settlement;
    const afterSnap = readAfter.snapshot;

    if (!settlementReadBackMatchesTarget(after, afterSnap, targetOverride)) {
      return {
        status: "readback_mismatch",
        message: "settlement_override_readback_mismatch",
        before,
        after,
        stripeSupportMayBeRequired: true,
      };
    }

    const effectiveChanged = before.effectiveDelayDays !== after.effectiveDelayDays;
    const overrideChanged = before.delayDaysOverride !== after.delayDaysOverride;
    return {
      status: overrideChanged || effectiveChanged ? "settlement_configured" : "settlement_unchanged",
      message: "settlement_override_applied_and_verified",
      before,
      after,
      stripeSupportMayBeRequired: false,
    };
  } catch (err) {
    logServerError("stripeConnectBalanceSettings.retrieve.after", err, {
      accountSuffix: stripeAccountId.slice(-8),
    });
    return {
      status: "failed",
      message: "balance_settings_read_back_failed",
      before,
      after: null,
      stripeSupportMayBeRequired: false,
    };
  }
}
