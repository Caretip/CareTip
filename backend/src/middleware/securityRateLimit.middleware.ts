import { createHash } from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { resolveJwtSubject, verifyJwt, type DecodedAccessClaims } from "../lib/jwtConfig.js";
import { classifyApiTraffic, type ApiTrafficClass } from "../lib/apiTrafficClass.js";
import { apiTrafficRateLimits, securityRateLimits } from "../config/securityRateLimit.config.js";
import { parseCookie, refreshCookieName } from "../services/refreshToken.service.js";
import type { RateLimitLayer } from "../utils/layeredRateLimit.js";
import { enforceRateLimitLayersDistributed } from "../utils/rateLimitStore.js";
import { userIdFromPendingMfaLoginToken } from "../services/mfaLogin.service.js";
import { forwardedChainDepth, ipPrefixForLog, resolveClientIp } from "../lib/clientIp.js";

const clientIp = resolveClientIp;

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
  opts?: { failClosed?: boolean },
): void {
  void enforceRateLimitLayersDistributed(layers, opts)
    .then((outcome) => {
      if (!outcome.ok) {
        console.info(`[security.rateLimit] blocked scope=${logScope} layer=${outcome.layer}`, {
          ipPrefix: ipPrefixForLog(clientIp(req)),
          xffDepth: forwardedChainDepth(req),
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
const UPLOAD_IMAGE_MSG = "Too many uploads. Please wait a moment and try again.";
const UPLOAD_KYC_MSG = "Too many document uploads. Please try again later.";

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

/**
 * Login-time TOTP (no Bearer session). User bucket is taken from the pending MFA JWT
 * in the body — not from Authorization — so a stolen header cannot tax another account.
 */
export const mfaLoginChallengeRateLimit: RequestHandler = (req, res, next) => {
  const ip = clientIp(req);
  const { mfaTotp: lim } = securityRateLimits;
  const pending = String((req.body as { pendingMfaToken?: unknown } | undefined)?.pendingMfaToken ?? "");
  const uid = userIdFromPendingMfaLoginToken(pending);
  const layers: RateLimitLayer[] = [{ name: "ip", key: `sec:mfa-totp:ip:${ip}`, ...lim.ip }];
  if (uid) {
    layers.push({ name: "user", key: `sec:mfa-totp:user:${uid}`, ...lim.user });
  }
  runLayers(req, res, next, layers, MFA_MSG, "mfa-totp");
};

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

export const productReviewMeRateLimit: RequestHandler = (req, res, next) => {
  const ip = clientIp(req);
  const uid = req.user?.sub ?? req.user?.userId ?? req.user?.id;
  const { productReviewMe: lim } = securityRateLimits;
  const layers: RateLimitLayer[] = [
    { name: "ip", key: `sec:product-review:ip:${ip}`, ...lim.ip },
  ];
  if (uid) {
    layers.push({ name: "user", key: `sec:product-review:user:${uid}`, ...lim.user });
  }
  runLayers(req, res, next, layers, FEEDBACK_MSG, "product-review-me");
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
export const uploadImageRateLimit = createAuthUserLimiter(
  "upload-image",
  securityRateLimits.uploadImage,
  UPLOAD_IMAGE_MSG,
);

export const uploadKycRateLimit = createAuthUserLimiter(
  "upload-kyc",
  securityRateLimits.uploadKyc,
  UPLOAD_KYC_MSG,
);

const SCHED_PAYOUT_OPS_MSG = "Too many scheduled payout operations. Please try again later.";

export const platformScheduledPayoutOpsMutationRateLimit = createAuthUserLimiter(
  "platform-scheduled-payout-ops",
  securityRateLimits.platformScheduledPayoutOps,
  SCHED_PAYOUT_OPS_MSG,
);

const API_FINANCIAL_MSG = "Too many payment or payout requests. Please try again later.";

/** Money must not move on per-process counts, so these refuse when shared storage is unreachable. */
const FAIL_CLOSED_CLASSES = new Set<ApiTrafficClass>(["instantPayout", "financialWrite"]);

/**
 * A signed-in user's reads count against that user alone. Whole venues and every user behind one
 * proxy can share an address, and one of them must not block the others.
 */
const USER_ONLY_WHEN_AUTHENTICATED = new Set<ApiTrafficClass>(["dashboardRead", "analyticsRead", "ordinary"]);

function apiTrafficLayers(trafficClass: ApiTrafficClass, req: Request): RateLimitLayer[] {
  const ip = clientIp(req);
  const prefix = `sec:api:${trafficClass}`;
  const limits = apiTrafficRateLimits[trafficClass];
  const uidForClass = trafficClass === "sessionRefresh" ? "" : userIdFromReq(req);
  const skipIpLayer = Boolean(uidForClass) && USER_ONLY_WHEN_AUTHENTICATED.has(trafficClass);
  const layers: RateLimitLayer[] = skipIpLayer
    ? []
    : [{ name: "ip", key: `${prefix}:ip:${ip}`, ...limits.ip }];

  if (trafficClass === "sessionRefresh") {
    const cookie = parseCookie(req.headers.cookie, refreshCookieName());
    if (cookie) {
      const session = createHash("sha256").update(cookie).digest("hex").slice(0, 32);
      layers.push({
        name: "session",
        key: `${prefix}:session:${session}`,
        ...apiTrafficRateLimits.sessionRefresh.session,
      });
    }
    return layers;
  }

  const uid = uidForClass;
  if (uid && "user" in limits) {
    layers.push({ name: "user", key: `${prefix}:user:${uid}`, ...limits.user });
  }
  if (uid && "burst" in limits) {
    layers.push({ name: "user_burst", key: `${prefix}:burst:${uid}`, ...limits.burst });
  }
  return layers;
}

function classifiedApiRateLimit(req: Request, res: Response, next: NextFunction): void {
  const trafficClass = classifyApiTraffic({
    method: req.method,
    path: req.baseUrl + req.path,
    query: req.query,
  });
  const failClosed = FAIL_CLOSED_CLASSES.has(trafficClass);
  runLayers(
    req,
    res,
    next,
    apiTrafficLayers(trafficClass, req),
    failClosed ? API_FINANCIAL_MSG : API_MSG,
    `api:${trafficClass}`,
    { failClosed },
  );
}

export const authenticatedApiRateLimit: RequestHandler = (req, res, next) => {
  if (apiTrafficRateLimits.enabled()) {
    classifiedApiRateLimit(req, res, next);
    return;
  }
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
