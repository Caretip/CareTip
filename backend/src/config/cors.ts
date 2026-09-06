import type { CorsOptions } from "cors";

const PRODUCTION_ORIGINS = [
  "https://caretip.de",
  "https://www.caretip.de",
] as const;

function originFromUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function collectAllowedOrigins(): Set<string> {
  const allowed = new Set<string>(PRODUCTION_ORIGINS);

  for (const key of ["FRONTEND_URL", "NEXT_PUBLIC_APP_URL", "VITE_APP_URL"] as const) {
    const v = process.env[key]?.trim();
    if (!v) continue;
    const o = originFromUrl(v);
    if (o) allowed.add(o);
  }

  const extra = process.env.CORS_ORIGINS?.trim();
  if (extra) {
    for (const part of extra.split(",")) {
      const o = originFromUrl(part);
      if (o) allowed.add(o);
    }
  }

  return allowed;
}

const allowedOrigins = collectAllowedOrigins();

function isLocalDevOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}

/** Whether a browser `Origin` may use credentialed API / Socket.IO requests. */
export function isCorsOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  if (process.env.NODE_ENV !== "production" && isLocalDevOrigin(origin)) return true;
  return false;
}

export function getCorsAllowedOrigins(): readonly string[] {
  return [...allowedOrigins];
}

export const corsMiddlewareOptions: CorsOptions = {
  origin(origin, callback) {
    if (isCorsOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true,
  // Do not CORS-expose the refresh token. Native clients can still read X-CareTip-Refresh;
  // browsers must use the HttpOnly cookie only.
};

export const socketCorsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    callback(null, isCorsOriginAllowed(origin));
  },
  credentials: true as const,
};
