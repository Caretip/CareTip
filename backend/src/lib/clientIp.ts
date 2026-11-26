import { isIP } from "node:net";
import jwt from "jsonwebtoken";
import type { Express, Request } from "express";
import type { IncomingMessage } from "node:http";

/**
 * Client address resolution. Every limiter, log and alert uses this, so there is one rule.
 *
 * Express walks X-Forwarded-For from the right, skipping trusted proxies:
 * - TRUST_PROXY_CIDRS: a list of proxy address ranges. Safe against spoofing even when someone
 *   reaches the origin directly, because only listed addresses are skipped. Preferred.
 * - TRUST_PROXY_HOPS: a fixed number of proxies. Correct only if every request crosses exactly
 *   that many; a request that skips one can choose its own address. Defaults to 1, which cannot
 *   be spoofed but reports the proxy's address when there are two.
 *
 * `x-forwarded-for` must never be read directly anywhere else.
 */
export const DEFAULT_TRUST_PROXY_HOPS = 1;
const MAX_TRUST_PROXY_HOPS = 5;

export type TrustProxySetting = number | string[] | false;

export function resolveTrustProxySetting(env: NodeJS.ProcessEnv = process.env): TrustProxySetting {
  const cidrs = env.TRUST_PROXY_CIDRS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (cidrs.length > 0) return ["loopback", "linklocal", "uniquelocal", ...cidrs];
  if (env.NODE_ENV !== "production") return false;
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return DEFAULT_TRUST_PROXY_HOPS;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0 || hops > MAX_TRUST_PROXY_HOPS) {
    console.error(`[security.clientIp] invalid TRUST_PROXY_HOPS, using ${DEFAULT_TRUST_PROXY_HOPS}`);
    return DEFAULT_TRUST_PROXY_HOPS;
  }
  return hops;
}

export function configureTrustProxy(app: Express): void {
  const setting = resolveTrustProxySetting();
  if (setting !== false) app.set("trust proxy", setting);
}

export function normalizeIp(raw: string | undefined | null): string | null {
  let ip = String(raw ?? "").trim();
  if (ip.toLowerCase().startsWith("::ffff:")) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

/**
 * Netlify has no fixed outbound addresses, so a CIDR list cannot describe it. A signed proxy rule can:
 * Netlify adds an `x-nf-sign` token made with a shared secret, which proves the request really came
 * through Netlify, so its client address header can be believed. Off unless the secret is set.
 */
const signedClientIps = new WeakMap<object, string | null>();

function netlifySignedClientIp(req: Pick<Request, "ip"> & Partial<Pick<Request, "headers">>): string | null {
  const secret = process.env.NETLIFY_PROXY_SIGNATURE_SECRET?.trim();
  if (!secret || !req.headers) return null;
  const cached = signedClientIps.get(req);
  if (cached !== undefined) return cached;
  let result: string | null = null;
  const signature = req.headers["x-nf-sign"];
  const claimed = req.headers["x-nf-client-connection-ip"];
  if (typeof signature === "string" && typeof claimed === "string") {
    try {
      jwt.verify(signature, secret, { algorithms: ["HS256"], issuer: "netlify" });
      result = normalizeIp(claimed);
    } catch {
      result = null;
    }
  }
  signedClientIps.set(req, result);
  return result;
}

/** Never throws. An unusable address falls into one shared bucket rather than skipping limits. */
export function resolveClientIp(req: Pick<Request, "ip"> & Partial<Pick<Request, "headers">>): string {
  return netlifySignedClientIp(req) ?? normalizeIp(req.ip) ?? "unknown";
}

/**
 * Expands an IPv6 address to its eight 16-bit groups ("::" filled with zeros). Null if malformed.
 * An embedded IPv4 tail (::ffff:1.2.3.4) is handled by normalizeIp before this is reached.
 */
export function expandIPv6(ip: string): string[] | null {
  if (!ip.includes(":")) return null;
  const [head, tail, ...rest] = ip.split("::");
  if (rest.length > 0) return null;
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array(tail === undefined ? 0 : missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => g.toLowerCase().padStart(4, "0"));
}

/**
 * The client address as used in rate-limit keys. IPv4 as is; IPv6 reduced to its /64 network,
 * because one subscriber (home line, phone) normally receives a whole /64 and can rotate freely
 * inside it. Grouping by /64 keeps one device or household in one bucket. Logs and audit records
 * keep using the full address.
 */
export function rateLimitIp(req: Pick<Request, "ip"> & Partial<Pick<Request, "headers">>): string {
  const ip = resolveClientIp(req);
  if (!ip.includes(":")) return ip;
  const groups = expandIPv6(ip);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : ip;
}

/**
 * Express's own `req.ip` for a raw Node request (for example the Socket.IO handshake), so the same
 * trust-proxy rule applies and a forged X-Forwarded-For cannot pick its own rate-limit bucket.
 */
export function rateLimitIpForRawRequest(app: Express | null | undefined, raw: IncomingMessage): string {
  if (!app) return normalizeIp(raw.socket?.remoteAddress) ?? "unknown";
  const view = Object.create(app.request, {
    app: { value: app },
    headers: { value: raw.headers },
    socket: { value: raw.socket },
    connection: { value: raw.socket },
  }) as Request;
  return rateLimitIp(view);
}

/** The same address, or null when there isn't one. Network-level only, not an identity or a location. */
export function trustedClientIp(req: Pick<Request, "ip"> & Partial<Pick<Request, "headers">>): string | null {
  const ip = resolveClientIp(req);
  return ip === "unknown" ? null : ip;
}

/** How many entries the forwarded chain has: shows the real proxy depth without logging addresses. */
export function forwardedChainDepth(req: Pick<Request, "headers">): number {
  const raw = req.headers["x-forwarded-for"];
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  return value ? value.split(",").filter((p) => p.trim()).length : 0;
}

const CHAIN_WARN_INTERVAL_MS = 60 * 60 * 1000;
let lastChainWarnAt = 0;

/**
 * Makes a too-low hop count visible. When requests arrive through more proxies than configured,
 * several clients can share one address, and without this nothing would say so.
 */
export function noteForwardedChain(req: Pick<Request, "headers">, nowMs = Date.now()): boolean {
  const setting = resolveTrustProxySetting();
  if (typeof setting !== "number" || process.env.NETLIFY_PROXY_SIGNATURE_SECRET?.trim()) return false;
  const depth = forwardedChainDepth(req);
  if (depth <= setting || nowMs - lastChainWarnAt < CHAIN_WARN_INTERVAL_MS) return false;
  lastChainWarnAt = nowMs;
  console.warn(`[security.clientIp] forwarded chain depth ${depth} exceeds trusted hops ${setting}: clients may share rate-limit buckets. See the Render configuration guide.`);
  return true;
}

/** Network prefix for logs: enough to spot a shared proxy range, without recording a person's address. */
export function ipPrefixForLog(ip: string): string {
  if (ip.includes(".")) return `${ip.split(".").slice(0, 3).join(".")}.0/24`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}::/48`;
  return ip;
}

export type AddressKind = "loopback" | "private" | "link-local" | "cgnat" | "public" | "invalid";

/** Coarse class of an address, for proxy diagnostics (never used for access decisions). */
export function addressKind(raw: string | null | undefined): AddressKind {
  const ip = normalizeIp(raw);
  if (!ip) return "invalid";
  if (ip.includes(":")) {
    const g = expandIPv6(ip);
    if (!g) return "invalid";
    if (g.join(":") === "0000:0000:0000:0000:0000:0000:0000:0001") return "loopback";
    const first = parseInt(g[0]!, 16);
    if ((first & 0xfe00) === 0xfc00) return "private";
    if ((first & 0xffc0) === 0xfe80) return "link-local";
    return "public";
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  if (a === 127) return "loopback";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
  if (a === 169 && b === 254) return "link-local";
  if (a === 100 && b >= 64 && b <= 127) return "cgnat";
  return "public";
}

/**
 * The shape of the proxy chain this request arrived through, with address prefixes only. Shown in
 * the secret-gated /health detail so the real chain can be measured before choosing
 * TRUST_PROXY_HOPS or TRUST_PROXY_CIDRS (for example after putting Cloudflare in front).
 */
export function describeProxyChain(req: Pick<Request, "ip" | "headers"> & { socket?: { remoteAddress?: string } }) {
  const raw = req.headers["x-forwarded-for"];
  const entries = (Array.isArray(raw) ? raw.join(",") : raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const resolved = resolveClientIp(req);
  const cf = typeof req.headers["cf-connecting-ip"] === "string" ? normalizeIp(req.headers["cf-connecting-ip"]) : null;
  // Prefixes only for public / carrier-grade addresses (needed to choose TRUST_PROXY_CIDRS);
  // internal addresses are reported by kind alone. Never a full address, never a header value.
  const describe = (ip: string | null | undefined) => {
    const n = normalizeIp(ip);
    const kind = addressKind(ip);
    return { kind, prefix: n && (kind === "public" || kind === "cgnat") ? ipPrefixForLog(n) : null };
  };
  const setting = resolveTrustProxySetting();
  return {
    // The mode, not the configured ranges.
    trustProxy: setting === false ? "off" : typeof setting === "number" ? `hops:${setting}` : `cidrs:${setting.length - 3}`,
    forwardedEntries: entries.length,
    // Left = as sent by the client side, right = added by the nearest proxy.
    forwarded: entries.slice(-6).map(describe),
    socketPeer: describe(req.socket?.remoteAddress),
    resolvedClient: describe(resolved),
    cfConnectingIpPresent: cf !== null,
    cfConnectingIpMatchesResolved: cf !== null && cf === resolved,
    trueClientIpPresent: typeof req.headers["true-client-ip"] === "string",
  };
}
