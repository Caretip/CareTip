import type { Request } from "express";

export type AuthLinkPlatform = "web" | "mobile";

/**
 * Distinct from `X-CareTip-Client` (CSRF stand-in used by both web and mobile).
 * Only the Expo app sends `X-CareTip-App: mobile`.
 */
const CARETIP_APP_HEADER = "x-caretip-app";

export function resolveAuthLinkPlatform(req: Request): AuthLinkPlatform {
  const appHeader = req.get(CARETIP_APP_HEADER)?.trim().toLowerCase();
  if (appHeader === "mobile" || appHeader === "app") return "mobile";
  const body = req.body as Record<string, unknown> | undefined;
  const explicit = body?.clientPlatform ?? body?.platform;
  if (typeof explicit === "string" && explicit.trim().toLowerCase() === "mobile") {
    return "mobile";
  }
  return "web";
}
