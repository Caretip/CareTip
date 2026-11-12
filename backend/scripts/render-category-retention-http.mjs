/**
 * Render Cron Job HTTP caller for category-retention sweep/tick.
 * Uses Node fetch (no curl) — Render node cron runtimes may not ship curl.
 *
 * Env (cron service):
 *   CRON_SECRET — required; must match web service CRON_SECRET
 *   CARE_TIP_API_ORIGIN — default https://caretip.onrender.com
 *   CARE_TIP_INTERNAL_JOB_PATH — e.g. /api/internal/jobs/category-retention-sweep
 *   CARE_TIP_JOB_TIMEOUT_MS — optional client timeout (default 120000, max 900000). The API keeps
 *     running a job if this caller gives up; jobs that must not overlap hold their own lease.
 */
const secret = process.env.CRON_SECRET?.trim();
if (!secret) {
  console.error("CRON_SECRET is not set; refusing to call internal jobs (fail-closed).");
  process.exit(1);
}

const jobPath = process.env.CARE_TIP_INTERNAL_JOB_PATH?.trim();
if (!jobPath) {
  console.error("CARE_TIP_INTERNAL_JOB_PATH must be set.");
  process.exit(1);
}

const origin = (process.env.CARE_TIP_API_ORIGIN?.trim() || "https://caretip.onrender.com").replace(
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
    headers: { "x-cron-secret": secret },
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
