import { isApiRequestError } from "./apiError";
import { isApiConnectivityError } from "./errorMessages";
import { logClientError } from "./clientLog";

export type DashboardLoadFailureKind =
  | "rate_limited"
  | "session"
  | "server"
  | "connectivity"
  | "client"
  | "unknown";

export function classifyDashboardLoadFailure(error: unknown): DashboardLoadFailureKind {
  if (isApiRequestError(error)) {
    if (error.status === 429) return "rate_limited";
    if (error.status === 401) return "session";
    if (error.status >= 500) return isApiConnectivityError(error) ? "connectivity" : "server";
    return "client";
  }
  return isApiConnectivityError(error) ? "connectivity" : "unknown";
}

/**
 * Records why a dashboard section failed to load. The user only sees safe copy, so this is what
 * makes a report like "Something went wrong" traceable to a request. Only classification fields
 * are sent: never the error message, response body, URL query, or any amount.
 */
export function reportDashboardLoadFailure(
  surface: string,
  error: unknown,
  context?: Record<string, string | number | boolean | null>,
): void {
  const status = isApiRequestError(error) ? error.status : null;
  const code = isApiRequestError(error) ? (error.code ?? null) : null;
  const kind = classifyDashboardLoadFailure(error);
  logClientError(
    `dashboard.load.${surface}`,
    new Error(`Dashboard load failed: ${surface} (${status ?? kind})`),
    { surface, kind, status, code, ...context },
  );
}
