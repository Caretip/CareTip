import { normalizeRequestPathForPolicy } from "./requestPathPolicy.js";

/**
 * Support view (admin impersonation) is for seeing and fixing a customer's setup. It must not move
 * money, change where money goes, or change the customer's credentials.
 */
const BLOCKED_WRITES: RegExp[] = [
  /^\/api\/me\/connect\/(instant-payout|bank-payout-schedule|employee-tip-payout-mode|login-link|account-link|tip-distribution)(\/|$)/,
  /^\/api\/me\/billing\/(checkout|portal|cancel)(\/|$)/,
  /^\/api\/auth\/(change-password|2fa|email-change|oauth\/accounts)(\/|$)/,
  /^\/api\/me\/(deletion-request|export)(\/|$)/,
  /^\/api\/business\/physical-qr\/orders\/[^/]+\/checkout$/,
  // Ownership and billing sessions decide who controls the account and its money.
  /^\/api\/business\/ownership\/transfer$/,
  /^\/api\/mobile\/create-billing-session$/,
];

export function isWriteBlockedDuringImpersonation(method: string, originalUrl: string): boolean {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  // Case/slash-insensitive like Express routing — otherwise /API/ME/... reaches the handler unblocked.
  const path = normalizeRequestPathForPolicy(originalUrl);
  return BLOCKED_WRITES.some((pattern) => pattern.test(path));
}
