/**
 * Read-only / update settlement timing via Stripe Balance Settings API.
 * Never calls payouts.create or mutates bank details.
 */
import type Stripe from "stripe";
import {
  STRIPE_BALANCE_SETTINGS_API_VERSION,
  STRIPE_BALANCE_SETTINGS_PATH,
  STRIPE_CONNECT_DE_SETTLEMENT_DELAY_DAYS_OVERRIDE,
  STRIPE_SETTLEMENT_DELAY_DAYS_OVERRIDE_CLEAR,
  connectSettlementDelayDaysOverrideTarget,
} from "../config/stripeBalanceSettings.js";
import type { SettlementObservedState, SettlementPolicyStatus } from "./connectPayoutPolicy.types.js";
import {
  readSettlementDelayForConnectedAccount,
  settlementReadFromBalanceSettings,
  settlementReadUnavailable,
} from "./connectSettlementRead.service.js";
import type { SettlementDelayReadDto } from "./connectPayoutPolicy.types.js";
import { logServerError } from "../utils/httpErrors.js";
import { stripeKeyModeMatchesAccountLivemode, stripeSecretKeyMode } from "../utils/stripeKeyMode.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";

export type ConnectBalanceSettingsSnapshot = {
  payoutInterval: string | null;
  delayDays: number | null;
  delayDaysOverride: number | null;
  /** False when the override field was present but not null, empty, or a finite number. */
  settlementOverrideRecognized: boolean;
  effectiveSettlementDelayDays: number | null;
  debitNegativeBalances: boolean | null;
};

export type SettlementMinimumApplyResult = {
  status: SettlementPolicyStatus;
  message: string;
  before: SettlementDelayReadDto | null;
  after: SettlementDelayReadDto | null;
  stripeSupportMayBeRequired: boolean;
  settlementState: SettlementObservedState | null;
};

type RawRequestFn = (
  method: string,
  path: string,
  data?: unknown,
  options?: Stripe.RawRequestOptions,
) => Promise<unknown>;

let rawRequestFn: RawRequestFn | null = null;
export type ConnectAccountClassificationRead = {
  livemode: boolean;
  country?: string | null;
  type?: string | null;
  controller?: {
    stripe_dashboard?: { type?: string | null } | null;
  } | null;
};

let retrieveAccountLivemodeFn: ((id: string) => Promise<ConnectAccountClassificationRead>) | null = null;

export function __setConnectBalanceSettingsRawRequestForTests(fn: RawRequestFn | null): void {
  rawRequestFn = fn;
}

export function __setConnectBalanceSettingsRetrieveAccountForTests(
  fn: ((id: string) => Promise<ConnectAccountClassificationRead>) | null,
): void {
  retrieveAccountLivemodeFn = fn;
}

/** v1 controller.stripe_dashboard.type. Accounts v2 exposes the same value as dashboard. */
export function stripeDashboardTypeFromAccount(account: {
  controller?: { stripe_dashboard?: { type?: string | null } | null } | null;
}): string | null {
  const value = account.controller?.stripe_dashboard?.type;
  return typeof value === "string" ? value : null;
}

/**
 * Express dashboard access is not settlement eligibility.
 * A present dashboard value wins. Account.type is only the legacy fallback:
 * type "none" means the controller hash does not match a standard, express, or custom preset.
 */
export function classifyConnectDashboard(args: {
  accountType?: string | null;
  stripeDashboardType?: string | null;
}): "express" | "other" | "unknown" {
  const dashboard = (args.stripeDashboardType ?? "").trim().toLowerCase();
  const accountType = (args.accountType ?? "").trim().toLowerCase();
  if (dashboard === "express") return "express";
  if (dashboard === "full" || dashboard === "none") return "other";
  if (dashboard) return "unknown";
  if (accountType === "express") return "express";
  if (accountType === "custom" || accountType === "standard") return "other";
  return "unknown";
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

/** Absent, null, and "" mean no override. An unexpected type is not treated as an override. */
function parseDelayDaysOverride(settlement: Record<string, unknown>): {
  delayDaysOverride: number | null;
  recognized: boolean;
} {
  if (!Object.prototype.hasOwnProperty.call(settlement, "delay_days_override")) {
    return { delayDaysOverride: null, recognized: true };
  }
  const value = settlement.delay_days_override;
  if (value == null || value === "") return { delayDaysOverride: null, recognized: true };
  const parsed = parseDelayDays(value);
  if (parsed == null) return { delayDaysOverride: null, recognized: false };
  return { delayDaysOverride: parsed, recognized: true };
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
  const override = parseDelayDaysOverride(settlement);
  const delayDaysOverride = override.delayDaysOverride;
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
    settlementOverrideRecognized: override.recognized,
    effectiveSettlementDelayDays: effective,
    debitNegativeBalances: debit,
  };
}

/** Posts only delay_days_override. value "" clears it; never send 0. */
export async function postSettlementDelayDaysOverride(
  stripeAccountId: string,
  value: number | typeof STRIPE_SETTLEMENT_DELAY_DAYS_OVERRIDE_CLEAR,
): Promise<void> {
  await rawBalanceRequest("POST", stripeAccountId, {
    "payments[settlement_timing][delay_days_override]": value,
  });
}

export async function readConnectedAccountSettlementContext(stripeAccountId: string): Promise<{
  livemode: boolean;
  country: string | null;
  type: string | null;
  stripeDashboardType: string | null;
  settlement: SettlementDelayReadDto;
}> {
  const acct = retrieveAccountLivemodeFn
    ? await retrieveAccountLivemodeFn(stripeAccountId)
    : await getStripeClient().accounts.retrieve(stripeAccountId);
  const livemode =
    typeof (acct as unknown as { livemode?: unknown }).livemode === "boolean"
      ? (acct as unknown as { livemode: boolean }).livemode
      : false;
  const countryField = (acct as Stripe.Account).country;
  const typeField = (acct as Stripe.Account).type;
  const snap = await retrieveConnectBalanceSettings(stripeAccountId);
  return {
    livemode,
    country: typeof countryField === "string" ? countryField : null,
    type: typeof typeField === "string" ? typeField : null,
    stripeDashboardType: stripeDashboardTypeFromAccount(acct),
    settlement: settlementReadFromBalanceSettings(snap),
  };
}

export async function retrieveConnectBalanceSettings(
  stripeAccountId: string,
): Promise<ConnectBalanceSettingsSnapshot> {
  const payload = await rawBalanceRequest("GET", stripeAccountId);
  return parseConnectBalanceSettingsPayload(payload);
}

/** Explicit per-account override equals the live-mode DE target. A null override is not a match. */
export function connectSettlementMatchesConfirmedTarget(
  settlement: SettlementDelayReadDto,
  country: string | null | undefined,
): boolean {
  const target = connectSettlementDelayDaysOverrideTarget(country);
  if (target == null) return true;
  return settlement.delayDaysOverride === target && settlement.effectiveDelayDays === target;
}

/**
 * Live-mode reconciliation still proposes a DE override write when the explicit override is absent.
 * Test mode must use decideConnectSettlement, which does not treat country as eligibility.
 */
export function connectSettlementNeedsConfirmedTargetApply(
  settlement: SettlementDelayReadDto,
  country: string | null | undefined,
): boolean {
  const target = connectSettlementDelayDaysOverrideTarget(country);
  if (target == null) return false;
  return !connectSettlementMatchesConfirmedTarget(settlement, country);
}

export type ConnectSettlementDecision = {
  state: SettlementObservedState;
  needsBalanceSettingsWrite: boolean;
  action: string;
  status: SettlementPolicyStatus;
  message: string;
};

function isGermanCountry(country: string | null | undefined): boolean {
  return (country ?? "").trim().toLowerCase() === "de";
}

function expressDashboardClass(args: {
  accountType: string | null;
  stripeDashboardType?: string | null;
}): "express" | "other" | "unknown" {
  return classifyConnectDashboard(args);
}

function explicitT3Override(settlement: SettlementDelayReadDto): boolean {
  const target = STRIPE_CONNECT_DE_SETTLEMENT_DELAY_DAYS_OVERRIDE;
  return (
    settlement.source === "balance_settings" &&
    settlement.settlementOverrideRecognized !== false &&
    settlement.delayDaysOverride === target &&
    settlement.effectiveDelayDays === target
  );
}

function platformDefaultT3(settlement: SettlementDelayReadDto): boolean {
  const target = STRIPE_CONNECT_DE_SETTLEMENT_DELAY_DAYS_OVERRIDE;
  return (
    settlement.source === "balance_settings" &&
    settlement.settlementOverrideRecognized !== false &&
    settlement.delayDaysOverride == null &&
    settlement.delayDays === target &&
    settlement.effectiveDelayDays === target
  );
}

/**
 * Test mode never writes delay_days_override. A German Express test account whose Balance
 * Settings already show delay_days 3 and no override is the platform default.
 * Live mode keeps the previous DE override write when that explicit override is absent.
 */
export function decideConnectSettlement(args: {
  keyMode: ReturnType<typeof stripeSecretKeyMode>;
  livemode: boolean | null;
  country: string | null;
  accountType: string | null;
  stripeDashboardType?: string | null;
  settlement: SettlementDelayReadDto;
}): ConnectSettlementDecision {
  const german = isGermanCountry(args.country);
  const express = expressDashboardClass(args);
  const testAccount = args.keyMode === "test" && args.livemode === false;
  const liveAccount = args.keyMode === "live" && args.livemode === true;

  if (!german) {
    return {
      state: "out_of_scope",
      needsBalanceSettingsWrite: false,
      action: "settlement_outside_confirmed_scope",
      status: "skipped_ineligible",
      message: "settlement_override_target_not_configured_for_country",
    };
  }

  if (testAccount) {
    if (args.settlement.source !== "balance_settings" || args.settlement.settlementOverrideRecognized === false) {
      return {
        state: "unverified",
        needsBalanceSettingsWrite: false,
        action: "review_settlement_read",
        status: "failed",
        message: "balance_settings_unverified",
      };
    }
    if (explicitT3Override(args.settlement)) {
      return {
        state: "explicit_override",
        needsBalanceSettingsWrite: false,
        action: "settlement_explicit_override_verified",
        status: "settlement_unchanged",
        message: "settlement_explicit_override_verified",
      };
    }
    if (express === "other") {
      return {
        state: "out_of_scope",
        needsBalanceSettingsWrite: false,
        action: "settlement_outside_confirmed_scope",
        status: "skipped_ineligible",
        message: "settlement_account_not_express",
      };
    }
    if (express === "unknown") {
      return {
        state: "eligibility_unknown",
        needsBalanceSettingsWrite: false,
        action: "review_settlement_eligibility",
        status: "eligibility_unknown",
        message: "settlement_eligibility_unconfirmed_no_write",
      };
    }
    if (platformDefaultT3(args.settlement)) {
      return {
        state: "platform_default",
        needsBalanceSettingsWrite: false,
        action: "settlement_platform_default_verified",
        status: "already_at_account_default",
        message: "settlement_platform_default_t3",
      };
    }
    return {
      state: "delay_mismatch",
      needsBalanceSettingsWrite: false,
      action: "review_settlement_eligibility",
      status: "eligibility_unknown",
      message: "settlement_delay_not_platform_default_no_write",
    };
  }

  if (liveAccount) {
    if (explicitT3Override(args.settlement)) {
      return {
        state: "explicit_override",
        needsBalanceSettingsWrite: false,
        action: "settlement_explicit_override_verified",
        status: "settlement_unchanged",
        message: "settlement_already_at_confirmed_override",
      };
    }
    return {
      state: "live_override_required",
      needsBalanceSettingsWrite: true,
      action: "apply_de_settlement_delay_days_override_3",
      status: "settlement_configured",
      message: "live_de_settlement_override_required",
    };
  }

  return {
    state: "unverified",
    needsBalanceSettingsWrite: false,
    action: "review_stripe_key_mode",
    status: "skipped_key_mode_mismatch",
    message: "stripe_secret_key_mode_mismatch",
  };
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
  targetOverride: number,
): boolean {
  if (after.delayDaysOverride !== targetOverride) return false;
  if (after.effectiveDelayDays !== targetOverride) return false;
  return true;
}

/**
 * Test mode does not write delay_days_override. Live DE accounts still get the explicit override
 * when it is not already 3. Payout interval is not part of this settlement result.
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
      settlementState: null,
    };
  }

  let before: SettlementDelayReadDto;
  try {
    const read = await readBefore(stripeAccountId, accountsV1DelayDays);
    before = read.settlement;
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
      settlementState: "unverified",
    };
  }

  let accountCountry: string | null = null;
  let accountType: string | null = null;
  let stripeDashboardType: string | null = null;
  let accountLive = false;
  try {
    const acct = retrieveAccountLivemodeFn
      ? await retrieveAccountLivemodeFn(stripeAccountId)
      : await getStripeClient().accounts.retrieve(stripeAccountId);
    accountLive =
      typeof (acct as unknown as { livemode?: unknown }).livemode === "boolean"
        ? (acct as unknown as { livemode: boolean }).livemode
        : false;
    const countryField = (acct as Stripe.Account).country;
    accountCountry = typeof countryField === "string" ? countryField : null;
    const typeField = (acct as Stripe.Account).type;
    accountType = typeof typeField === "string" ? typeField : null;
    stripeDashboardType = stripeDashboardTypeFromAccount(acct);
    if (!stripeKeyModeMatchesAccountLivemode(accountLive)) {
      return {
        status: "skipped_key_mode_mismatch",
        message: "stripe_secret_key_mode_mismatch",
        before,
        after: null,
        stripeSupportMayBeRequired: false,
        settlementState: "unverified",
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
      settlementState: "unverified",
    };
  }

  const decision = decideConnectSettlement({
    keyMode: stripeSecretKeyMode(),
    livemode: accountLive,
    country: accountCountry,
    accountType,
    stripeDashboardType,
    settlement: before,
  });
  if (!decision.needsBalanceSettingsWrite) {
    return {
      status: decision.status,
      message: decision.message,
      before,
      after: before,
      stripeSupportMayBeRequired: false,
      settlementState: decision.state,
    };
  }

  const targetOverride = STRIPE_CONNECT_DE_SETTLEMENT_DELAY_DAYS_OVERRIDE;

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
        settlementState: "delay_mismatch",
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
      settlementState: "unverified",
    };
  }

  try {
    const readAfter = await readBefore(stripeAccountId, accountsV1DelayDays);
    const after = readAfter.settlement;

    if (!settlementReadBackMatchesTarget(after, targetOverride)) {
      return {
        status: "readback_mismatch",
        message: "settlement_override_readback_mismatch",
        before,
        after,
        stripeSupportMayBeRequired: true,
        settlementState: "unverified",
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
      settlementState: "explicit_override",
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
      settlementState: "unverified",
    };
  }
}
