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
