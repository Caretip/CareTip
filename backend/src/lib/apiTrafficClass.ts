/**
 * Classifies an API request for rate limiting. Each class has its own buckets so that, for example,
 * public tipping on venue Wi-Fi cannot use up the allowance a logged-in manager needs on that IP.
 */
export type ApiTrafficClass =
  | "auth"
  | "sessionRefresh"
  | "instantPayout"
  | "financialWrite"
  | "dashboardRead"
  | "analyticsRead"
  | "publicTipping"
  | "ordinary";

const INSTANT_PAYOUT_PATHS = new Set([
  "/api/me/connect/instant-payout",
  "/api/me/employee-connect/instant-payout",
]);

/** Writes that move money, change where it goes, or start a payment. */
const FINANCIAL_WRITE_PATTERNS: RegExp[] = [
  /^\/api\/me\/connect\/(account-link|login-link|bank-payout-schedule|employee-tip-payout-mode|tip-distribution)(\/|$)/,
  /^\/api\/me\/employee-connect\/(account-link|login-link|bank-payout-schedule)(\/|$)/,
  /^\/api\/me\/billing(\/|$)/,
  /^\/api\/business\/physical-qr\/orders\/.*checkout$/,
  /^\/api\/business\/ownership\/transfer$/,
  /^\/api\/mobile\/create-billing-session$/,
  /^\/api\/(platform|admin)\/connect-payout-reconciliation(\/|$)/,
  /^\/api\/(platform|admin)\/scheduled-payout-operations(\/|$)/,
  /^\/api\/(platform|admin)\/businesses\/[^/]+\/ownership\/transfer$/,
];

/** Same public guest surface the web client treats as not needing a session. */
function isPublicTippingPath(path: string): boolean {
  return (
    path.startsWith("/api/staff/") ||
    path.startsWith("/api/tipping-context") ||
    path.startsWith("/api/payments/create-tip-session") ||
    path.startsWith("/api/payments/tip-session") ||
    path.startsWith("/api/qr/scan") ||
    /^\/api\/employees\/(?!me(?:\/|$))[^/]+$/.test(path)
  );
}

function isAnalyticsRead(path: string, scope: unknown): boolean {
  if (path === "/api/business/me/stats") return scope === "analytics" || scope === "full";
  return path === "/api/business/qr-analytics" || /(^|\/)(analytics|reports)(\/|$)/.test(path);
}

function isDashboardRead(path: string): boolean {
  return (
    path.startsWith("/api/me/") ||
    path.startsWith("/api/business/") ||
    path.startsWith("/api/employees/me") ||
    path.startsWith("/api/feedback/business") ||
    path === "/api/locations" ||
    path === "/api/tables" ||
    path === "/api/goals"
  );
}

export function classifyApiTraffic(req: {
  method: string;
  path: string;
  query?: Record<string, unknown>;
}): ApiTrafficClass {
  const path = req.path.replace(/\/+$/, "") || "/";
  const isRead = req.method === "GET" || req.method === "HEAD";

  if (path === "/api/auth/refresh") return "sessionRefresh";
  if (path.startsWith("/api/auth/")) return "auth";
  if (isPublicTippingPath(path)) return "publicTipping";

  if (!isRead) {
    if (INSTANT_PAYOUT_PATHS.has(path)) return "instantPayout";
    if (FINANCIAL_WRITE_PATTERNS.some((pattern) => pattern.test(path))) return "financialWrite";
    // Part of every dashboard load, and it only records prompt state.
    if (path === "/api/me/notifications/setup/evaluate") return "dashboardRead";
    return "ordinary";
  }

  if (isAnalyticsRead(path, req.query?.scope)) return "analyticsRead";
  if (isDashboardRead(path)) return "dashboardRead";
  return "ordinary";
}
