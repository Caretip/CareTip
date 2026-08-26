import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import * as authService from "../services/auth.service.js";
import * as businessService from "../services/business.service.js";
import * as oauthAuthService from "../services/oauthAuth.service.js";
import { buildAppleNativeCallbackHtml } from "../services/oauth/appleNativeCallbackBounce.js";
import { managerProfileReadyToFinish } from "../services/onboardingProgress.service.js";
import * as emailVerificationService from "../services/emailVerification.service.js";
import * as passwordResetService from "../services/passwordReset.service.js";
import * as employeeActivationService from "../services/employeeActivation.service.js";
import { resolveAuthLinkPlatform } from "../utils/clientPlatform.js";
import { prisma } from "../prisma.js";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import {
  clearRefreshCookie,
  issueRefreshToken,
  parseCookie,
  refreshCookieMaxAgeMs,
  refreshCookieName,
  rotateRefreshToken,
  revokeRefreshTokenAndGetUserId,
  revokeAllRefreshTokensForUser,
  setRefreshCookie,
} from "../services/refreshToken.service.js";
import {
  logServerError,
  clientSafeMessage,
  CLIENT_FALLBACK,
  EmailNotVerifiedLoginError,
} from "../utils/httpErrors.js";
import {
  AUTH_INVALID_CREDENTIALS_MESSAGE,
  AUTH_OAUTH_GENERIC_FAILURE_MESSAGE,
  AUTH_OAUTH_SIGN_IN_FAILED_CODE,
} from "../services/authDisclosureMessages.js";
import * as auditService from "../services/audit.service.js";
import * as mfaLoginService from "../services/mfaLogin.service.js";
import {
  extractLoginRequestContext,
  handlePostLoginNotifications,
} from "../services/loginNotification.service.js";
import { SERVICE_UNAVAILABLE_MESSAGE } from "../constants/serviceUnavailable.js";
import {
  assertMfaVerifyAllowed,
  clearMfaVerifyFailures,
  MfaVerifyLockedError,
  mfaLockoutMessage,
  recordMfaVerifyFailure,
} from "../services/mfaAttemptLimit.service.js";

async function issueRefreshSessionForUser(
  res: Response,
  userId: string,
): Promise<import("../services/auth.service.js").AuthResult> {
  const rt = await issueRefreshToken(userId);
  const result = await authService.authResultForUserId(userId, { refreshSessionId: rt.id });
  setRefreshCookie(res, rt.token, { maxAgeMs: refreshCookieMaxAgeMs(rt.expiresAt) });
  return result;
}

async function respondAfterPasswordLogin(
  req: Request,
  res: Response,
  user: Awaited<ReturnType<typeof authService.validateLoginCredentials>>,
) {
  if (mfaLoginService.isPlatformAdminAccount(user)) {
    const pendingMfaToken = mfaLoginService.signPendingMfaLoginToken(user.id);
    void auditService.writeAuditLog({
      userId: user.id,
      action: "mfa.login.challenge",
      metadata: JSON.stringify({
        method: req.method,
        path: req.originalUrl ?? req.url,
        mfaSetupRequired: user.twoFactorEnabled !== true,
      }),
    });
    return res.json({
      mfaRequired: true,
      mfaSetupRequired: user.twoFactorEnabled !== true,
      pendingMfaToken,
    });
  }

  try {
    const rt = await issueRefreshToken(user.id);
    const result = authService.authResultForUserRecord(user, { refreshSessionId: rt.id });
    setRefreshCookie(res, rt.token, { maxAgeMs: refreshCookieMaxAgeMs(rt.expiresAt) });
    return res.json(result);
  } catch (e) {
    logServerError("auth.login.issueRefreshToken", e);
    const result = authService.authResultForUserRecord(user);
    return res.json(result);
  }
}

function parseClientTimeZone(body: Record<string, unknown>): string | undefined {
  return typeof body.timeZone === "string" && body.timeZone.trim()
    ? body.timeZone.trim()
    : undefined;
}

/** Thrown by auth.service.login — always safe to return to the client as 401. */
const LOGIN_CLIENT_MESSAGES = new Set([
  AUTH_INVALID_CREDENTIALS_MESSAGE,
  "Invalid email or password",
  "Login failed",
  "This account does not have Business permissions.",
  "This account does not have Staff permissions.",
]);

const LOGIN_FORBIDDEN_MESSAGES = new Set<string>([]);

function isPrismaInfrastructureError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  );
}

async function verifyTotpWithLockout(
  userId: string,
  verify: () => boolean,
): Promise<"ok" | "invalid" | "locked"> {
  try {
    await assertMfaVerifyAllowed(userId);
  } catch (e) {
    if (e instanceof MfaVerifyLockedError) return "locked";
    throw e;
  }
  if (!verify()) {
    await recordMfaVerifyFailure(userId);
    return "invalid";
  }
  await clearMfaVerifyFailures(userId);
  return "ok";
}

function mfaLockedResponse(res: Response) {
  return res.status(429).json({ message: mfaLockoutMessage() });
}

function isForbiddenSuperAdminRolePayload(body: Record<string, unknown>): boolean {
  const r = body.role;
  if (typeof r !== "string") return false;
  const n = r.trim().toUpperCase().replace(/-/g, "_");
  return n === "SUPER_ADMIN" || n === "SUPERADMIN";
}

export async function register(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    const { email, password, name, role, inviteCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (isForbiddenSuperAdminRolePayload(body)) {
      return res.status(403).json({
        message: "Super Admin accounts cannot be created through public registration.",
      });
    }
    if (body.isPlatformAdmin === true || body.is_platform_admin === true) {
      return res.status(403).json({
        message: "Platform admin privileges cannot be granted through public registration.",
      });
    }
    if (body.isActive === false || body.is_active === false) {
      return res.status(403).json({
        message: "Account status cannot be set through public registration.",
      });
    }

    const acceptLanguage = req.get("accept-language") ?? undefined;
    const locale =
      typeof body.locale === "string" && body.locale.trim() ? body.locale.trim() : undefined;
    const platform = resolveAuthLinkPlatform(req);

    const inviteTrimmed =
      typeof inviteCode === "string" ? inviteCode.trim() : "";
    if (inviteTrimmed) {
      if (role === "business") {
        return res.status(400).json({
          message:
            "Invite codes complete employee invitations only. Create a business account without an invite code.",
        });
      }
      const inviteCheck = await businessService.validateInviteCode(inviteTrimmed);
      if (!inviteCheck.ok) {
        return res.status(400).json({ message: "Invalid or expired invite code" });
      }
      if (!name) {
        return res.status(400).json({ message: "Name is required" });
      }
      const result = await authService.registerEmployee(
        {
          email,
          password,
          name,
          inviteCode: inviteTrimmed,
          locale,
        },
        { acceptLanguage, platform },
      );
      clearRefreshCookie(res);
      return res.status(201).json(result);
    }

    if (role === "business") {
      const result = await authService.registerBusiness(
        {
          email,
          password,
          name: typeof name === "string" ? name : undefined,
          locale,
        },
        { acceptLanguage, platform },
      );
      clearRefreshCookie(res);
      return res.status(201).json(result);
    }

    if (role === "employee") {
      if (!name) {
        return res.status(400).json({ message: "Name is required" });
      }
      if (!inviteCode) {
        return res.status(400).json({ message: "Invite code is required" });
      }
      const result = await authService.registerEmployee(
        {
          email,
          password,
          name,
          inviteCode,
          locale,
        },
        { acceptLanguage, platform },
      );
      clearRefreshCookie(res);
      return res.status(201).json(result);
    }

    return res.status(400).json({ message: "Invalid role. Use 'business' or 'employee'" });
  } catch (err) {
    logServerError("auth.register", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.register),
    });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    const email = authService.normalizeLoginEmail(
      typeof body.email === "string" ? body.email : "",
    );
    const password = body.password;

    if (!email || typeof password !== "string") {
      return res.status(400).json({ message: "Email and password are required" });
    }
    const user = await authService.validateLoginCredentials({
      email,
      password,
    });

    const loginClientLocale =
      typeof body.locale === "string" && body.locale.trim() ? body.locale.trim() : undefined;
    if (loginClientLocale === "en" || loginClientLocale === "de") {
      void prisma.user
        .update({
          where: { id: user.id },
          data: { preferredLocale: loginClientLocale },
        })
        .catch(() => {});
    }

    if (!mfaLoginService.isPlatformAdminAccount(user)) {
      void (async () => {
        try {
          const { ip, userAgent } = extractLoginRequestContext(req);
          await handlePostLoginNotifications({
            userId: user.id,
            email: user.email,
            ip,
            userAgent,
            explicitLocale: loginClientLocale,
            clientTimeZone: parseClientTimeZone(body),
          });
        } catch (e) {
          logServerError("auth.login.sessionAlertEmail", e);
        }
      })();
    }

    return respondAfterPasswordLogin(req, res, user);
  } catch (err) {
    if (err instanceof EmailNotVerifiedLoginError) {
      return res.status(403).json({
        message:
          "Your email is not verified. Please check your inbox and verify your account before logging in.",
        code: err.code,
        canResend: err.canResend,
      });
    }
    const message = err instanceof Error ? err.message : "Login failed";
    if (
      message === "This account does not have Business permissions." ||
      message === "This account does not have Staff permissions."
    ) {
      return res.status(403).json({ message });
    }
    if (LOGIN_FORBIDDEN_MESSAGES.has(message)) {
      return res.status(403).json({ message });
    }
    if (LOGIN_CLIENT_MESSAGES.has(message)) {
      return res.status(401).json({ message });
    }

    if (message === "JWT_SECRET not configured") {
      logServerError("auth.login", err);
      return res.status(500).json({
        message: CLIENT_FALLBACK.loginUnexpected,
      });
    }

    if (isPrismaInfrastructureError(err)) {
      logServerError("auth.login", err);
      return res.status(503).json({ message: SERVICE_UNAVAILABLE_MESSAGE });
    }

    logServerError("auth.login", err);
    return res.status(503).json({
      message: SERVICE_UNAVAILABLE_MESSAGE,
    });
  }
}

export async function loginMfaSetup(req: Request, res: Response) {
  try {
    const pendingMfaToken = String((req.body as { pendingMfaToken?: unknown })?.pendingMfaToken ?? "").trim();
    if (!pendingMfaToken) {
      return res.status(400).json({ message: "pendingMfaToken is required" });
    }
    const userId = mfaLoginService.userIdFromPendingMfaLoginToken(pendingMfaToken);
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const admin = await mfaLoginService.loadPlatformAdminForMfaLogin(userId);
    if (!admin) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    const secret = speakeasy.generateSecret({
      name: `CareTip (${admin.email})`,
      length: 20,
    });

    await prisma.user.update({
      where: { id: admin.id },
      data: { twoFactorTempSecret: secret.base32 },
    });

    void auditService.writeAuditLog({
      userId: admin.id,
      action: "mfa.login.setup_started",
      metadata: JSON.stringify({ path: req.originalUrl ?? req.url }),
    });

    const otpauthUrl = secret.otpauth_url ?? "";
    const qrDataUrl = otpauthUrl ? await qrcode.toDataURL(otpauthUrl) : "";
    return res.json({ otpauthUrl, qrDataUrl });
  } catch (err) {
    logServerError("auth.loginMfaSetup", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.loginUnexpected) });
  }
}

export async function loginMfaEnable(req: Request, res: Response) {
  try {
    const body = req.body as { pendingMfaToken?: unknown; code?: unknown };
    const pendingMfaToken = String(body.pendingMfaToken ?? "").trim();
    const code = String(body.code ?? "").trim();
    if (!pendingMfaToken || !code) {
      return res.status(400).json({ message: "pendingMfaToken and code are required" });
    }
    const userId = mfaLoginService.userIdFromPendingMfaLoginToken(pendingMfaToken);
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const admin = await mfaLoginService.loadPlatformAdminForMfaLogin(userId);
    if (!admin) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    const temp = admin.twoFactorTempSecret;
    if (!temp) {
      return res.status(400).json({ message: "2FA setup has not been started" });
    }
    const outcome = await verifyTotpWithLockout(admin.id, () =>
      mfaLoginService.verifyTotpCode(temp, code),
    );
    if (outcome === "locked") return mfaLockedResponse(res);
    if (outcome === "invalid") {
      void auditService.writeAuditLog({
        userId: admin.id,
        action: "mfa.login.enable_failed",
        metadata: JSON.stringify({ reason: "invalid_code" }),
      });
      return res.status(400).json({ message: "Invalid verification code" });
    }

    await prisma.user.update({
      where: { id: admin.id },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: temp,
        twoFactorTempSecret: null,
      },
    });

    void auditService.writeAuditLog({
      userId: admin.id,
      action: "mfa.login.enabled",
      metadata: JSON.stringify({ path: req.originalUrl ?? req.url }),
    });

    const result = await issueRefreshSessionForUser(res, admin.id);
    void (async () => {
      try {
        const { ip, userAgent } = extractLoginRequestContext(req);
        await handlePostLoginNotifications({
          userId: admin.id,
          email: admin.email,
          ip,
          userAgent,
        });
      } catch (e) {
        logServerError("auth.loginMfaEnable.sessionAlertEmail", e);
      }
    })();
    return res.json(result);
  } catch (err) {
    logServerError("auth.loginMfaEnable", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.loginUnexpected) });
  }
}

export async function loginMfaVerify(req: Request, res: Response) {
  try {
    const body = req.body as { pendingMfaToken?: unknown; code?: unknown };
    const pendingMfaToken = String(body.pendingMfaToken ?? "").trim();
    const code = String(body.code ?? "").trim();
    if (!pendingMfaToken || !code) {
      return res.status(400).json({ message: "pendingMfaToken and code are required" });
    }
    const userId = mfaLoginService.userIdFromPendingMfaLoginToken(pendingMfaToken);
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const admin = await mfaLoginService.loadPlatformAdminForMfaLogin(userId);
    if (!admin) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    if (!admin.twoFactorEnabled || !admin.twoFactorSecret) {
      return res.status(403).json({
        message: "MFA setup is required before signing in.",
        code: "MFA_SETUP_REQUIRED",
      });
    }
    const outcome = await verifyTotpWithLockout(admin.id, () =>
      mfaLoginService.verifyTotpCode(admin.twoFactorSecret!, code),
    );
    if (outcome === "locked") return mfaLockedResponse(res);
    if (outcome === "invalid") {
      void auditService.writeAuditLog({
        userId: admin.id,
        action: "mfa.login.verify_failed",
        metadata: JSON.stringify({ reason: "invalid_code" }),
      });
      return res.status(401).json({ message: "Invalid verification code" });
    }

    void auditService.writeAuditLog({
      userId: admin.id,
      action: "mfa.login.success",
      metadata: JSON.stringify({ path: req.originalUrl ?? req.url }),
    });

    const result = await issueRefreshSessionForUser(res, admin.id);
    void (async () => {
      try {
        const { ip, userAgent } = extractLoginRequestContext(req);
        await handlePostLoginNotifications({
          userId: admin.id,
          email: admin.email,
          ip,
          userAgent,
        });
      } catch (e) {
        logServerError("auth.loginMfaVerify.sessionAlertEmail", e);
      }
    })();
    return res.json(result);
  } catch (err) {
    logServerError("auth.loginMfaVerify", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.loginUnexpected) });
  }
}

export async function twoFactorStatus(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });
    return res.json({ enabled: Boolean(u?.twoFactorEnabled) });
  } catch (err) {
    logServerError("auth.twoFactorStatus", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.loginUnexpected) });
  }
}

export async function twoFactorSetup(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Authentication required" });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user?.email) return res.status(404).json({ message: "User not found" });

    const secret = speakeasy.generateSecret({
      name: `CareTip (${user.email})`,
      length: 20,
    });

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorTempSecret: secret.base32 },
    });

    const otpauthUrl = secret.otpauth_url ?? "";
    const qrDataUrl = otpauthUrl ? await qrcode.toDataURL(otpauthUrl) : "";

    return res.json({ otpauthUrl, qrDataUrl });
  } catch (err) {
    logServerError("auth.twoFactorSetup", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.loginUnexpected) });
  }
}

export async function twoFactorEnable(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const code = String((req.body as { code?: unknown })?.code ?? "").trim();
    if (!code) return res.status(400).json({ message: "Verification code is required" });

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorTempSecret: true },
    });
    const temp = u?.twoFactorTempSecret ?? null;
    if (!temp) return res.status(400).json({ message: "2FA setup has not been started" });

    const outcome = await verifyTotpWithLockout(userId, () =>
      speakeasy.totp.verify({
        secret: temp,
        encoding: "base32",
        token: code,
        window: 1,
      }),
    );
    if (outcome === "locked") return mfaLockedResponse(res);
    if (outcome === "invalid") {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: temp,
        twoFactorTempSecret: null,
      },
    });

    return res.json({ enabled: true });
  } catch (err) {
    logServerError("auth.twoFactorEnable", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.loginUnexpected) });
  }
}

export async function twoFactorDisable(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const code = String((req.body as { code?: unknown })?.code ?? "").trim();
    if (!code) return res.status(400).json({ message: "Verification code is required" });

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true, role: true, isPlatformAdmin: true },
    });
    if (!u) {
      return res.status(404).json({ message: "User not found" });
    }
    if (mfaLoginService.isPlatformAdminAccount(u)) {
      return res.status(403).json({ message: "MFA cannot be disabled for platform administrators." });
    }
    if (!u.twoFactorEnabled || !u.twoFactorSecret) {
      return res.json({ enabled: false });
    }

    const secret = u.twoFactorSecret;
    const outcome = await verifyTotpWithLockout(userId, () =>
      speakeasy.totp.verify({
        secret,
        encoding: "base32",
        token: code,
        window: 1,
      }),
    );
    if (outcome === "locked") return mfaLockedResponse(res);
    if (outcome === "invalid") {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorTempSecret: null },
    });

    return res.json({ enabled: false });
  } catch (err) {
    logServerError("auth.twoFactorDisable", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.loginUnexpected) });
  }
}

export async function resendVerificationEmail(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    const email = authService.normalizeLoginEmail(
      typeof body.email === "string" ? body.email : "",
    );
    const password = body.password;
    if (!email || typeof password !== "string") {
      return res.status(400).json({ message: "Email and password are required" });
    }
    const acceptLanguage = req.get("accept-language") ?? undefined;
    const locale =
      typeof body.locale === "string" && body.locale.trim() ? body.locale.trim() : undefined;
    const platform = resolveAuthLinkPlatform(req);
    await authService.resendVerificationEmail({
      email,
      password,
      explicitLocale: locale,
      acceptLanguage,
      platform,
    });
    return res.json({
      ok: true,
      message: "We sent a new verification link to your email.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    if (message === "Invalid email or password" || message === AUTH_INVALID_CREDENTIALS_MESSAGE) {
      return res.status(401).json({ message: AUTH_INVALID_CREDENTIALS_MESSAGE });
    }
    logServerError("auth.resendVerificationEmail", err);
    return res.status(503).json({
      message: CLIENT_FALLBACK.loginUnexpected,
    });
  }
}

/** POST with Bearer JWT — same success shape as {@link resendVerificationEmail}; no password in body. */
export async function resendVerificationEmailForSession(req: Request, res: Response) {
  try {
    const uid = req.user?.userId ?? req.user?.id;
    if (!uid || typeof uid !== "string") {
      return res.status(401).json({ message: "Authentication required" });
    }
    const body = req.body as Record<string, unknown>;
    const acceptLanguage = req.get("accept-language") ?? undefined;
    const locale =
      typeof body.locale === "string" && body.locale.trim() ? body.locale.trim() : undefined;
    await authService.resendVerificationEmailForSessionUser(uid, {
      explicitLocale: locale,
      acceptLanguage,
      platform: resolveAuthLinkPlatform(req),
    });
    return res.json({
      ok: true,
      message: "We sent a new verification link to your email.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    if (message === "Authentication required") {
      return res.status(401).json({ message });
    }
    logServerError("auth.resendVerificationEmailForSession", err);
    return res.status(503).json({
      message: CLIENT_FALLBACK.loginUnexpected,
    });
  }
}

export async function oauth(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    const provider = body.provider;
    const idToken = typeof body.idToken === "string" ? body.idToken : "";
    const isLogin = body.isLogin === true;
    const intendedRole = authService.parseLoginIntendedRole(body.intendedRole);
    const name = typeof body.name === "string" ? body.name : undefined;
    const businessName = typeof body.businessName === "string" ? body.businessName : undefined;
    const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : undefined;
    const businessType = typeof body.businessType === "string" ? body.businessType : undefined;
    const location = typeof body.location === "string" ? body.location : undefined;

    if (provider !== "google" && provider !== "apple" && provider !== "facebook") {
      return res.status(400).json({
        message: "provider must be 'google', 'apple', or 'facebook'",
      });
    }
    if (!idToken.trim()) {
      return res.status(400).json({ message: "idToken is required" });
    }
    if (!isLogin && !intendedRole) {
      return res.status(400).json({
        message:
          "intendedRole is required and must be 'MANAGER', 'EMPLOYEE', or 'SUPER_ADMIN'",
      });
    }

    const locale =
      typeof body.locale === "string" && body.locale.trim() ? body.locale.trim() : undefined;
    const result = await oauthAuthService.authenticateWithOAuth(
      provider,
      {
        idToken,
        intendedRole: intendedRole ?? undefined,
        isLogin,
        name,
        businessName,
        inviteCode,
        businessType,
        location,
        locale,
      },
      { acceptLanguage: req.get("accept-language") ?? undefined },
    );
    if (
      !result ||
      typeof result !== "object" ||
      typeof (result as { then?: unknown }).then === "function"
    ) {
      logServerError("auth.oauth.invalidResult", new Error("OAuth returned non-object auth payload"), {
        resultType: typeof result,
      });
      return res.status(503).json({ message: CLIENT_FALLBACK.loginUnexpected });
    }
    if (!result.token?.trim() || !result.user?.id || !result.user?.email || !result.user?.role) {
      logServerError("auth.oauth.invalidResult", new Error("Incomplete OAuth auth result"), {
        hasToken: Boolean(result?.token?.trim()),
        hasUser: Boolean(result?.user),
        userId: result?.user?.id,
      });
      return res.status(503).json({ message: CLIENT_FALLBACK.loginUnexpected });
    }
    try {
      const rt = await issueRefreshToken(result.user.id);
      const session = await authService.authResultForUserId(result.user.id, {
        refreshSessionId: rt.id,
      });
      setRefreshCookie(res, rt.token, { maxAgeMs: refreshCookieMaxAgeMs(rt.expiresAt) });
      if (isLogin) {
        const oauthClientLocale =
          locale === "en" || locale === "de" ? locale : undefined;
        void (async () => {
          try {
            const { ip, userAgent } = extractLoginRequestContext(req);
            await handlePostLoginNotifications({
              userId: session.user.id,
              email: session.user.email,
              ip,
              userAgent,
              explicitLocale: oauthClientLocale,
              clientTimeZone: parseClientTimeZone(body),
            });
          } catch (e) {
            logServerError("auth.oauth.loginSecurityAlert", e);
          }
        })();
      }
      console.info(
        "[oauth] success",
        JSON.stringify({
          userId: session.user.id,
          role: session.user.role,
          provider,
          isLogin,
        }),
      );
      return res.status(isLogin ? 200 : 201).json(session);
    } catch (e) {
      logServerError("auth.oauth.issueRefreshToken", e);
      return res.status(503).json({ message: CLIENT_FALLBACK.loginUnexpected });
    }
  } catch (err) {
    if (err instanceof EmailNotVerifiedLoginError) {
      return res.status(403).json({
        message:
          "Your email is not verified. Please check your inbox and verify your account before logging in.",
        code: err.code,
        canResend: err.canResend,
      });
    }
    if (
      err instanceof oauthAuthService.OAuthSignInFailedError ||
      err instanceof oauthAuthService.OAuthLinkingRequiredError
    ) {
      return res.status(401).json({
        message: AUTH_OAUTH_GENERIC_FAILURE_MESSAGE,
        code: AUTH_OAUTH_SIGN_IN_FAILED_CODE,
      });
    }
    if (err instanceof oauthAuthService.OAuthEmailRequiredError) {
      return res.status(400).json({
        message: err.message,
        code: err.code,
      });
    }
    const message = err instanceof Error ? err.message : "OAuth sign-in failed";
    if (err instanceof oauthAuthService.OAuthTokenVerificationError) {
      logServerError("auth.oauth.verifyIdToken", err);
      return res.status(401).json({
        message: `${err.provider[0]!.toUpperCase()}${err.provider.slice(1)} sign-in could not be verified.`,
        code: oauthAuthService.OAUTH_TOKEN_VERIFICATION_FAILED_CODE,
        provider: err.provider,
      });
    }
    if (
      message.includes("not configured") ||
      message.includes("GOOGLE_CLIENT_ID") ||
      message.includes("APPLE_CLIENT_ID") ||
      message.includes("FACEBOOK_APP")
    ) {
      logServerError("auth.oauth", err);
      return res.status(503).json({ message: CLIENT_FALLBACK.loginUnexpected });
    }
    // Legacy existence/linking/disabled/admin message strings → uniform response
    if (
      message === oauthAuthService.GOOGLE_ACCOUNT_NOT_REGISTERED_MESSAGE ||
      message === oauthAuthService.OAUTH_ACCOUNT_NOT_REGISTERED_MESSAGE ||
      message === oauthAuthService.OAUTH_LINKING_REQUIRED_MESSAGE ||
      message === oauthAuthService.OAUTH_EMAIL_ALREADY_REGISTERED_MESSAGE ||
      message === "Email already registered. Sign in instead." ||
      message === "This account has been disabled." ||
      message === "Use the Platform Admin sign-in for this account." ||
      message === AUTH_OAUTH_GENERIC_FAILURE_MESSAGE
    ) {
      return res.status(401).json({
        message: AUTH_OAUTH_GENERIC_FAILURE_MESSAGE,
        code: AUTH_OAUTH_SIGN_IN_FAILED_CODE,
      });
    }
    if (
      message.includes("Invite code") ||
      message.includes("invite code") ||
      message.includes("Invalid or expired")
    ) {
      return res.status(400).json({ message });
    }
    if (
      message === "Platform admin sign-in is not available with social login." ||
      message === "Platform admin sign-in is not available with Google."
    ) {
      return res.status(403).json({ message });
    }
    if (message.includes("Unsupported OAuth provider")) {
      return res.status(400).json({ message });
    }
    if (message === AUTH_INVALID_CREDENTIALS_MESSAGE || message === "Invalid email or password") {
      return res.status(401).json({ message: AUTH_INVALID_CREDENTIALS_MESSAGE });
    }
    logServerError("auth.oauth", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.loginUnexpected),
    });
  }
}

/**
 * Apple HTTPS Return URL bounce for Android web OAuth.
 * Does not create a session — copies Apple form_post fields onto a CareTip deep link.
 * Never logs id_token, authorization code, or user payload.
 */
export function appleNativeCallback(req: Request, res: Response) {
  try {
    const source =
      req.method === "POST"
        ? ((req.body ?? {}) as Record<string, unknown>)
        : ((req.query ?? {}) as Record<string, unknown>);
    const html = buildAppleNativeCallbackHtml({
      id_token: source.id_token,
      user: source.user,
      error: source.error,
      error_description: source.error_description,
      state: source.state,
    });
    res.status(html.status);
    for (const [key, value] of Object.entries(html.headers)) {
      res.setHeader(key, value);
    }
    return res.send(html.body);
  } catch {
    const html = buildAppleNativeCallbackHtml({ error: "server_error" });
    res.status(html.status);
    for (const [key, value] of Object.entries(html.headers)) {
      res.setHeader(key, value);
    }
    return res.send(html.body);
  }
}

export async function listLinkedOAuthAccounts(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const providers = await oauthAuthService.listLinkedOAuthProvidersForUser(userId);
    const methods = await oauthAuthService.userHasPasswordOrOAuth(userId);
    return res.status(200).json({
      providers,
      hasPassword: methods.hasPassword,
    });
  } catch (err) {
    logServerError("auth.listLinkedOAuthAccounts", err);
    return res.status(503).json({ message: CLIENT_FALLBACK.loginUnexpected });
  }
}

export async function linkOAuthAccount(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const body = req.body as Record<string, unknown>;
    const provider = typeof body.provider === "string" ? body.provider : "";
    const idToken = typeof body.idToken === "string" ? body.idToken : "";
    const result = await oauthAuthService.linkOAuthProviderForUser(userId, provider, idToken);
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof oauthAuthService.OAuthTokenVerificationError) {
      return res.status(401).json({
        message: "Social account could not be verified.",
        code: oauthAuthService.OAUTH_TOKEN_VERIFICATION_FAILED_CODE,
      });
    }
    if (err instanceof oauthAuthService.OAuthEmailRequiredError) {
      return res.status(400).json({ message: err.message, code: err.code });
    }
    const message = err instanceof Error ? err.message : "Link failed";
    if (message === "Authentication required") {
      return res.status(401).json({ message });
    }
    if (message.includes("Platform admin")) {
      return res.status(403).json({ message });
    }
    return res.status(400).json({ message });
  }
}

export async function unlinkOAuthAccount(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const body = req.body as Record<string, unknown>;
    const provider =
      typeof body.provider === "string"
        ? body.provider
        : typeof req.params.provider === "string"
          ? req.params.provider
          : "";
    const result = await oauthAuthService.unlinkOAuthProviderForUser(userId, provider);
    return res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unlink failed";
    if (message === "Authentication required") {
      return res.status(401).json({ message });
    }
    return res.status(400).json({ message });
  }
}

/** Issues a new access token when the short-lived JWT expires (refresh token rotated each use). */
export async function refresh(req: Request, res: Response) {
  try {
    const cookieHeader = req.headers.cookie;
    const rtCookie = parseCookie(cookieHeader, refreshCookieName());

    if (rtCookie) {
      const rotated = await rotateRefreshToken(rtCookie);
      if (rotated) {
        try {
          const result = await authService.authResultForUserId(rotated.userId, {
            refreshSessionId: rotated.newId,
          });
          setRefreshCookie(res, rotated.newToken, { maxAgeMs: refreshCookieMaxAgeMs(rotated.newExpiresAt) });
          return res.json(result);
        } catch (inner) {
          if (inner instanceof EmailNotVerifiedLoginError) {
            clearRefreshCookie(res);
            return res.status(403).json({
              message: inner.message,
              code: inner.code,
              canResend: inner.canResend,
            });
          }
          throw inner;
        }
      }
      clearRefreshCookie(res);
    }

    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (bearer) {
      const { userIdFromAccessTokenForRefresh } = await import("../lib/accessTokenRefresh.js");
      const userId = userIdFromAccessTokenForRefresh(bearer);
      if (userId) {
        try {
          const rt = await issueRefreshToken(userId);
          const result = await authService.authResultForUserId(userId, { refreshSessionId: rt.id });
          setRefreshCookie(res, rt.token, { maxAgeMs: refreshCookieMaxAgeMs(rt.expiresAt) });
          return res.json(result);
        } catch (inner) {
          if (inner instanceof EmailNotVerifiedLoginError) {
            clearRefreshCookie(res);
            return res.status(403).json({
              message: inner.message,
              code: inner.code,
              canResend: inner.canResend,
            });
          }
          throw inner;
        }
      }
    }

    return res.status(401).json({ message: "Authentication required" });
  } catch (err) {
    logServerError("auth.refresh", err);
    const msg = err instanceof Error ? err.message : "";
    if (err instanceof EmailNotVerifiedLoginError) {
      clearRefreshCookie(res);
      return res.status(403).json({
        message: err.message,
        code: err.code,
        canResend: err.canResend,
      });
    }
    if (msg === "Authentication required" || msg.toLowerCase().includes("not found")) {
      clearRefreshCookie(res);
      return res.status(401).json({ message: "Authentication required" });
    }
    return res.status(503).json({ message: CLIENT_FALLBACK.loginUnexpected });
  }
}

/** Logs out by revoking the current refresh session and clearing the cookie. */
export async function logout(req: Request, res: Response) {
  try {
    const cookieHeader = req.headers.cookie;
    const refreshCookie = parseCookie(cookieHeader, refreshCookieName());
    let logoutUserId: string | null = null;

    if (refreshCookie) {
      logoutUserId = await revokeRefreshTokenAndGetUserId(refreshCookie);
    }

    clearRefreshCookie(res);
    res.json({ ok: true });

    if (logoutUserId) {
      void import("../services/push/pushNotification.service.js")
        .then(({ removeAllPushDeviceTokensForUser }) =>
          removeAllPushDeviceTokensForUser(logoutUserId!),
        )
        .catch((err) => logServerError("auth.logout.pushTokens", err));
    }
  } catch (err) {
    logServerError("auth.logout", err);
    clearRefreshCookie(res);
    return res.status(503).json({ ok: false });
  }
}

export async function forgotPassword(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email : "";
    const localeHint =
      typeof body.locale === "string" && body.locale.trim() ? body.locale.trim() : undefined;

    await passwordResetService.requestPasswordReset(email, {
      acceptLanguage: req.get("accept-language") ?? undefined,
      explicitLocale: localeHint,
      platform: resolveAuthLinkPlatform(req),
    });
    return res.status(200).json({
      ok: true,
      message:
        "If an account exists with that email, we sent instructions to reset your password.",
    });
  } catch (err) {
    logServerError("auth.forgotPassword", err);
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.loginUnexpected),
    });
  }
}

export async function resetPassword(req: Request, res: Response) {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!token.trim() || !password) {
      return res.status(400).json({ message: "Token and password are required" });
    }
    await passwordResetService.resetPasswordWithToken(token, password);
    clearRefreshCookie(res);
    return res.status(200).json({ ok: true, message: "Password updated. You can sign in now." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reset failed";
    if (
      message.includes("expired") ||
      message.includes("Invalid") ||
      message.includes("invalid")
    ) {
      return res.status(400).json({ message: "Reset link is invalid or has expired." });
    }
    if (
      message.includes("Password must") ||
      message.includes("special") ||
      message.includes("uppercase") ||
      message.includes("lowercase") ||
      message.includes("characters")
    ) {
      return res.status(400).json({ message });
    }
    logServerError("auth.resetPassword", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.loginUnexpected),
    });
  }
}

export async function changePassword(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required" });
    }
    await authService.changePassword(userId, currentPassword, newPassword);
    await revokeAllRefreshTokensForUser(userId);
    clearRefreshCookie(res);
    return res.json({ success: true });
  } catch (err) {
    logServerError("auth.changePassword", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.changePassword),
    });
  }
}

export async function patchMe(req: Request, res: Response) {
  try {
    const userId = req.user?.sub ?? req.user?.userId ?? req.user?.id;
    const role = req.user?.role;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const normalizedRole = typeof role === "string" ? role.trim().toUpperCase() : "";
    if (normalizedRole !== "MANAGER") {
      return res.status(403).json({ message: "Only business users can update onboarding status." });
    }

    const body = req.body as Record<string, unknown>;
    if (typeof body.hasCompletedOnboarding !== "boolean") {
      return res.status(400).json({ message: "hasCompletedOnboarding must be a boolean" });
    }

    if (body.hasCompletedOnboarding === true) {
      const profile = await businessService.getManagerBusinessProfile(userId);
      const ready = managerProfileReadyToFinish(
        profile
          ? {
              name: profile.name,
              businessType: profile.type,
              registeredAddress: profile.registeredAddress,
            }
          : null,
      );
      if (!ready) {
        return res.status(400).json({
          message: "Complete business details and venue address before finishing onboarding.",
        });
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        hasCompletedOnboarding: body.hasCompletedOnboarding,
        onboardingCompletedAt: body.hasCompletedOnboarding ? new Date() : null,
      },
    });

    if (body.hasCompletedOnboarding === true) {
      const { submitBusinessOnboardingForReview } = await import(
        "../services/businessVerificationWorkflow.service.js"
      );
      await submitBusinessOnboardingForReview(userId);
    }

    const rt = await issueRefreshToken(userId);
    const result = await authService.authResultForUserId(userId, { refreshSessionId: rt.id });
    try {
      setRefreshCookie(res, rt.token, { maxAgeMs: refreshCookieMaxAgeMs(rt.expiresAt) });
    } catch (e) {
      logServerError("auth.patchMe.issueRefreshToken", e);
    }
    return res.json(result);
  } catch (err) {
    logServerError("auth.patchMe", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.changePassword),
    });
  }
}

export async function activateEmployee(req: Request, res: Response) {
  try {
    const { token, password } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Activation token is required" });
    }
    if (!password || typeof password !== "string") {
      return res.status(400).json({ message: "Password is required" });
    }

    const result = await authService.activateEmployee(token, password);
    try {
      const rt = await issueRefreshToken(result.user.id);
      const session = await authService.authResultForUserId(result.user.id, {
        refreshSessionId: rt.id,
      });
      setRefreshCookie(res, rt.token, { maxAgeMs: refreshCookieMaxAgeMs(rt.expiresAt) });
      return res.status(200).json(session);
    } catch (e) {
      logServerError("auth.activateEmployee.issueRefreshToken", e);
    }
    return res.status(200).json(result);
  } catch (err) {
    logServerError("auth.activateEmployee", err);
    const message = err instanceof Error ? err.message : "Activation failed";

    if (
      message.includes("Invalid") ||
      message.includes("expired") ||
      message.includes("Expired") ||
      message.includes("invalid")
    ) {
      return res.status(400).json({ message: "Activation link is invalid or has expired." });
    }
    if (
      message.includes("Password must") ||
      message.includes("special") ||
      message.includes("uppercase") ||
      message.includes("lowercase") ||
      message.includes("characters")
    ) {
      return res.status(400).json({ message });
    }
    if (message.includes("already registered")) {
      return res.status(400).json({ message: "This email is already registered" });
    }

    return res.status(400).json({
      message: clientSafeMessage(err, "Activation failed. Please try again or contact support."),
    });
  }
}

/** Public preview for `/activate` so the invite/set-password screen can show venue branding. */
export async function activateEmployeeBrandingPreview(req: Request, res: Response) {
  try {
    const token = typeof req.query?.token === "string" ? req.query.token.trim() : "";
    if (!token) {
      return res.status(400).json({ message: "Activation token is required" });
    }
    const preview = await employeeActivationService.validateActivationToken(token);
    if (!preview) {
      return res.status(400).json({ message: "Activation link is invalid or has expired." });
    }
    return res.json({
      businessName: preview.businessName,
      businessLogo: preview.businessLogo,
    });
  } catch (err) {
    logServerError("auth.activateEmployeeBrandingPreview", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "Activation link is invalid or has expired."),
    });
  }
}

export async function verifyEmail(req: Request, res: Response) {
  try {
    const token = typeof req.query?.token === "string" ? req.query.token : "";
    if (!token.trim()) {
      return res.status(400).json({ message: "Verification token is required" });
    }
    await emailVerificationService.verifyEmailWithToken(token);
    return res.status(200).json({ ok: true, message: "Email verified." });
  } catch (err) {
    logServerError("auth.verifyEmail", err);
    const message = err instanceof Error ? err.message : "Verification failed";
    if (
      message.includes("invalid") ||
      message.includes("Invalid") ||
      message.includes("expired") ||
      message.includes("Expired")
    ) {
      return res.status(400).json({ message: "Verification link is invalid or has expired." });
    }
    return res.status(400).json({
      message: clientSafeMessage(err, "Verification failed. Please try again."),
    });
  }
}

/**
 * POST /api/auth/cancel-deletion
 * Credential-based reverse of account erasure within the 14-day cancellation window.
 * Sessions were terminated on erasure, so this does not use authMiddleware.
 */
export async function cancelDeletion(req: Request, res: Response) {
  try {
    const body = req.body as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email.trim() || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }
    const { cancelAccountErasureByCredentials, ErasureCancelError } = await import(
      "../services/erasureRequest.service.js"
    );
    const status = await cancelAccountErasureByCredentials({ email, password });
    return res.json({
      ok: true,
      message: status.isActive
        ? "Deletion cancelled. You can sign in again."
        : "Deletion cancelled. Account remains restricted.",
      status,
    });
  } catch (err) {
    const { ErasureCancelError } = await import("../services/erasureRequest.service.js");
    if (err instanceof ErasureCancelError) {
      const http =
        err.code === "INVALID_CREDENTIALS"
          ? 401
          : err.code === "EXPIRED"
            ? 409
            : err.code === "NOT_FOUND"
              ? 401
              : 409;
      return res.status(http).json({ message: err.message, code: err.code });
    }
    logServerError("auth.cancelDeletion", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}
