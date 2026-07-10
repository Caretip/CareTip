import type { Request, Response, NextFunction, RequestHandler } from "express";
import crypto from "crypto";
import { authRateLimits } from "../config/authRateLimit.config.js";
import type { RateLimitLayer } from "../utils/layeredRateLimit.js";
import { enforceRateLimitLayersDistributed } from "../utils/rateLimitStore.js";
import { normalizeLoginEmail } from "../services/auth.service.js";
import * as employeeActivationService from "../services/employeeActivation.service.js";

function clientIp(req: Request): string {
  const ip = req.ip?.trim();
  return ip && ip.length > 0 ? ip : "unknown";
}

function bodyEmail(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  const raw = typeof body?.email === "string" ? body.email : "";
  return normalizeLoginEmail(raw);
}

function bodyInviteCode(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  const raw = typeof body?.inviteCode === "string" ? body.inviteCode : "";
  return raw.trim().toUpperCase();
}

function queryInviteCode(req: Request): string {
  const raw = typeof req.query?.code === "string" ? req.query.code : "";
  return raw.trim().toUpperCase();
}

function bodyActivationToken(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  return typeof body?.token === "string" ? body.token.trim() : "";
}

function sessionUserId(req: Request): string {
  return (req.user?.sub ?? req.user?.userId ?? req.user?.id ?? "").trim();
}

function keyIp(scope: string, ip: string): string {
  return `auth:${scope}:ip:${ip}`;
}

function keyEmail(scope: string, email: string): string {
  return `auth:${scope}:email:${email}`;
}

function keyIpEmail(scope: string, ip: string, email: string): string {
  return `auth:${scope}:ip+email:${ip}|${email}`;
}

function keyInviteCode(scope: string, code: string): string {
  return `auth:${scope}:invite:${code}`;
}

function keyActivationToken(scope: string, token: string): string {
  const digest = crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
  return `auth:${scope}:activation:${digest}`;
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
        console.info(`[auth.rateLimit] blocked scope=${logScope} layer=${outcome.layer}`, {
          ip: clientIp(req),
        });
        respondRateLimited(res, message, outcome.resetAtMs);
        return;
      }
      next();
    })
    .catch((err) => {
      console.error(`[auth.rateLimit] error scope=${logScope}`, err);
      respondRateLimited(res, message, Date.now() + 60_000);
    });
}

function createSyncLimiter(
  buildLayers: (req: Request) => RateLimitLayer[],
  message: string,
  logScope: string,
): RequestHandler {
  return (req, res, next) => {
    runLayers(req, res, next, buildLayers(req), message, logScope);
  };
}

const LOGIN_MSG = "Too many sign-in attempts. Please try again later.";
const REGISTER_MSG = "Too many registration attempts. Please try again later.";
const RESET_MSG = "Too many reset requests. Please try again later.";
const RESEND_MSG = "Too many verification requests. Please try again later.";
const INVITE_MSG = "Too many invite attempts. Please try again later.";

/** Login: IP + email + IP+email (shared WiFi friendly). */
export const loginRateLimit = createSyncLimiter((req) => {
  const ip = clientIp(req);
  const email = bodyEmail(req);
  const { login: lim } = authRateLimits;
  const layers: RateLimitLayer[] = [
    { name: "ip", key: keyIp("login", ip), ...lim.ip },
  ];
  if (email) {
    layers.push(
      { name: "email", key: keyEmail("login", email), ...lim.email },
      { name: "ip+email", key: keyIpEmail("login", ip, email), ...lim.ipEmail },
    );
  }
  return layers;
}, LOGIN_MSG, "login");

/** Forgot password: email + IP. */
export const forgotPasswordRateLimit = createSyncLimiter((req) => {
  const ip = clientIp(req);
  const email = bodyEmail(req);
  const { passwordReset: lim } = authRateLimits;
  const layers: RateLimitLayer[] = [
    { name: "ip", key: keyIp("forgot-password", ip), ...lim.ip },
  ];
  if (email) {
    layers.push({ name: "email", key: keyEmail("forgot-password", email), ...lim.email });
  }
  return layers;
}, RESET_MSG, "forgot-password");

/** Reset password (token submit): IP only (no email in body). */
export const resetPasswordRateLimit = createSyncLimiter((req) => {
  const ip = clientIp(req);
  const { resetPasswordSubmit: lim } = authRateLimits;
  return [{ name: "ip", key: keyIp("reset-password", ip), ...lim.ip }];
}, RESET_MSG, "reset-password");

/** Resend verification (email + password body): email + IP. */
export const resendVerificationRateLimit = createSyncLimiter((req) => {
  const ip = clientIp(req);
  const email = bodyEmail(req);
  const { resendVerification: lim } = authRateLimits;
  const layers: RateLimitLayer[] = [
    { name: "ip", key: keyIp("resend-verification", ip), ...lim.ip },
  ];
  if (email) {
    layers.push({ name: "email", key: keyEmail("resend-verification", email), ...lim.email });
  }
  return layers;
}, RESEND_MSG, "resend-verification");

/** Session resend (JWT): user id from token + IP. Run after authMiddleware. */
export const resendVerificationSessionRateLimit = createSyncLimiter((req) => {
  const ip = clientIp(req);
  const userId = sessionUserId(req);
  const { resendVerification: lim } = authRateLimits;
  const layers: RateLimitLayer[] = [
    { name: "ip", key: keyIp("resend-verification", ip), ...lim.ip },
  ];
  if (userId) {
    layers.push({
      name: "user",
      key: `auth:resend-verification:user:${userId}`,
      ...lim.email,
    });
  }
  return layers;
}, RESEND_MSG, "resend-verification-session");

function employeeInviteLayers(
  req: Request,
  opts: { inviteCode?: string; email?: string; activationToken?: string },
): RateLimitLayer[] {
  const ip = clientIp(req);
  const email = opts.email ?? bodyEmail(req);
  const inviteCode = opts.inviteCode ?? bodyInviteCode(req);
  const token = opts.activationToken ?? bodyActivationToken(req);
  const { employeeInvite: lim } = authRateLimits;
  const layers: RateLimitLayer[] = [
    { name: "ip", key: keyIp("employee-invite", ip), ...lim.ip },
  ];
  if (email) {
    layers.push({ name: "email", key: keyEmail("employee-invite", email), ...lim.email });
  }
  if (inviteCode) {
    layers.push({
      name: "inviteCode",
      key: keyInviteCode("employee-invite", inviteCode),
      ...lim.inviteCode,
    });
  }
  if (token) {
    layers.push({
      name: "activationToken",
      key: keyActivationToken("employee-invite", token),
      ...lim.inviteCode,
    });
  }
  return layers;
}

/** POST /activate-employee — resolves email from token for layered limits. */
export async function activateEmployeeRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bodyActivationToken(req);
  let email = "";
  if (token) {
    try {
      const preview = await employeeActivationService.validateActivationToken(token);
      email = preview?.email ? normalizeLoginEmail(preview.email) : "";
    } catch {
      // Invalid token — still apply IP / token-hash limits; handler returns 400.
    }
  }
  runLayers(
    req,
    res,
    next,
    employeeInviteLayers(req, { email, activationToken: token }),
    INVITE_MSG,
    "activate-employee",
  );
}

/** GET /invite/validate — invite code + IP. */
export const validateInviteCodeRateLimit = createSyncLimiter((req) => {
  const ip = clientIp(req);
  const code = queryInviteCode(req);
  const { inviteValidate: lim } = authRateLimits;
  const layers: RateLimitLayer[] = [
    { name: "ip", key: keyIp("invite-validate", ip), ...lim.ip },
  ];
  if (code) {
    layers.push({
      name: "inviteCode",
      key: keyInviteCode("invite-validate", code),
      ...lim.inviteCode,
    });
  }
  return layers;
}, INVITE_MSG, "invite-validate");

/**
 * POST /oauth — login layers when signing in; invite layers when employee invite signup;
 * otherwise register layers (business Google signup).
 */
export const oauthRateLimit = createSyncLimiter((req) => {
  const body = req.body as Record<string, unknown>;
  const isLogin = body.isLogin === true;
  const inviteCode = bodyInviteCode(req);
  const ip = clientIp(req);
  const email = bodyEmail(req);

  if (isLogin) {
    const { login: lim } = authRateLimits;
    const layers: RateLimitLayer[] = [
      { name: "ip", key: keyIp("login", ip), ...lim.ip },
    ];
    if (email) {
      layers.push(
        { name: "email", key: keyEmail("login", email), ...lim.email },
        { name: "ip+email", key: keyIpEmail("login", ip, email), ...lim.ipEmail },
      );
    }
    return layers;
  }

  if (inviteCode) {
    return employeeInviteLayers(req, { inviteCode, email });
  }

  const { register: lim } = authRateLimits;
  const layers: RateLimitLayer[] = [
    { name: "ip", key: keyIp("register", ip), ...lim.ip },
  ];
  if (email) {
    layers.push({ name: "email", key: keyEmail("register", email), ...lim.email });
  }
  return layers;
}, "Too many authentication attempts. Please try again later.", "oauth");

/**
 * POST /register — applies register layers; adds invite layers when inviteCode present
 * (employee invite self-signup).
 */
export const registerCombinedRateLimit: RequestHandler = (req, res, next) => {
  const inviteCode = bodyInviteCode(req);
  if (inviteCode) {
    runLayers(
      req,
      res,
      next,
      employeeInviteLayers(req, { inviteCode }),
      INVITE_MSG,
      "register-employee-invite",
    );
    return;
  }
  const ip = clientIp(req);
  const email = bodyEmail(req);
  const { register: regLim } = authRateLimits;
  const layers: RateLimitLayer[] = [
    { name: "ip", key: keyIp("register", ip), ...regLim.ip },
  ];
  if (email) {
    layers.push({ name: "email", key: keyEmail("register", email), ...regLim.email });
  }
  runLayers(req, res, next, layers, REGISTER_MSG, "register");
};
