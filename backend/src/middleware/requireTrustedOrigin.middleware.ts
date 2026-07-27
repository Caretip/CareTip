import type { Request, Response, NextFunction } from "express";
import { isCorsOriginAllowed } from "../config/cors.js";
import {
  CARETIP_CLIENT_HEADER,
  CARETIP_CLIENT_HEADER_VALUE,
} from "./requireCaretipClientHeader.middleware.js";

function originFromReferer(referer: string | undefined): string | undefined {
  const trimmed = referer?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).origin;
  } catch {
    return undefined;
  }
}

/** Resolve browser origin from `Origin`, falling back to `Referer`. */
export function resolveRequestOrigin(req: Request): string | undefined {
  const origin = req.get("origin")?.trim();
  if (origin) return origin;
  return originFromReferer(req.get("referer") ?? undefined);
}

/**
 * CSRF guard for cookie-authenticated auth routes.
 * - Browser: Origin/Referer must be allowlisted.
 * - Native (Expo): no Origin is sent; `X-CareTip-Client: 1` is the CSRF stand-in
 *   (same header already required on refresh/logout).
 */
export function requireTrustedOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = resolveRequestOrigin(req);
  if (origin) {
    if (!isCorsOriginAllowed(origin)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    next();
    return;
  }

  const client = req.get(CARETIP_CLIENT_HEADER)?.trim();
  if (client === CARETIP_CLIENT_HEADER_VALUE) {
    next();
    return;
  }

  res.status(403).json({ message: "Forbidden" });
}
