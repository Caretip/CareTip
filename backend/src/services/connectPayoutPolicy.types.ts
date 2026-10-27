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
  | "eligibility_unknown"
  | "minimum_unavailable"
  | "skipped_ineligible"
  | "skipped_disabled"
  | "skipped_key_mode_mismatch"
  | "skipped_schedule_not_synced"
  | "skipped_unverified_account"
  | "failed"
  | "readback_mismatch";

export type SettlementDelayReadSource = "balance_settings" | "accounts_v1_fallback" | "unavailable";

/**
 * How a Balance Settings read relates to T+3. Country alone is not eligibility.
 * `live_override_required` is the preserved live-mode write path, not a test-mode default.
 */
export type SettlementObservedState =
  | "platform_default"
  | "explicit_override"
  | "delay_mismatch"
  | "eligibility_unknown"
  | "out_of_scope"
  | "unverified"
  | "live_override_required";

export type SettlementDelayReadDto = {
  source: SettlementDelayReadSource;
  delayDays: number | null;
  delayDaysOverride: number | null;
  effectiveDelayDays: number | null;
  /** False when delay_days_override was present but not a number, null, or empty string. */
  settlementOverrideRecognized?: boolean;
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
  /** Distinguishes a platform default from an explicit override. Null on older callers. */
  settlementState?: SettlementObservedState | null;
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
