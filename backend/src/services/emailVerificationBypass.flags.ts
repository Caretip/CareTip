/**
 * Demo / walkthrough email verification bypass.
 * Opt-in only (`ENABLE_DEMO_BYPASS=true`). Never enabled merely because NODE_ENV is not production.
 */
export function isDemoEmailVerificationBypassEnabled(): boolean {
  return process.env.ENABLE_DEMO_BYPASS === "true";
}
