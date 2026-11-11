import type { Request, RequestHandler } from "express";
import { forwardedChainDepth, ipPrefixForLog, resolveClientIp } from "../lib/clientIp.js";
import { enforceRateLimitLayersDistributed } from "../utils/rateLimitStore.js";

/**
 * Simple single-bucket limiter on the shared store, so a public limit holds across API instances
 * and restarts. Uses process memory only when shared storage is not configured or is down.
 */
export function sharedRateLimit(options: {
  scope: string;
  windowMs: number;
  max: number;
  message: string;
  /** Defaults to the client address. Must not include anything the caller can vary freely. */
  key?: (req: Request) => string;
}): RequestHandler {
  return (req, res, next) => {
    const subject = options.key?.(req) ?? `ip:${resolveClientIp(req)}`;
    void enforceRateLimitLayersDistributed([
      { name: "key", key: `sec:${options.scope}:${subject}`, max: options.max, windowMs: options.windowMs },
    ])
      .then((outcome) => {
        if (outcome.ok) {
          next();
          return;
        }
        console.info(`[security.rateLimit] blocked scope=${options.scope} layer=${outcome.layer}`, {
          ipPrefix: ipPrefixForLog(resolveClientIp(req)),
          xffDepth: forwardedChainDepth(req),
        });
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((outcome.resetAtMs - Date.now()) / 1000))));
        res.status(429).json({ message: options.message });
      })
      .catch((err) => {
        console.error(`[security.rateLimit] error scope=${options.scope}`, err);
        res.setHeader("Retry-After", "60");
        res.status(429).json({ message: options.message });
      });
  };
}
