/**
 * Guest Checkout return-origin for Stripe success/cancel URLs.
 * Strips trailing slashes. Production must be an HTTPS public origin — never localhost.
 */

export type FrontendUrlPresence = "PRESENT" | "MISSING";
export type FrontendUrlProtocol = "HTTPS" | "HTTP" | "OTHER" | "NONE";
export type FrontendUrlHostClass = "PUBLIC" | "LOCALHOST" | "NONE";

export type FrontendUrlClassification = {
  presence: FrontendUrlPresence;
  protocol: FrontendUrlProtocol;
  hostClass: FrontendUrlHostClass;
  /** Hostname only — never a secret. */
  hostname: string | null;
  parseable: boolean;
};

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

export function isLocalCheckoutHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host === "::"
  );
}

export function classifyCheckoutFrontendUrl(rawInput: string | undefined | null): FrontendUrlClassification {
  const raw = rawInput?.trim() ?? "";
  if (!raw) {
    return {
      presence: "MISSING",
      protocol: "NONE",
      hostClass: "NONE",
      hostname: null,
      parseable: false,
    };
  }

  try {
    const parsed = new URL(raw);
    const protocol =
      parsed.protocol === "https:" ? "HTTPS" : parsed.protocol === "http:" ? "HTTP" : "OTHER";
    const hostname = parsed.hostname || null;
    const hostClass =
      hostname && isLocalCheckoutHostname(hostname) ? "LOCALHOST" : hostname ? "PUBLIC" : "NONE";
    return {
      presence: "PRESENT",
      protocol,
      hostClass,
      hostname,
      parseable: true,
    };
  } catch {
    return {
      presence: "PRESENT",
      protocol: "OTHER",
      hostClass: "NONE",
      hostname: null,
      parseable: false,
    };
  }
}

function parseFrontendUrlCandidates(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseHttpOrigin(candidate: string): URL | null {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function assertProductionFrontendUrl(parsed: URL): void {
  if (parsed.protocol !== "https:") {
    throw new Error("FRONTEND_URL must use HTTPS in production");
  }
  if (isLocalCheckoutHostname(parsed.hostname)) {
    throw new Error("FRONTEND_URL must not be localhost in production");
  }
}

export function resolveCheckoutFrontendBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.FRONTEND_URL?.trim() ?? "";
  const isProd = env.NODE_ENV === "production";

  if (!raw) {
    if (isProd) {
      throw new Error("FRONTEND_URL is required in production");
    }
    return "http://localhost:5173";
  }

  const candidates = parseFrontendUrlCandidates(raw);
  const parsedCandidates = candidates
    .map((candidate) => parseHttpOrigin(candidate))
    .filter((parsed): parsed is URL => parsed != null);

  if (parsedCandidates.length === 0) {
    throw new Error("FRONTEND_URL is not a valid URL");
  }

  const chosen =
    !isProd
      ? (parsedCandidates.find((parsed) => isLocalCheckoutHostname(parsed.hostname)) ??
        parsedCandidates[0]!)
      : (parsedCandidates.find(
          (parsed) => !isLocalCheckoutHostname(parsed.hostname) && parsed.protocol === "https:",
        ) ?? parsedCandidates[0]!);

  if (isProd) {
    assertProductionFrontendUrl(chosen);
  }

  return `${chosen.protocol}//${chosen.host}`.replace(/\/$/, "");
}

/**
 * Absolute link to a CareTip SPA route on the trusted FRONTEND_URL origin.
 * Accepts an app path (`/employee/tip-history`) or an absolute URL already on that origin.
 * Throws when FRONTEND_URL is missing/invalid or the target leaves the trusted origin.
 */
/**
 * In-app destination for stored links (notification and announcement URLs). Returns the
 * normalized path, query and hash on the CareTip app origin, or null for anything else:
 * other hosts, protocol-relative `//host`, backslashes, control characters, encoded slashes
 * that decode into `//`, and non-http schemes such as `javascript:` or `data:`.
 * An absolute URL on FRONTEND_URL is accepted and reduced to its path.
 */
export function toSafeAppPath(target: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = typeof target === "string" ? target.trim() : "";
  if (!raw || raw.length > 2048) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  let decoded = raw;
  try {
    // Two decoding passes catch %2F%2F and double-encoded %252F%252F tricks.
    decoded = decodeURIComponent(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return null;
  let base: URL;
  try {
    base = new URL(`${resolveCheckoutFrontendBaseUrl(env)}/`);
  } catch {
    return null;
  }
  const isPath = raw.startsWith("/") && !raw.startsWith("//") && !decoded.startsWith("//");
  if (!isPath && !/^https?:\/\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.origin !== base.origin || url.username || url.password) return null;
  if (url.pathname.startsWith("//")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildTrustedAppUrl(target: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = target.trim();
  if (!raw) throw new Error("App link target is empty");
  const base = resolveCheckoutFrontendBaseUrl(env);
  const isAppPath = raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\");
  if (!isAppPath && !/^https?:\/\//i.test(raw)) {
    throw new Error("App link target must be an app path or an absolute URL on FRONTEND_URL");
  }
  const url = new URL(raw, `${base}/`);
  if (url.origin !== new URL(base).origin) {
    throw new Error("App link target is not on the FRONTEND_URL origin");
  }
  return url.toString();
}
