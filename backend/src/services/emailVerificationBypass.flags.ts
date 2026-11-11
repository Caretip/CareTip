/**
 * Demo / walkthrough email verification bypass.
 * Opt-in only (`ENABLE_DEMO_BYPASS=true`). Never enabled merely because NODE_ENV is not production,
 * and never available in production, whatever the flag says.
 */
export function isDemoEmailVerificationBypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.ENABLE_DEMO_BYPASS === "true";
}
