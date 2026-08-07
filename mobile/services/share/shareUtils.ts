/**
 * Pure share helpers — no React Native imports (safe for node runtime tests).
 */

const BLOCKED_QUERY_PARAM =
  /(?:^|[?&])(access_token|refresh_token|authorization|token|id_token|jwt|x-amz-signature|x-amz-credential|x-amz-security-token|signature|sig|auth)=/i;

/** Hosts / patterns that must never be shared (dev, API, staging, tunnels). */
const BLOCKED_HOST_PATTERN =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|.*\.local|.*\.onrender\.com|.*\.expo\.dev|.*\.ngrok(?:-free)?\.(?:app|io)|.*\.trycloudflare\.com)$/i;

const BLOCKED_HOST_SUBSTRING = /(staging|preview|dev\.|development)/i;

/** Default production CareTip public landing hosts. */
const DEFAULT_ALLOWED_HOSTS = new Set(["caretip.de", "www.caretip.de"]);

export type PublicUrlCheckOptions = {
  /** Authenticated API origin — never shareable. */
  apiBaseUrl?: string;
  /** Public app / landing origin (EXPO_PUBLIC_APP_URL). */
  appPublicUrl?: string;
};

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (BLOCKED_HOST_PATTERN.test(h)) return true;
  if (BLOCKED_HOST_SUBSTRING.test(h)) return true;
  return false;
}

function isAllowedPublicHost(host: string, appPublicUrl?: string): boolean {
  const h = host.toLowerCase();
  if (isBlockedHost(h)) return false;
  if (DEFAULT_ALLOWED_HOSTS.has(h)) return true;

  if (appPublicUrl?.trim()) {
    try {
      const app = new URL(appPublicUrl.trim());
      if (app.protocol !== "https:") return false;
      const appHost = app.host.toLowerCase();
      if (isBlockedHost(appHost)) return false;
      if (appHost === h) return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * True only for public CareTip landing / tip URLs safe to put in a system share sheet.
 */
export function isPublicHttpUrl(value: string, options?: PublicUrlCheckOptions): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    // Production shares must be https; allow http only for explicit local testing is disabled —
    // public CareTip landings are https. Reject plain http entirely for share safety.
    if (parsed.protocol !== "https:") return false;

    if (parsed.username || parsed.password) return false;
    if (BLOCKED_QUERY_PARAM.test(trimmed)) return false;
    // JWT-shaped fragments in query/hash
    if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(trimmed)) return false;

    const path = parsed.pathname.toLowerCase();
    if (path === "/api" || path.startsWith("/api/")) return false;
    if (path.startsWith("/auth/") || path.includes("/oauth")) return false;

    if (options?.apiBaseUrl) {
      try {
        const apiHost = new URL(options.apiBaseUrl.trim()).host.toLowerCase();
        if (apiHost && parsed.host.toLowerCase() === apiHost) return false;
      } catch {
        // ignore
      }
    }

    if (!isAllowedPublicHost(parsed.host, options?.appPublicUrl)) return false;

    return true;
  } catch {
    return false;
  }
}

export type ParsedDataUriImage = {
  mimeType: string;
  extension: string;
  base64: string;
};

export function parseDataUriImage(dataUri: string): ParsedDataUriImage | null {
  const trimmed = dataUri.trim();
  const match = /^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const mimeType = match[1].toLowerCase();
  const kind = match[2].toLowerCase();
  const extension = kind === "jpeg" || kind === "jpg" ? "jpg" : kind === "webp" ? "webp" : "png";
  const base64 = match[3].replace(/\s+/g, "");
  if (!base64) return null;
  return { mimeType, extension, base64 };
}

/** React Native Share dismiss / cancel heuristics (cross-platform). */
export function isShareCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: string }).message ?? "").toLowerCase();
  return (
    message.includes("cancel") ||
    message.includes("dismiss") ||
    message.includes("user did not share") ||
    message.includes("sharing canceled") ||
    message.includes("sharing cancelled")
  );
}
