import { StripeConnectStatus } from "@prisma/client";

/**
 * Neutral employee-facing connection states.
 * Does not claim that tips are routed to this account.
 */
export type EmployeePayoutConnectionState =
  | "not_connected"
  | "setup_required"
  | "action_required"
  | "restricted"
  | "connected";

export function toEmployeePayoutConnectionState(
  status: StripeConnectStatus | null | undefined,
  hasAccount: boolean,
  payoutsEnabled?: boolean | null,
): EmployeePayoutConnectionState {
  if (!hasAccount) return "not_connected";
  switch (status) {
    case StripeConnectStatus.ready:
      if (payoutsEnabled === false) return "action_required";
      return "connected";
    case StripeConnectStatus.restricted:
      return "restricted";
    case StripeConnectStatus.requires_information:
      return "action_required";
    case StripeConnectStatus.onboarding_required:
    case StripeConnectStatus.onboarding_incomplete:
      return "setup_required";
    case StripeConnectStatus.not_connected:
    default:
      return hasAccount ? "setup_required" : "not_connected";
  }
}
