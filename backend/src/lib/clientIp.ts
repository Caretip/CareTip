import { isIP } from "node:net";
import jwt from "jsonwebtoken";
import type { Express, Request } from "express";

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
