import { getQueryErrorStatus } from "./queryRetry";

/** Default pause after a 429 when Retry-After is missing/invalid. */
export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000;

/** Cap Retry-After so a bad header cannot freeze the feed for hours. */
export const MAX_RATE_LIMIT_BACKOFF_MS = 15 * 60_000;

export function isRateLimitError(error: unknown): boolean {
  return getQueryErrorStatus(error) === 429;
}

/** Parse Retry-After (seconds or HTTP-date) into a bounded delay in ms. */
export function parseRetryAfterMs(header: unknown, nowMs = Date.now()): number | null {
  if (header == null) return null;
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim();
  if (!text) return null;

  const asSeconds = Number(text);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(Math.max(0, asSeconds * 1000), MAX_RATE_LIMIT_BACKOFF_MS);
  }

  const asDate = Date.parse(text);
  if (!Number.isNaN(asDate)) {
    return Math.min(Math.max(0, asDate - nowMs), MAX_RATE_LIMIT_BACKOFF_MS);
  }

  return null;
}

export function getRetryAfterHeader(error: unknown): unknown {
  if (!error || typeof error !== "object") return null;
  const headers = (error as { response?: { headers?: Record<string, unknown> } }).response
    ?.headers;
  if (!headers || typeof headers !== "object") return null;
  return (
    headers["retry-after"] ??
    headers["Retry-After"] ??
    headers["RETRY-AFTER"] ??
    null
  );
}

/** Absolute timestamp until which callers should pause authenticated traffic. */
export function resolveRateLimitUntilMs(
  error: unknown,
  nowMs = Date.now(),
  fallbackMs = DEFAULT_RATE_LIMIT_BACKOFF_MS,
): number {
  const fromHeader = parseRetryAfterMs(getRetryAfterHeader(error), nowMs);
  const delay = fromHeader ?? fallbackMs;
  return nowMs + delay;
}
