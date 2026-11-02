import type { Request } from "express";

/**
 * Client address as resolved by Express `req.ip`, which honours `app.set("trust proxy", …)`
 * (see index.ts). Never read `X-Forwarded-For` directly: its left-most entries are client-supplied.
 * Network-level only — not an identity or a precise location.
 */
export function trustedClientIp(req: Pick<Request, "ip">): string | null {
  const ip = typeof req.ip === "string" ? req.ip.trim() : "";
  if (!ip) return null;
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}
