import { createHash } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { Request, RequestHandler } from "express";
import { safeSecretEqual } from "./safeCompare.js";
import { classifyLegacyHostRequest, requestHostname } from "./legacyHostMonitor.js";

/**
 * Cloudflare origin protection (application level).
 *
 * Render cannot restrict inbound traffic to Cloudflare's addresses on the current plan, so anyone can
 * reach the origin directly (`caretip.onrender.com`, or Render's edge with `Host: api.caretip.de`).
 * Cloudflare adds a secret request header to every request it forwards (Transform Rule, "Set static",
 * which also overwrites any client-sent value); the API checks it here.
 *
 * Modes (`ORIGIN_PROTECTION_MODE`):
 * - `off` (default): no check. Deploying this code changes nothing.
 * - `report`: check and count failures in a per-minute log line, but let every request through.
 *   Use it to confirm that all legitimate traffic carries the header before enforcing.
 * - `enforce`: requests without the correct header get 403 before any other work (no body parsing,
 *   no database, no rate-limit store). Socket.IO handshakes are refused the same way.
 *
 * Secrets: `ORIGIN_PROTECTION_SECRET` (≥ 32 characters) and optionally
 * `ORIGIN_PROTECTION_SECRET_PREVIOUS` during rotation. Compared in constant time (SHA-256 + timingSafeEqual).
 * The header is removed from the request after the check, so no later code, log or Sentry event sees it
 * (Sentry also filters any field whose name contains "secret").
 *
 * The only exemption: `GET`/`HEAD` of exactly `/health` and `/api/health`. Render's health checker connects
 * to the instance directly and cannot carry the header; both endpoints return only a status without
 * `HEALTH_CHECK_SECRET`, perform no writes, and `/api/health` shares one database probe per 5 s.
 *
 * A verified request provably passed through Cloudflare, so its `CF-Connecting-IP` (always set by
 * Cloudflare, client values overwritten) is used as the client address (`clientIp.ts`).
 */
export const ORIGIN_PROTECTION_HEADER = "x-caretip-origin-secret";
export const ORIGIN_SECRET_MIN_LENGTH = 32;
export const ORIGIN_PROTECTION_REPORT_INTERVAL_MS = 60_000;
const EXEMPT_HEALTH_PATHS = new Set(["/health", "/api/health"]);

export type OriginProtectionMode = "off" | "report" | "enforce";

export type OriginProtectionConfig = {
  mode: OriginProtectionMode;
  secrets: string[];
  /** Startup must stop (enforcement requested but unsafe). Never contains a secret value. */
  fatal: string[];
  warnings: string[];
};

/** Short, non-reversible fingerprint so operators can compare Render and Cloudflare values. */
export function secretFingerprint(secret: string): string {
  return createHash("sha256").update(`caretip-origin:${secret}`).digest("hex").slice(0, 8);
}

export function resolveOriginProtectionConfig(env: NodeJS.ProcessEnv = process.env): OriginProtectionConfig {
  const fatal: string[] = [];
  const warnings: string[] = [];
  const rawMode = (env.ORIGIN_PROTECTION_MODE ?? "").trim().toLowerCase();
  let mode: OriginProtectionMode = "off";
  if (rawMode === "" || rawMode === "off") mode = "off";
  else if (rawMode === "report" || rawMode === "enforce") mode = rawMode;
  else {
    // A typo must not silently mean "unprotected" when someone believes protection is on.
    fatal.push(`ORIGIN_PROTECTION_MODE must be off, report or enforce (got an unrecognised value)`);
    return { mode: "off", secrets: [], fatal, warnings };
  }

  const candidates = [
    ["ORIGIN_PROTECTION_SECRET", env.ORIGIN_PROTECTION_SECRET?.trim() ?? ""],
    ["ORIGIN_PROTECTION_SECRET_PREVIOUS", env.ORIGIN_PROTECTION_SECRET_PREVIOUS?.trim() ?? ""],
  ] as const;
  const secrets: string[] = [];
  const problems: string[] = [];
  const others = [env.CRON_SECRET, env.HEALTH_CHECK_SECRET, env.JWT_SECRET].map((s) => s?.trim()).filter(Boolean);
  for (const [name, value] of candidates) {
    if (!value) continue;
    if (value.length < ORIGIN_SECRET_MIN_LENGTH) {
      problems.push(`${name} must be at least ${ORIGIN_SECRET_MIN_LENGTH} characters`);
      continue;
    }
    if (others.includes(value)) {
      problems.push(`${name} must not reuse CRON_SECRET, HEALTH_CHECK_SECRET or JWT_SECRET`);
      continue;
    }
    secrets.push(value);
  }
  if (!candidates[0][1]) problems.push("ORIGIN_PROTECTION_SECRET is not set");

  if (mode === "off") return { mode, secrets: [], fatal, warnings };

  if (mode === "enforce" && (problems.length > 0 || secrets.length === 0)) {
    fatal.push(...problems.map((p) => `ORIGIN_PROTECTION_MODE=enforce: ${p}`));
    if (problems.length === 0) fatal.push("ORIGIN_PROTECTION_MODE=enforce: no usable secret");
    return { mode, secrets: [], fatal, warnings };
  }
  if (mode === "report" && (problems.length > 0 || secrets.length === 0)) {
    // Reporting must never break traffic: misconfigured report mode behaves as off, loudly.
    warnings.push(...problems.map((p) => `ORIGIN_PROTECTION_MODE=report: ${p}; origin protection is OFF`));
    return { mode: "off", secrets: [], fatal, warnings };
  }
  return { mode, secrets, fatal, warnings };
}

let active: OriginProtectionConfig = resolveOriginProtectionConfig({});
const verifiedHeaders = new WeakSet<object>();

/** Load the configuration (startup, tests). Returns it so the caller can act on `fatal`. */
export function configureOriginProtection(env: NodeJS.ProcessEnv = process.env): OriginProtectionConfig {
  active = resolveOriginProtectionConfig(env);
  resetOriginProtectionCounters();
  return active;
}

export function getOriginProtectionMode(): OriginProtectionMode {
  return active.mode;
}

/** Startup summary line; never includes a secret, only fingerprints. */
export function describeOriginProtection(config: OriginProtectionConfig = active): string {
  if (config.mode === "off") return "[origin-protection] mode=off";
  const fps = config.secrets.map(secretFingerprint).join(",");
  return `[origin-protection] mode=${config.mode} header=${ORIGIN_PROTECTION_HEADER} secrets=${config.secrets.length} fingerprint=${fps}`;
}

/**
 * Checks and removes the header. True only when it matches a configured secret. Every configured secret
 * is compared (constant time each) so the outcome does not depend on which one matched.
 */
export function checkAndStripOriginHeader(headers: IncomingHttpHeaders, secrets: readonly string[] = active.secrets): boolean {
  const raw = headers[ORIGIN_PROTECTION_HEADER];
  delete headers[ORIGIN_PROTECTION_HEADER];
  // Repeated headers arrive joined or as an array: never a valid single secret.
  if (typeof raw !== "string" || raw.length === 0 || secrets.length === 0) return false;
  let ok = false;
  for (const secret of secrets) {
    if (safeSecretEqual(raw, secret)) ok = true;
  }
  if (ok) verifiedHeaders.add(headers);
  return ok;
}

/** True when this request's header was verified (same headers object for Express and Socket.IO views). */
export function isOriginVerifiedHeaders(headers: object | undefined | null): boolean {
  return Boolean(headers) && verifiedHeaders.has(headers as object);
}

export function isOriginProtectionExempt(method: string | undefined, path: string | undefined): boolean {
  const m = (method ?? "").toUpperCase();
  return (m === "GET" || m === "HEAD") && EXEMPT_HEALTH_PATHS.has(path ?? "");
}

// ── Per-minute reporting (no secret, no address, no header value) ──
type Outcome = "missing" | "invalid" | "exempt_health";
const counts = new Map<string, number>();
let windowStart = 0;
type Reporter = (line: string) => void;
let reporter: Reporter = (line) => console.warn(line);

export function __setOriginProtectionReporterForTests(fn: Reporter | null): void {
  reporter = fn ?? ((line) => console.warn(line));
  resetOriginProtectionCounters();
}

function resetOriginProtectionCounters(): void {
  counts.clear();
  windowStart = 0;
}

export function flushOriginProtectionCounts(now = Date.now()): void {
  if (counts.size > 0) {
    const seconds = windowStart > 0 ? Math.max(1, Math.round((now - windowStart) / 1000)) : 0;
    const parts = [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `${k}=${n}`);
    const verb = active.mode === "enforce" ? "rejected/exempt" : "would reject/exempt";
    reporter(`[origin-protection] mode=${active.mode} ${seconds}s ${verb}: ${parts.join(" ")}`);
  }
  counts.clear();
  windowStart = now;
}

function record(outcome: Outcome, category: string, host: string, now = Date.now()): void {
  if (windowStart === 0) windowStart = now;
  if (now - windowStart >= ORIGIN_PROTECTION_REPORT_INTERVAL_MS) flushOriginProtectionCounts(now);
  const hostLabel = host.endsWith(".onrender.com") ? "render_host" : host === "api.caretip.de" ? "api_host" : "other_host";
  const key = `${outcome}:${category}@${hostLabel}`;
  if (!counts.has(key) && counts.size >= 64) return; // bounded
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

type Decision = "allow" | "reject";

/** Shared decision for Express and Socket.IO. Always strips the header. */
export function decideOriginRequest(
  req: { method?: string; path?: string; headers: IncomingHttpHeaders },
  now = Date.now(),
): Decision {
  if (active.mode === "off") {
    delete req.headers[ORIGIN_PROTECTION_HEADER];
    return "allow";
  }
  const present = typeof req.headers[ORIGIN_PROTECTION_HEADER] !== "undefined";
  if (checkAndStripOriginHeader(req.headers)) return "allow";
  const category = (req.path ?? "").startsWith("/socket.io")
    ? "socket"
    : classifyLegacyHostRequest({ method: req.method ?? "GET", path: req.path ?? "/", headers: req.headers } as Pick<Request, "method" | "path" | "headers">);
  const host = requestHostname(req.headers);
  if (isOriginProtectionExempt(req.method, req.path)) {
    record("exempt_health", category, host, now);
    return "allow";
  }
  record(present ? "invalid" : "missing", category, host, now);
  return active.mode === "enforce" ? "reject" : "allow";
}

/** Express: mounted before body parsing, CORS, webhooks, rate limits and routes. */
export const originProtectionMiddleware: RequestHandler = (req, res, next) => {
  let decision: Decision = "allow";
  try {
    decision = decideOriginRequest(req);
  } catch {
    decision = active.mode === "enforce" ? "reject" : "allow";
  }
  if (decision === "reject") {
    res.setHeader("Cache-Control", "no-store");
    res.status(403).json({ message: "Forbidden" });
    return;
  }
  next();
};

/** Socket.IO / engine.io `allowRequest`: runs for every new session (polling or direct WebSocket). */
export function allowSocketRequest(req: IncomingMessage, callback: (err: string | null | undefined, success: boolean) => void): void {
  let decision: Decision = "allow";
  try {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    decision = decideOriginRequest({ method: req.method, path, headers: req.headers });
  } catch {
    decision = active.mode === "enforce" ? "reject" : "allow";
  }
  callback(null, decision === "allow");
}
