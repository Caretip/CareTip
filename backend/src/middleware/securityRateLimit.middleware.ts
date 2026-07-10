import type { Request, Response, NextFunction, RequestHandler } from "express";
import { resolveJwtSubject, verifyJwt, type DecodedAccessClaims } from "../lib/jwtConfig.js";
import { securityRateLimits } from "../config/securityRateLimit.config.js";
import type { RateLimitLayer } from "../utils/layeredRateLimit.js";
import { enforceRateLimitLayersDistributed } from "../utils/rateLimitStore.js";

function clientIp(req: Request): string {
  const ip = req.ip?.trim();
  return ip && ip.length > 0 ? ip : "unknown";
}

function userIdFromReq(req: Request): string {
  if (req.user?.sub) return req.user.sub;
  if (req.user?.userId) return req.user.userId;
  if (req.user?.id) return req.user.id;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return "";
  try {
    const decoded = verifyJwt<DecodedAccessClaims>(token);
    return resolveJwtSubject(decoded) ?? "";
  } catch {
    return "";
  }
}

function respondRateLimited(res: Response, message: string, resetAtMs: number): void {
  const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
  res.setHeader("Retry-After", String(retryAfterSec));
  res.status(429).json({ message });
}

function runLayers(
  req: Request,
  res: Response,
  next: NextFunction,
  layers: RateLimitLayer[],
  message: string,
  logScope: string,
): void {
  void enforceRateLimitLayersDistributed(layers)
    .then((outcome) => {
      if (!outcome.ok) {
        console.info(`[security.rateLimit] blocked scope=${logScope} layer=${outcome.layer}`, {
          ip: clientIp(req),
        });
        respondRateLimited(res, message, outcome.resetAtMs);
        return;
      }
      next();
    })
    .catch((err) => {
      console.error(`[security.rateLimit] error scope=${logScope}`, err);
      respondRateLimited(res, message, Date.now() + 60_000);
    });
}

function createAuthUserLimiter(
  scope: string,
  limits: { ip: { max: number; windowMs: number }; user: { max: number; windowMs: number } },
  message: string,
): RequestHandler {
  return (req, res, next) => {
    const ip = clientIp(req);
    const uid = userIdFromReq(req);
    const layers: RateLimitLayer[] = [
      { name: "ip", key: `sec:${scope}:ip:${ip}`, ...limits.ip },
    ];
    if (uid) {
      layers.push({ name: "user", key: `sec:${scope}:user:${uid}`, ...limits.user });
    }
    runLayers(req, res, next, layers, message, scope);
  };
}

const PASSWORD_MSG = "Too many password change attempts. Please try again later.";
const MFA_MSG = "Too many verification attempts. Please try again later.";
const FEEDBACK_MSG = "Too many feedback submissions. Please try again later.";
const SOCKET_TOKEN_MSG = "Too many requests. Please try again later.";
const API_MSG = "Too many requests. Please slow down.";

export const changePasswordRateLimit = createAuthUserLimiter(
  "change-password",
  securityRateLimits.changePassword,
  PASSWORD_MSG,
);

export const mfaTotpRateLimit = createAuthUserLimiter(
  "mfa-totp",
  securityRateLimits.mfaTotp,
  MFA_MSG,
);

export const feedbackTipRateLimit: RequestHandler = (req, res, next) => {
  const ip = clientIp(req);
  const { feedbackTip: lim } = securityRateLimits;
  runLayers(
    req,
    res,
    next,
    [{ name: "ip", key: `sec:feedback-tip:ip:${ip}`, ...lim.ip }],
    FEEDBACK_MSG,
    "feedback-tip",
  );
};

export const publicSocketTokenRateLimit: RequestHandler = (req, res, next) => {
  const ip = clientIp(req);
  const { publicSocketToken: lim } = securityRateLimits;
  runLayers(
    req,
    res,
    next,
    [{ name: "ip", key: `sec:public-socket-token:ip:${ip}`, ...lim.ip }],
    SOCKET_TOKEN_MSG,
    "public-socket-token",
  );
};

/** Broad per-IP (+ per-user when Bearer present) cap for authenticated API traffic. */
export const authenticatedApiRateLimit: RequestHandler = (req, res, next) => {
  const ip = clientIp(req);
  const uid = userIdFromReq(req);
  const { authenticatedApi: lim } = securityRateLimits;
  const layers: RateLimitLayer[] = [
    { name: "ip", key: `sec:api:ip:${ip}`, ...lim.ip },
  ];
  if (uid) {
    layers.push({ name: "user", key: `sec:api:user:${uid}`, ...lim.user });
  }
  runLayers(req, res, next, layers, API_MSG, "api");
};
