import type { RequestHandler } from "express";

/**
 * In-process 5xx rate watch. Render cannot alert on HTTP error rates and Sentry's rate-based alert
 * types need a paid plan, so the API reports a high server-error rate itself, as one Sentry issue
 * (tag caretip_alert=api_5xx_rate) that a plain issue alert can email.
 *
 * Per instance: over the last 5 minutes, at least 200 requests and more than 2 % answered 5xx.
 * Health checks are excluded (they return 503 on purpose while an instance drains during a deploy).
 * At most one report per 15 minutes per instance.
 */
export const ERROR_RATE_WINDOW_MS = 5 * 60_000;
export const ERROR_RATE_MIN_REQUESTS = 200;
export const ERROR_RATE_THRESHOLD = 0.02;
export const ERROR_RATE_REPORT_INTERVAL_MS = 15 * 60_000;
const BUCKET_MS = 60_000;

type Bucket = { start: number; total: number; errors: number };
const buckets: Bucket[] = [];
let lastReportAt = 0;
type Reporter = (summary: { total: number; errors: number; rate: number }) => void;
let reporter: Reporter = (summary) => {
  console.error("[alert] api_5xx_rate high", summary);
  void import("../instrument/sentry.js").then(({ captureServerException }) =>
    captureServerException(new Error(`API 5xx rate ${(summary.rate * 100).toFixed(1)}% over 5 minutes`), { alert: "api_5xx_rate", ...summary }),
  );
};

/** Test seam. */
export function __setErrorRateReporterForTests(fn: Reporter | null, reset = true): void {
  if (fn) reporter = fn;
  if (reset) {
    buckets.length = 0;
    lastReportAt = 0;
  }
}

export function recordResponse(status: number, nowMs = Date.now()): void {
  const start = nowMs - (nowMs % BUCKET_MS);
  let b = buckets[buckets.length - 1];
  if (!b || b.start !== start) {
    b = { start, total: 0, errors: 0 };
    buckets.push(b);
    while (buckets.length && buckets[0]!.start <= nowMs - ERROR_RATE_WINDOW_MS) buckets.shift();
  }
  b.total += 1;
  if (status >= 500) b.errors += 1;
  evaluate(nowMs);
}

function evaluate(nowMs: number): void {
  if (nowMs - lastReportAt < ERROR_RATE_REPORT_INTERVAL_MS) return;
  let total = 0;
  let errors = 0;
  for (const b of buckets) {
    if (b.start > nowMs - ERROR_RATE_WINDOW_MS) {
      total += b.total;
      errors += b.errors;
    }
  }
  if (total < ERROR_RATE_MIN_REQUESTS) return;
  const rate = errors / total;
  if (rate <= ERROR_RATE_THRESHOLD) return;
  lastReportAt = nowMs;
  reporter({ total, errors, rate: Math.round(rate * 1000) / 1000 });
}

const EXCLUDED = new Set(["/health", "/api/health"]);

export const httpErrorRateMonitor: RequestHandler = (req, res, next) => {
  if (!EXCLUDED.has(req.path)) res.once("finish", () => recordResponse(res.statusCode));
  next();
};
