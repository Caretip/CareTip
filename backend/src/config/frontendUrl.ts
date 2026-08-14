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

export function resolveCheckoutFrontendBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.FRONTEND_URL?.trim() ?? "";
  const isProd = env.NODE_ENV === "production";

  if (!raw) {
    if (isProd) {
      throw new Error("FRONTEND_URL is required in production");
    }
    return "http://localhost:5173";
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("FRONTEND_URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("FRONTEND_URL must be an http or https origin");
  }

  const base = `${parsed.protocol}//${parsed.host}`.replace(/\/$/, "");

  if (isProd) {
    if (parsed.protocol !== "https:") {
      throw new Error("FRONTEND_URL must use HTTPS in production");
    }
    if (isLocalCheckoutHostname(parsed.hostname)) {
      throw new Error("FRONTEND_URL must not be localhost in production");
    }
  }

  return base;
}
