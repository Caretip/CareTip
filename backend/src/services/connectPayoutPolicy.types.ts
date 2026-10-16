/**
 * Shared Connect payout policy + settlement read types (no Stripe I/O).
 */
import type { BusinessBankPayoutSchedule } from "@prisma/client";

export type SchedulePolicyStatus =
  | "schedule_synced"
  | "schedule_unchanged"
  | "failed"
  | "skipped_key_mode_mismatch"
  | "skipped_not_configured"
  | "skipped_transition_blocked"
  | "skipped_unverified_account";

export type SettlementPolicyStatus =
  | "settlement_configured"
  | "settlement_unchanged"
  | "settlement_reset"
  | "already_at_account_default"
  | "minimum_unavailable"
  | "skipped_ineligible"
  | "skipped_disabled"
  | "skipped_key_mode_mismatch"
  | "skipped_schedule_not_synced"
  | "skipped_unverified_account"
  | "failed"
  | "readback_mismatch";

export type SettlementDelayReadSource = "balance_settings" | "accounts_v1_fallback" | "unavailable";

export type SettlementDelayReadDto = {
  source: SettlementDelayReadSource;
  delayDays: number | null;
  delayDaysOverride: number | null;
  effectiveDelayDays: number | null;
};

export type SchedulePolicyResultDto = {
  status: SchedulePolicyStatus;
  message: string;
  expectedStripeInterval: string;
  verifiedStripeInterval: string | null;
  scheduleDrift: boolean;
};

export type SettlementPolicyResultDto = {
  status: SettlementPolicyStatus;
  message: string;
  before: SettlementDelayReadDto | null;
  after: SettlementDelayReadDto | null;
  /** True when no supported CareTip API path remains to lower delay (Stripe Support may be required). */
  stripeSupportMayBeRequired: boolean;
};

export type ConnectPayoutPolicyApplyDto = {
  schedule: SchedulePolicyResultDto;
  settlement: SettlementPolicyResultDto | null;
  /** Schedule succeeded; settlement succeeded or was an expected skip (at default, disabled). */
  policyComplete: boolean;
};

export type BankPayoutScheduleResponseDto = {
  schedule: BusinessBankPayoutSchedule;
  nextScheduledPayoutAt: string | null;
  careTipControlled: boolean;
  stripeScheduleInterval: string | null;
  scheduleDrift: boolean;
  settlement: SettlementDelayReadDto;
  lastPolicyApply: ConnectPayoutPolicyApplyDto | null;
};

/** @deprecated Use settlement.effectiveDelayDays — kept for backward compatibility. */
export type BankPayoutScheduleResponseLegacyFields = {
  effectiveSettlementDelayDays: number | null;
};
