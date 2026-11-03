/**
 * Routes where an automatic deployment reload is deferred until the user leaves.
 * A reload preserves the URL, so these are pages whose state or one-time callback processing a
 * reload could disturb. Manual refresh stays available everywhere.
 */

/** Guest tip journey: flow state lives in memory (`TipFlowContext`) until Stripe takes over. */
const GUEST_FLOW_PATHS = [
  "/qr",
  "/qr-landing",
  "/table",
  "/staff",
  "/select-employee",
  "/tip-amount",
  "/payment",
  "/success",
  "/rating",
  "/tip-complete",
];

/** One-time tokens, OAuth completion and Stripe return pages. */
const CALLBACK_PATHS = [
  "/auth/facebook/complete",
  "/mobile-auth",
  "/verify-email",
  "/verify",
  "/activate",
  "/check-email",
  "/reset-password",
  "/subscription/success",
  "/subscription/canceled",
  "/onboarding",
];

/** Stripe Checkout / Connect / billing return markers handled by page effects. */
const RETURN_QUERY_KEYS = [
  "session_id",
  "checkout",
  "connect",
  "billing",
  "payoutConnect",
  "physicalOrder",
  "payment_intent",
  "setup_intent",
  "redirect_status",
];

function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return trimmed || "/";
}

export function isGuestTipFlowRoute(pathname: string): boolean {
  const path = normalizePath(pathname);
  return GUEST_FLOW_PATHS.some((base) => matchesPath(path, base));
}

/** Returns a diagnostic reason when an automatic reload must wait, otherwise null. */
export function deployUpdateRouteDeferReason(pathname: string, search: string): string | null {
  const path = normalizePath(pathname);
  if (isGuestTipFlowRoute(path)) return "route:guest-tip-flow";
  if (CALLBACK_PATHS.some((base) => matchesPath(path, base))) return "route:callback";
  if (search) {
    const params = new URLSearchParams(search);
    if (RETURN_QUERY_KEYS.some((key) => params.has(key))) return "route:payment-return";
  }
  return null;
}
