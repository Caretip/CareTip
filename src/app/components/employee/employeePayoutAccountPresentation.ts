import type { EmployeeConnectStatus, EmployeePayoutConnectionState } from "../../lib/api";
import { isEmployeeBusinessDistributionMode } from "./employeePayoutActivityPresentation";

export type EmployeePayoutPrimaryCta = "connect" | "complete" | "update";

export type EmployeePayoutUiPhase =
  | "loading"
  | "error"
  | "not_connected"
  | "setup_incomplete"
  | "attention"
  | "ready";

/** Stripe-authoritative ready: connected state plus payoutsEnabled from status API. */
export function isEmployeePayoutReady(
  data: Pick<EmployeeConnectStatus, "connectionState" | "payoutsEnabled" | "hasAccount"> | null,
): boolean {
  return data?.hasAccount === true && data.connectionState === "connected" && data.payoutsEnabled === true;
}

export function employeePayoutUiPhase(input: {
  loading: boolean;
  error: string | null;
  data: EmployeeConnectStatus | null;
}): EmployeePayoutUiPhase {
  if (input.loading && !input.data) return "loading";
  if (input.error && !input.data) return "error";
  const data = input.data;
  if (!data?.hasAccount || data.connectionState === "not_connected") return "not_connected";
  if (isEmployeePayoutReady(data)) return "ready";
  if (data.connectionState === "restricted" || data.connectionState === "action_required") {
    return "attention";
  }
  return "setup_incomplete";
}

export function employeePayoutPrimaryCta(phase: EmployeePayoutUiPhase): EmployeePayoutPrimaryCta | null {
  if (phase === "loading" || phase === "error") return null;
  if (phase === "not_connected") return "connect";
  if (phase === "ready") return "update";
  return "complete";
}

export function employeePayoutBodyKey(
  phase: EmployeePayoutUiPhase,
  state: EmployeePayoutConnectionState,
): string {
  if (phase === "ready") return "employee.payouts.readyBody";
  if (phase === "attention") return "employee.payouts.attentionBody";
  if (phase === "setup_incomplete") return "employee.payouts.incompleteBody";
  if (phase === "not_connected") return "employee.payouts.notConnectedBody";
  return `employee.payouts.state.${state}`;
}

export function employeePayoutPrimaryCtaKey(cta: EmployeePayoutPrimaryCta): string {
  if (cta === "connect") return "employee.payouts.connectCta";
  if (cta === "update") return "employee.payouts.updateDetails";
  return "employee.payouts.completeSetup";
}

/** Server-resolved Business routing mode from employee connect status. */
export function employeeConnectIsBusinessDistribution(
  data: Pick<EmployeeConnectStatus, "employeeTipPayoutMode"> | null | undefined,
): boolean {
  return isEmployeeBusinessDistributionMode(data?.employeeTipPayoutMode);
}

/**
 * BUSINESS_RECEIVES: hide the Stripe account block when there is nothing to show
 * besides a Connect-to-receive-tips prompt.
 */
export function employeePayoutShowAccountSection(
  businessDistribution: boolean,
  phase: EmployeePayoutUiPhase,
): boolean {
  if (phase === "loading" || phase === "error") return true;
  if (businessDistribution && phase === "not_connected") return false;
  return true;
}

/**
 * DIRECT: existing Connect / Complete / Update CTAs.
 * BUSINESS_RECEIVES: never Connect or Complete-for-tips; Update only if already connected.
 */
export function employeePayoutShowPrimaryStripeCta(
  businessDistribution: boolean,
  phase: EmployeePayoutUiPhase,
): boolean {
  if (businessDistribution) return phase === "ready";
  return employeePayoutPrimaryCta(phase) != null;
}

export function employeePayoutAccountBodyKey(
  businessDistribution: boolean,
  phase: EmployeePayoutUiPhase,
  state: EmployeePayoutConnectionState,
): string | null {
  if (businessDistribution) return null;
  return employeePayoutBodyKey(phase, state);
}
