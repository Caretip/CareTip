/** Extract HTTP status from Axios-style or normalizeApiError-shaped failures. */
export function getQueryErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const withResponse = error as { response?: { status?: number }; status?: number };
  if (typeof withResponse.response?.status === "number") return withResponse.response.status;
  if (typeof withResponse.status === "number") return withResponse.status;
  return null;
}

/**
 * React Query retry predicate — never amplify rate-limit / auth / not-found failures.
 * Transient network errors may retry up to twice.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = getQueryErrorStatus(error);
  if (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 429 ||
    status === 408 ||
    status === 503
  ) {
    return false;
  }
  return failureCount < 2;
}
