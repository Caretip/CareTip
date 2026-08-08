/**
 * Runtime regression: RQ 429 retry predicate + rate-limit backoff helpers.
 *
 *   npm run test:rate-limit
 *   npx tsx scripts/rate-limit-amplification-runtime.ts
 */
import assert from "node:assert/strict";
import { getQueryErrorStatus, shouldRetryQuery } from "../utils/queryRetry";
import {
  DEFAULT_RATE_LIMIT_BACKOFF_MS,
  getRetryAfterHeader,
  isRateLimitError,
  parseRetryAfterMs,
  resolveRateLimitUntilMs,
} from "../utils/rateLimitBackoff";

function axiosLike(status: number, headers?: Record<string, unknown>) {
  return {
    response: {
      status,
      headers: headers ?? {},
      data: { message: "Too many requests. Please slow down." },
    },
  };
}

function run() {
  assert.equal(getQueryErrorStatus(axiosLike(429)), 429);
  assert.equal(getQueryErrorStatus({ status: 503 }), 503);
  assert.equal(getQueryErrorStatus(null), null);

  assert.equal(shouldRetryQuery(0, axiosLike(429)), false);
  assert.equal(shouldRetryQuery(1, axiosLike(429)), false);
  assert.equal(shouldRetryQuery(0, axiosLike(401)), false);
  assert.equal(shouldRetryQuery(0, axiosLike(403)), false);
  assert.equal(shouldRetryQuery(0, axiosLike(404)), false);
  assert.equal(shouldRetryQuery(0, axiosLike(408)), false);
  assert.equal(shouldRetryQuery(0, axiosLike(503)), false);
  assert.equal(shouldRetryQuery(0, axiosLike(500)), true);
  assert.equal(shouldRetryQuery(1, axiosLike(500)), true);
  assert.equal(shouldRetryQuery(2, axiosLike(500)), false);
  assert.equal(shouldRetryQuery(0, new Error("network")), true);

  assert.equal(isRateLimitError(axiosLike(429)), true);
  assert.equal(isRateLimitError(axiosLike(500)), false);

  assert.equal(parseRetryAfterMs("30"), 30_000);
  assert.equal(parseRetryAfterMs("0"), 0);
  assert.equal(parseRetryAfterMs("not-a-date"), null);
  assert.equal(getRetryAfterHeader(axiosLike(429, { "retry-after": "45" })), "45");

  const now = 1_700_000_000_000;
  assert.equal(
    resolveRateLimitUntilMs(axiosLike(429, { "retry-after": "10" }), now),
    now + 10_000,
  );
  assert.equal(
    resolveRateLimitUntilMs(axiosLike(429), now),
    now + DEFAULT_RATE_LIMIT_BACKOFF_MS,
  );

  // Amplification proof: one 429 must never schedule RQ retries.
  let attempts = 1; // original failure
  let failureCount = 0;
  while (shouldRetryQuery(failureCount, axiosLike(429))) {
    attempts += 1;
    failureCount += 1;
    if (failureCount > 5) break;
  }
  assert.equal(attempts, 1, "429 must not amplify via React Query retries");

  console.log("rate-limit-amplification-runtime: OK");
}

run();
