import type { Request, RequestHandler } from "express";

/**
 * Legacy API hostname traffic watch (retirement of the Render-generated `*.onrender.com` address).
 *
 * The API answers on both `api.caretip.de` and Render's generated hostname until the latter is
 * disabled. Before disabling it, old-host traffic must be shown to be gone. This counts requests
 * whose Host header is a `*.onrender.com` name, by caller category, and logs one summary line per
 * minute per instance while such traffic exists:
 *
 *   [legacy-host] caretip.onrender.com 60s: mobile_app=3 stripe_webhook=1 (total 4)
 *
 * Privacy: no address, user, token, header value or full path is recorded, only the category.
 * The Host header is client-controlled; this is a traffic measurement, never an access decision.
 * Socket.IO requests are answered before Express and are not counted (their clients also make
 * ordinary API calls, which are).
 */
export const LEGACY_HOST_SUFFIX = ".onrender.com";
export const LEGACY_HOST_REPORT_INTERVAL_MS = 60_000;

export type LegacyHostCategory =
  | "health"
  | "stripe_webhook"
  | "internal_job"
  | "legal_webhook"
  | "oauth_callback"
  | "web_session_move"
  | "mobile_app"
  | "media"
  | "other";

type Pick_ = Pick<Request, "path" | "method"> & { headers: Request["headers"] };

/** Lowercased host without port, or "" when absent/unparseable. */
export function requestHostname(headers: Request["headers"]): string {
  const raw = headers.host;
  if (typeof raw !== "string" || !raw) return "";
  return raw.trim().toLowerCase().replace(/:\d+$/, "");
}

export function isLegacyApiHost(hostname: string): boolean {
  return hostname.endsWith(LEGACY_HOST_SUFFIX) && hostname.length > LEGACY_HOST_SUFFIX.length;
}

export function classifyLegacyHostRequest(req: Pick_): LegacyHostCategory {
  const p = req.path || "/";
  if (p === "/health" || p === "/api/health") return "health";
  if (p.startsWith("/api/webhooks/stripe") || p.startsWith("/api/webhook/stripe")) return "stripe_webhook";
  if (p.startsWith("/api/internal/jobs")) return "internal_job";
  if (p.startsWith("/api/legal/webhook")) return "legal_webhook";
  if (/^\/api\/auth\/(apple\/native-callback|facebook\/callback|google\/redirect)/.test(p)) return "oauth_callback";
  if (p.startsWith("/uploads/") || p.startsWith("/api/media/")) return "media";
  const app = req.headers["x-caretip-app"];
  if (typeof app === "string" && app.trim().toLowerCase() === "mobile") return "mobile_app";
  if (p === "/api/auth/refresh" || p === "/api/auth/logout") {
    // Browsers always send Origin on these cross-origin POSTs (the SPA's one-time session move);
    // the native app sends none and its refresh helper omits X-CareTip-App.
    return typeof req.headers.origin === "string" && req.headers.origin ? "web_session_move" : "mobile_app";
  }
  return "other";
}

const counts = new Map<string, Map<LegacyHostCategory, number>>();
let windowStart = 0;
type Reporter = (line: string) => void;
let reporter: Reporter = (line) => console.info(line);

/** Test seam. */
export function __setLegacyHostReporterForTests(fn: Reporter | null): void {
  reporter = fn ?? ((line) => console.info(line));
  counts.clear();
  windowStart = 0;
}

function flush(now: number): void {
  // Actual length of the counting window: a window ends only when the next legacy request (or a
  // flush) arrives, so quiet periods make it longer than the reporting interval.
  const seconds = windowStart > 0 ? Math.max(1, Math.round((now - windowStart) / 1000)) : 0;
  for (const [host, byCategory] of counts) {
    let total = 0;
    const parts: string[] = [];
    for (const [cat, n] of [...byCategory].sort((a, b) => a[0].localeCompare(b[0]))) {
      parts.push(`${cat}=${n}`);
      total += n;
    }
    if (total > 0) reporter(`[legacy-host] ${host} ${seconds}s: ${parts.join(" ")} (total ${total})`);
  }
  counts.clear();
  windowStart = now;
}

/** Counts one request; returns its category when it arrived on a legacy host. */
export function recordLegacyHostRequest(req: Pick_, now = Date.now()): LegacyHostCategory | null {
  const host = requestHostname(req.headers);
  if (!isLegacyApiHost(host)) return null;
  if (windowStart === 0) windowStart = now;
  if (now - windowStart >= LEGACY_HOST_REPORT_INTERVAL_MS) flush(now);
  const category = classifyLegacyHostRequest(req);
  // Bounded: a client can send any Host, so cap distinct hosts tracked per window.
  if (!counts.has(host) && counts.size >= 8) return category;
  const byCategory = counts.get(host) ?? new Map<LegacyHostCategory, number>();
  byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
  counts.set(host, byCategory);
  return category;
}

/** Report whatever is pending (tests, shutdown). */
export function flushLegacyHostCounts(now = Date.now()): void {
  flush(now);
}

export const legacyHostMonitor: RequestHandler = (req, _res, next) => {
  try {
    recordLegacyHostRequest(req);
  } catch {
    /* measurement must never affect a request */
  }
  next();
};
