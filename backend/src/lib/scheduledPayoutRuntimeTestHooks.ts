/**
 * Runtime test hooks for scheduled payout ops must never apply in production unless
 * explicitly opted in (local/staging scripts only).
 */
export function scheduledPayoutRuntimeTestHooksEnabled(): boolean {
  if (process.env.NODE_ENV === "production") {
    return process.env.CARETIP_ENABLE_RUNTIME_TEST_HOOKS === "true";
  }
  return true;
}
