/**
 * Render Cron Job HTTP caller for category-retention sweep/tick.
 * Uses Node fetch (no curl) — Render node cron runtimes may not ship curl.
 *
 * Env (cron service):
 *   CRON_SECRET — required; must match web service CRON_SECRET
 *   CARE_TIP_API_ORIGIN — default https://api.caretip.de (canonical API host)
 *   CARE_TIP_INTERNAL_JOB_PATH — e.g. /api/internal/jobs/category-retention-sweep
 *   CARE_TIP_JOB_TIMEOUT_MS — optional client timeout (default 120000, max 900000). The API keeps
 *     running a job if this caller gives up; jobs that must not overlap hold their own lease.
 *   ORIGIN_PROTECTION_SECRET — required; the same value as the web service's ORIGIN_PROTECTION_SECRET.
 *     Sent as x-caretip-origin-secret so the request is origin-verified even when it does not pass
 *     through Cloudflare's Transform Rule (docs/ops/api-hostname-migration.md section 9).
 *
 * Neither secret nor any request header is ever printed.
 */
const secret = process.env.CRON_SECRET?.trim();
if (!secret) {
  console.error("CRON_SECRET is not set; refusing to call internal jobs (fail-closed).");
  process.exit(1);
}

const originSecret = process.env.ORIGIN_PROTECTION_SECRET?.trim();
if (!originSecret) {
  console.error(
    "ORIGIN_PROTECTION_SECRET is not set on this cron service; refusing to call internal jobs without the origin header (fail-closed).",
  );
  process.exit(1);
}

const jobPath = process.env.CARE_TIP_INTERNAL_JOB_PATH?.trim();
if (!jobPath) {
  console.error("CARE_TIP_INTERNAL_JOB_PATH must be set.");
  process.exit(1);
}

const origin = (process.env.CARE_TIP_API_ORIGIN?.trim() || "https://api.caretip.de").replace(
  /\/+$/,
  "",
);
const url = `${origin}${jobPath.startsWith("/") ? jobPath : `/${jobPath}`}`;

const controller = new AbortController();
const timeoutMs = Math.min(900_000, Math.max(10_000, Number(process.env.CARE_TIP_JOB_TIMEOUT_MS) || 120_000));
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-cron-secret": secret, "x-caretip-origin-secret": originSecret },
    signal: controller.signal,
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${url}`);
    if (body) console.error(body);
    process.exit(1);
  }
  console.log(body || `OK ${res.status}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Request failed ${url}: ${message}`);
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
