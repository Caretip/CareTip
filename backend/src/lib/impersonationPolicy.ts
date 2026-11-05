/**
 * Support view (admin impersonation) is for seeing and fixing a customer's setup. It must not move
 * money, change where money goes, or change the customer's credentials.
 */
const BLOCKED_WRITES: RegExp[] = [
  /^\/api\/me\/connect\/(instant-payout|bank-payout-schedule|employee-tip-payout-mode|login-link|tip-distribution)(\/|$)/,
  /^\/api\/me\/billing\/(checkout|portal|cancel)(\/|$)/,
  /^\/api\/auth\/(change-password|2fa|email-change|oauth\/accounts)(\/|$)/,
  /^\/api\/me\/(deletion-request|export)(\/|$)/,
  /^\/api\/business\/physical-qr\/orders\/[^/]+\/checkout$/,
];

export function isWriteBlockedDuringImpersonation(method: string, originalUrl: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  const path = originalUrl.split("?")[0] ?? "";
  return BLOCKED_WRITES.some((pattern) => pattern.test(path));
}
