import { createHash, randomUUID } from "node:crypto";
import type { Request } from "express";

const SCAN_SESSION_HEADER = "x-caretip-scan-session";

/** Default guest visit TTL — one tab session maps to one visit until complete/expired. */
export const QR_GUEST_VISIT_TTL_MS = 24 * 60 * 60 * 1000;

/** @deprecated Bucket dedupe removed in Phase 3 — retained for migration docs/tests only. */
export const QR_SCAN_DEDUPE_WINDOW_MS = 30_000;

export type QrScanDeviceType = "mobile" | "tablet" | "desktop" | "unknown";

export class MissingScanSessionError extends Error {
  constructor() {
    super("x-caretip-scan-session header is required");
    this.name = "MissingScanSessionError";
  }
}

export function resolveScanSessionId(req: Request): string {
  const header = req.headers[SCAN_SESSION_HEADER];
  if (typeof header === "string" && header.trim()) {
    return header.trim().slice(0, 64);
  }
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim() ?? "unknown"
      : req.ip ?? "unknown";
  const ua = req.headers["user-agent"] ?? "";
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 32);
}

/** Phase 3 — scan recording requires an explicit client session; no silent IP fallback. */
export function resolveRequiredScanSessionId(req: Request): string {
  const header = req.headers[SCAN_SESSION_HEADER];
  if (typeof header === "string" && header.trim()) {
    return header.trim().slice(0, 64);
  }
  throw new MissingScanSessionError();
}

export function newScanSessionId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 32);
}

export function parseDeviceType(userAgent: string | undefined): QrScanDeviceType {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "unknown";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android.*mobile|blackberry|windows phone/.test(ua)) return "mobile";
  return "desktop";
}

export function resolveEntryPath(req: Request): string {
  const raw = req.originalUrl || req.url || req.path || "/";
  return raw.slice(0, 512);
}

export function resolveGeoFromRequest(req: Request): { country: string | null; city: string | null } {
  const countryHeader =
    req.headers["cf-ipcountry"] ??
    req.headers["x-vercel-ip-country"] ??
    req.headers["x-country-code"];
  const cityHeader = req.headers["x-vercel-ip-city"] ?? req.headers["cf-ipcity"];
  const country =
    typeof countryHeader === "string" && countryHeader.trim() && countryHeader !== "XX"
      ? countryHeader.trim().slice(0, 64)
      : null;
  const city = typeof cityHeader === "string" && cityHeader.trim() ? cityHeader.trim().slice(0, 128) : null;
  return { country, city };
}

/** @deprecated Phase 3 — visit-scoped dedupe replaces bucket windows. */
export function scanDedupeBucket(at: Date = new Date()): number {
  return Math.floor(at.getTime() / QR_SCAN_DEDUPE_WINDOW_MS);
}

export type ScanDedupeKeyParts = {
  businessId: string;
  sessionId: string;
  /** @deprecated */
  at?: Date;
};

/**
 * Phase 3 — one visit id → one dedupe key for qr_scan_events.
 * Format: visit:{visitId}
 */
export function buildVisitScanDedupeKey(visitId: string): string {
  return `visit:${visitId}`.slice(0, 191);
}

/** @deprecated Use buildVisitScanDedupeKey — bucket dedupe removed in Phase 3. */
export function buildScanDedupeKey(parts: ScanDedupeKeyParts): string {
  const bucket = scanDedupeBucket(parts.at ?? new Date());
  return `scan:${parts.businessId}:${parts.sessionId}:${bucket}`.slice(0, 191);
}
