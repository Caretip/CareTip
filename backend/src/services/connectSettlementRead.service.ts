/**
 * Settlement delay read-back with Balance Settings primary + Accounts v1 fallback.
 */
import type { ConnectBalanceSettingsSnapshot } from "./stripeConnectBalanceSettings.service.js";
import {
  parseConnectBalanceSettingsPayload,
  retrieveConnectBalanceSettings,
} from "./stripeConnectBalanceSettings.service.js";
import type { SettlementDelayReadDto } from "./connectPayoutPolicy.types.js";
import { logServerError } from "../utils/httpErrors.js";
import { isStripeConfigured } from "./stripe.service.js";

export function settlementReadFromBalanceSettings(
  snap: ConnectBalanceSettingsSnapshot,
): SettlementDelayReadDto {
  return {
    source: "balance_settings",
    delayDays: snap.delayDays,
    delayDaysOverride: snap.delayDaysOverride,
    effectiveDelayDays: snap.effectiveSettlementDelayDays,
  };
}

export function settlementReadFromAccountsV1DelayDays(delayDays: number | null): SettlementDelayReadDto {
  return {
    source: "accounts_v1_fallback",
    delayDays,
    delayDaysOverride: null,
    effectiveDelayDays: delayDays,
  };
}

export function settlementReadUnavailable(): SettlementDelayReadDto {
  return {
    source: "unavailable",
    delayDays: null,
    delayDaysOverride: null,
    effectiveDelayDays: null,
  };
}

let retrieveBalanceSettingsFn: ((stripeAccountId: string) => Promise<ConnectBalanceSettingsSnapshot>) | null =
  null;

export function __setRetrieveBalanceSettingsForTests(
  fn: ((stripeAccountId: string) => Promise<ConnectBalanceSettingsSnapshot>) | null,
): void {
  retrieveBalanceSettingsFn = fn;
}

export async function readSettlementDelayForConnectedAccount(args: {
  stripeAccountId: string;
  accountsV1DelayDays: number | null;
}): Promise<SettlementDelayReadDto> {
  if (!isStripeConfigured() && !retrieveBalanceSettingsFn) {
    if (args.accountsV1DelayDays != null) {
      return settlementReadFromAccountsV1DelayDays(args.accountsV1DelayDays);
    }
    return settlementReadUnavailable();
  }

  try {
    const snap = retrieveBalanceSettingsFn
      ? await retrieveBalanceSettingsFn(args.stripeAccountId)
      : await retrieveConnectBalanceSettings(args.stripeAccountId);
    return settlementReadFromBalanceSettings(snap);
  } catch (err) {
    logServerError("connectSettlementRead.balanceSettings", err, {
      accountSuffix: args.stripeAccountId.slice(-8),
    });
    if (args.accountsV1DelayDays != null) {
      return settlementReadFromAccountsV1DelayDays(args.accountsV1DelayDays);
    }
    return settlementReadUnavailable();
  }
}

export function effectiveDelayChanged(
  before: SettlementDelayReadDto | null,
  after: SettlementDelayReadDto | null,
): boolean {
  if (!before || !after) return false;
  return before.effectiveDelayDays !== after.effectiveDelayDays || before.delayDaysOverride !== after.delayDaysOverride;
}
