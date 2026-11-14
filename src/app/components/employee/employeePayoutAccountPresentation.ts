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
 * The Stripe account block is always shown. The Business routing setting decides where NEW tips go;
 * it must not block an employee from connecting (tips held by CareTip can only be released to a
 * connected account, and the venue may switch modes later). `businessDistribution` is accepted for
 * call-site compatibility and deliberately ignored.
 */
export function employeePayoutShowAccountSection(
  _businessDistribution: boolean,
  _phase: EmployeePayoutUiPhase,
): boolean {
  return true;
}

/**
 * Connect / Complete / Update CTA whenever the phase has one — in both routing modes.
 * Visibility is not payout eligibility: the backend still enforces employee activation,
 * account ownership and Stripe readiness before any onboarding link or payout.
 */
export function employeePayoutShowPrimaryStripeCta(
  _businessDistribution: boolean,
  phase: EmployeePayoutUiPhase,
): boolean {
  return employeePayoutPrimaryCta(phase) != null;
}

/** Explanatory copy for the account card; venue-distribution mode gets mode-aware wording. */
export function employeePayoutAccountBodyKey(
  businessDistribution: boolean,
  phase: EmployeePayoutUiPhase,
  state: EmployeePayoutConnectionState,
): string | null {
  if (businessDistribution) {
    if (phase === "not_connected") return "employee.payouts.businessMode.notConnectedBody";
    if (phase === "setup_incomplete") return "employee.payouts.businessMode.incompleteBody";
    if (phase === "attention") return "employee.payouts.attentionBody";
    if (phase === "ready") return "employee.payouts.businessMode.readyBody";
  }
  return employeePayoutBodyKey(phase, state);
}

/**
 * Dashboard "fix" prompt for Stripe Connect. Direct mode: whenever the account is not ready.
 * Venue-distribution mode: Connect is optional, so prompt only when there is a concrete reason —
 * tips held by CareTip for this employee, or an onboarding the employee already started.
 */
export function employeeStripeConnectPromptActive(
  data:
    | Pick<
        EmployeeConnectStatus,
        "stripeConfigured" | "hasAccount" | "connectionState" | "payoutsEnabled" | "heldPlatformCents" | "employeeTipPayoutMode"
      >
    | null
    | undefined,
): boolean {
  if (!data || data.stripeConfigured === false) return false;
  if (isEmployeePayoutReady(data)) return false;
  if (!employeeConnectIsBusinessDistribution(data)) return true;
  const held = (data.heldPlatformCents ?? 0) > 0;
  const started = data.hasAccount === true && data.connectionState !== "not_connected";
  return held || started;
}

/**
 * Tips CareTip is holding because this account cannot receive transfers yet (held_platform /
 * failed release on the payable ledger). Shown in either routing mode; never shown once ready.
 */
export function employeePayoutHeldBufferCents(
  data: Pick<EmployeeConnectStatus, "heldPlatformCents"> | null | undefined,
  phase: EmployeePayoutUiPhase,
): number {
  if (phase === "ready" || phase === "loading" || phase === "error") return 0;
  const cents = data?.heldPlatformCents ?? 0;
  return Number.isFinite(cents) && cents > 0 ? cents : 0;
}
