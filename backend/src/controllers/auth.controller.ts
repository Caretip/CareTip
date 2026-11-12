import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import * as authService from "../services/auth.service.js";
import * as businessService from "../services/business.service.js";
import * as oauthAuthService from "../services/oauthAuth.service.js";
import { buildAppleNativeCallbackHtml } from "../services/oauth/appleNativeCallbackBounce.js";
import {
  inferManagerOnboardingStep,
  managerProfileReadyToFinish,
} from "../services/onboardingProgress.service.js";
import * as emailVerificationService from "../services/emailVerification.service.js";
import * as passwordResetService from "../services/passwordReset.service.js";
import * as employeeActivationService from "../services/employeeActivation.service.js";
import { resolveAuthLinkPlatform } from "../utils/clientPlatform.js";
import { prisma } from "../prisma.js";
import speakeasy from "speakeasy";
import bcrypt from "bcrypt";
import crypto from "crypto";
import qrcode from "qrcode";
import {
  clearRefreshCookie,
  issueRefreshToken,
  parseCookie,
  refreshCookieMaxAgeMs,
  refreshCookieName,
  refreshSessionIdFromRawToken,
  rotateRefreshTokenWithOutcome,
  migrateSessionToNewRefreshToken,
  RefreshTokenStoreUnavailableError,
  REFRESH_ROTATION_GRACE_MS,
  type RefreshRotationOutcome,
  refreshTokenHash,
  revokeRefreshSessionChain,
  revokeAllRefreshTokensForUser,
  revokeOtherRefreshTokensForUser,
  setRefreshCookie,
  CARETIP_REFRESH_HEADER,
} from "../services/refreshToken.service.js";
import {
  logServerError,
  clientSafeMessage,
  CLIENT_FALLBACK,
  EmailNotVerifiedLoginError,
} from "../utils/httpErrors.js";
import {
  logFacebookOAuthDiagnostic,
  logFacebookOAuthHttpResponse,
  resolveFacebookOAuthDiagnosticId,
} from "../services/oauth/facebookOAuthDiagnostic.js";
import {
  AUTH_INVALID_CREDENTIALS_MESSAGE,
  AUTH_REGISTER_GENERIC_MESSAGE,
  AUTH_OAUTH_GENERIC_FAILURE_MESSAGE,
  AUTH_OAUTH_SIGN_IN_FAILED_CODE,
} from "../services/authDisclosureMessages.js";
import * as auditService from "../services/audit.service.js";
import * as accountEmailChange from "../services/accountEmailChange.service.js";
import * as accountRecovery from "../services/accountRecovery.service.js";
import { ipPrefixForLog, resolveClientIp } from "../lib/clientIp.js";
import { logRefreshOutcome, storeErrorCode } from "../lib/authRefreshDiagnostics.js";
import {
  MERCHANT_LEGAL_ACCEPTANCE_CONTEXT,
  MERCHANT_LEGAL_ACCEPTANCE_REQUIRED_MSG,
  assertAndRecordMerchantLegalAcceptance,
  parseMerchantLegalAcceptedFlag,
} from "../lib/merchantLegalAcceptance.js";
import * as mfaLoginService from "../services/mfaLogin.service.js";
import {
  isAllowedAccessJwtType,
  resolveJwtSubject,
  verifyJwt,
  type DecodedAccessClaims,
} from "../lib/jwtConfig.js";
import {
  MFA_CHALLENGE_EXPIRED,
  MFA_CHALLENGE_EXPIRED_MESSAGE,
  MFA_CHALLENGE_INVALID,
  MFA_CHALLENGE_INVALID_MESSAGE,
  MFA_INVALID_CODE,
  MFA_INVALID_CODE_MESSAGE,
  MFA_VERIFY_UNAVAILABLE_MESSAGE,
} from "../constants/mfaErrors.js";
import {
  extractLoginRequestContext,
  handlePostLoginNotifications,
} from "../services/loginNotification.service.js";
import { SERVICE_UNAVAILABLE_MESSAGE } from "../constants/serviceUnavailable.js";
import {
  GOOGLE_CSRF_COOKIE,
  GoogleRedirectHandoffError,
  buildGoogleRedirectCompleteUrl,
  isGoogleRedirectHandoff,
  openGoogleRedirectHandoff,
  sealGoogleRedirectHandoff,
} from "../services/oauth/googleOAuthRedirect.service.js";
import { OAuthTokenVerificationError, verifyGoogleIdentity } from "../services/oauth/googleVerifier.js";
import { safeSecretEqual } from "../lib/safeCompare.js";
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

function jsonMfaLoginChallenge(
  req: Request,
  res: Response,
  user: {
    id: string;
    twoFactorEnabled: boolean;
    role: Awaited<ReturnType<typeof authService.validateLoginCredentials>>["role"];
    isPlatformAdmin: boolean;
  },
) {
  const mfaSetupRequired = mfaLoginService.mfaSetupRequiredForLogin(user);
  const pendingMfaToken = mfaLoginService.signPendingMfaLoginToken(user.id);
  void auditService.writeAuditLog({
    userId: user.id,
    action: "mfa.login.challenge",
    metadata: JSON.stringify({
      method: req.method,
      path: req.originalUrl ?? req.url,
      mfaSetupRequired,
    }),
  });
  return res.json({
    mfaRequired: true,
    mfaSetupRequired,
    pendingMfaToken,
  });
}

async function respondAfterPasswordLogin(
  req: Request,
  res: Response,
  user: Awaited<ReturnType<typeof authService.validateLoginCredentials>>,
) {
  if (mfaLoginService.needsMfaLoginChallenge(user)) {
    return jsonMfaLoginChallenge(req, res, user);
  }

  try {
    const rt = await issueRefreshToken(user.id);
    const result = authService.authResultForUserRecord(user, { refreshSessionId: rt.id });
    setRefreshCookie(res, rt.token, { maxAgeMs: refreshCookieMaxAgeMs(rt.expiresAt) });
    return res.json(result);
  } catch (e) {
    logServerError("auth.login.issueRefreshToken", e);
    return res.status(503).json({ message: "We couldn't start your session. Please try again." });
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
  storedSecret: string,
  code: string,
): Promise<"ok" | "invalid" | "locked"> {
  try {
    await assertMfaVerifyAllowed(userId);
  } catch (e) {
    if (e instanceof MfaVerifyLockedError) return "locked";
    throw e;
  }
  const check = await mfaLoginService.verifyAndConsumeTotp(userId, storedSecret, code);
  if (check === "unavailable") {
    throw new Error("MFA replay store unavailable");
  }
  if (check !== "ok") {
    await recordMfaVerifyFailure(userId);
    return "invalid";
  }
  await clearMfaVerifyFailures(userId);
  return "ok";
}

/** An enrolled account must prove its current factor; a password-only challenge can never replace it. */
function respondMfaAlreadyEnrolled(res: Response) {
  return res.status(403).json({ message: "Insufficient permissions", code: "MFA_ALREADY_ENROLLED" });
}

function mfaLockedResponse(res: Response) {
  return res.status(429).json({ message: mfaLockoutMessage() });
}

function respondMfaChallengeFailure(res: Response, reason: "expired" | "invalid") {
  if (reason === "expired") {
    return res.status(401).json({
      message: MFA_CHALLENGE_EXPIRED_MESSAGE,
      code: MFA_CHALLENGE_EXPIRED,
    });
  }
  return res.status(401).json({
    message: MFA_CHALLENGE_INVALID_MESSAGE,
    code: MFA_CHALLENGE_INVALID,
  });
}

function respondInvalidTotp(res: Response, status: 400 | 401) {
  return res.status(status).json({
    message: MFA_INVALID_CODE_MESSAGE,
    code: MFA_INVALID_CODE,
  });
}

/** Keep the current refresh session; revoke other devices. Never guesses a session id. */
async function resolveCurrentRefreshSessionId(req: Request, userId: string): Promise<string | null> {
  const sid = typeof req.user?.sid === "string" ? req.user.sid.trim() : "";
  if (sid) {
    const owned = await prisma.refreshToken.findFirst({
      where: {
        id: sid,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (owned) return owned.id;
  }

  const headerRaw = req.get(CARETIP_REFRESH_HEADER)?.trim() || "";
  const cookieRaw = parseCookie(req.headers.cookie, refreshCookieName()) ?? "";
  for (const raw of [cookieRaw, headerRaw]) {
    if (!raw) continue;
    const id = await refreshSessionIdFromRawToken(raw);
    if (!id) continue;
    const owned = await prisma.refreshToken.findFirst({
      where: { id, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (owned) return owned.id;
  }
  return null;
}

function sessionRequiredForMfaChange(res: Response) {
  return res.status(401).json({
    message: "Please sign in again to continue.",
    code: "SESSION_STALE",
  });
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
      if (
        !parseMerchantLegalAcceptedFlag(
          body.merchantLegalAccepted ?? body.legalAccepted ?? body.acceptMerchantLegal,
        )
      ) {
        return res.status(400).json({
          message: MERCHANT_LEGAL_ACCEPTANCE_REQUIRED_MSG,
          code: "MERCHANT_LEGAL_ACCEPTANCE_REQUIRED",
        });
      }
      const result = await authService.registerBusiness(
        {
          email,
          password,
          name: typeof name === "string" ? name : undefined,
          locale,
        },
        { acceptLanguage, platform },
      );
      try {
        await assertAndRecordMerchantLegalAcceptance({
          userId: result.user.id,
          accepted: true,
          context: MERCHANT_LEGAL_ACCEPTANCE_CONTEXT.signup,
          language: locale ?? acceptLanguage?.slice(0, 2),
          businessId: result.user.businessId ?? null,
        });
      } catch (acceptErr) {
        logServerError("auth.register.merchantLegalAcceptance", acceptErr);
      }
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
    if (err instanceof Error && err.message === AUTH_REGISTER_GENERIC_MESSAGE) {
      return respondRegisterExistingAccount(req, res);
    }
    logServerError("auth.register", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.register),
    });
  }
}

/**
 * Registration must not reveal whether an address has an account. The caller sees the normal
 * "check your inbox" result, and the real owner is told someone tried.
 */
async function respondRegisterExistingAccount(req: Request, res: Response) {
  const body = req.body as Record<string, unknown>;
  const email = authService.normalizeLoginEmail(typeof body.email === "string" ? body.email : "");
  const employee = String(body.role ?? "").toLowerCase() === "employee";
  void accountEmailChange.notifySecurityChange("registration_attempt", email).catch(() => undefined);
  clearRefreshCookie(res);
  const id = `c${crypto.randomBytes(12).toString("hex")}`;
  return res.status(201).json({
    requiresEmailVerification: true,
    user: {
      id,
      email,
      role: employee ? "EMPLOYEE" : "MANAGER",
      name: (employee && typeof body.name === "string" && body.name.trim()) || email.split("@")[0] || "User",
      emailVerified: false,
      preferredLocale: null,
      isPlatformAdmin: false,
      ...(employee
        ? {}
        : {
            hasCompletedOnboarding: false,
            onboardingStep: 1,
            businessId: `c${crypto.randomBytes(12).toString("hex")}`,
            businessVerificationStatus: "pending",
            onboardingVerificationStatus: "draft",
            kycVerificationStatus: "not_started",
          }),
    },
  });
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

    if (!mfaLoginService.needsMfaLoginChallenge(user)) {
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
    const parsed = mfaLoginService.parsePendingMfaLoginToken(pendingMfaToken);
    if (!parsed.ok) return respondMfaChallengeFailure(res, parsed.reason);
    const admin = await mfaLoginService.loadPlatformAdminForMfaLogin(parsed.userId);
    if (!admin) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    if (admin.twoFactorEnabled === true) {
      void auditService.writeAuditLog({
        userId: admin.id,
        action: "mfa.login.setup_refused_enrolled",
        metadata: JSON.stringify({ path: req.originalUrl ?? req.url }),
      });
      return respondMfaAlreadyEnrolled(res);
    }

    const secret = speakeasy.generateSecret({
      name: `CareTip (${admin.email})`,
      length: 20,
    });

    const staged = await prisma.user.updateMany({
      where: { id: admin.id, twoFactorEnabled: false },
      data: { twoFactorTempSecret: mfaLoginService.storableMfaSecret(secret.base32) },
    });
    if (staged.count !== 1) return respondMfaAlreadyEnrolled(res);

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
    return res.status(503).json({ message: MFA_VERIFY_UNAVAILABLE_MESSAGE });
  }
}

export async function loginMfaEnable(req: Request, res: Response) {
  try {
    const body = req.body as { pendingMfaToken?: unknown; code?: unknown };
    const pendingMfaToken = String(body.pendingMfaToken ?? "").trim();
    if (!pendingMfaToken) {
      return res.status(400).json({ message: "pendingMfaToken and code are required" });
    }
    const parsed = mfaLoginService.parsePendingMfaLoginToken(pendingMfaToken);
    if (!parsed.ok) return respondMfaChallengeFailure(res, parsed.reason);
    const code = mfaLoginService.normalizeLoginTotp(body.code);
    if (!code) return respondInvalidTotp(res, 400);
    const admin = await mfaLoginService.loadPlatformAdminForMfaLogin(parsed.userId);
    if (!admin) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    if (admin.twoFactorEnabled === true) {
      void auditService.writeAuditLog({
        userId: admin.id,
        action: "mfa.login.enable_refused_enrolled",
        metadata: JSON.stringify({ path: req.originalUrl ?? req.url }),
      });
      return respondMfaAlreadyEnrolled(res);
    }
    const temp = admin.twoFactorTempSecret;
    if (!temp) {
      return res.status(400).json({ message: "2FA setup has not been started" });
    }
    const outcome = await verifyTotpWithLockout(admin.id, temp, code);
    if (outcome === "locked") return mfaLockedResponse(res);
    if (outcome === "invalid") {
      void auditService.writeAuditLog({
        userId: admin.id,
        action: "mfa.login.enable_failed",
        metadata: JSON.stringify({ reason: "invalid_code" }),
      });
      return respondInvalidTotp(res, 400);
    }

    const consumed = await mfaLoginService.consumeMfaChallengeJti(parsed.jti);
    if (consumed === "unavailable") {
      return res.status(503).json({ message: MFA_VERIFY_UNAVAILABLE_MESSAGE });
    }
    if (consumed !== "consumed") return respondMfaChallengeFailure(res, "invalid");

    // Compare-and-set: two concurrent enrolments cannot both win, and neither can replace an active factor.
    const enrolled = await prisma.user.updateMany({
      where: { id: admin.id, twoFactorEnabled: false, twoFactorTempSecret: temp },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: temp,
        twoFactorTempSecret: null,
      },
    });
    if (enrolled.count !== 1) return respondMfaAlreadyEnrolled(res);

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
    return res.status(503).json({ message: MFA_VERIFY_UNAVAILABLE_MESSAGE });
  }
}

export async function loginMfaVerify(req: Request, res: Response) {
  try {
    const body = req.body as { pendingMfaToken?: unknown; code?: unknown };
    const pendingMfaToken = String(body.pendingMfaToken ?? "").trim();
    if (!pendingMfaToken) {
      return res.status(400).json({ message: "pendingMfaToken and code are required" });
    }
    const parsed = mfaLoginService.parsePendingMfaLoginToken(pendingMfaToken);
    if (!parsed.ok) return respondMfaChallengeFailure(res, parsed.reason);
    const code = mfaLoginService.normalizeLoginTotp(body.code);
    if (!code) return respondInvalidTotp(res, 401);
    const mfaUser = await mfaLoginService.loadUserForMfaVerify(parsed.userId);
    if (!mfaUser) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    if (!mfaUser.twoFactorEnabled || !mfaUser.twoFactorSecret) {
      return res.status(403).json({
        message: "MFA setup is required before signing in.",
        code: "MFA_SETUP_REQUIRED",
      });
    }
    const outcome = await verifyTotpWithLockout(mfaUser.id, mfaUser.twoFactorSecret, code);
    if (outcome === "locked") return mfaLockedResponse(res);
    if (outcome === "invalid") {
      void auditService.writeAuditLog({
        userId: mfaUser.id,
        action: "mfa.login.verify_failed",
        metadata: JSON.stringify({ reason: "invalid_code" }),
      });
      return respondInvalidTotp(res, 401);
    }

    const consumed = await mfaLoginService.consumeMfaChallengeJti(parsed.jti);
    if (consumed === "unavailable") {
      return res.status(503).json({ message: MFA_VERIFY_UNAVAILABLE_MESSAGE });
    }
    if (consumed !== "consumed") return respondMfaChallengeFailure(res, "invalid");

    await mfaLoginService.upgradeStoredMfaSecret(mfaUser.id, mfaUser.twoFactorSecret);

    void auditService.writeAuditLog({
      userId: mfaUser.id,
      action: "mfa.login.success",
      metadata: JSON.stringify({ path: req.originalUrl ?? req.url }),
    });

    const result = await issueRefreshSessionForUser(res, mfaUser.id);
    void (async () => {
      try {
        const { ip, userAgent } = extractLoginRequestContext(req);
        await handlePostLoginNotifications({
          userId: mfaUser.id,
          email: mfaUser.email,
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
    return res.status(503).json({ message: MFA_VERIFY_UNAVAILABLE_MESSAGE });
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorEnabled: true },
    });
    if (!user?.email) return res.status(404).json({ message: "User not found" });
    if (user.twoFactorEnabled === true) {
      return res.status(409).json({ message: "Two-factor authentication is already enabled." });
    }

    const secret = speakeasy.generateSecret({
      name: `CareTip (${user.email})`,
      length: 20,
    });

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorTempSecret: mfaLoginService.storableMfaSecret(secret.base32) },
    });

    const otpauthUrl = secret.otpauth_url ?? "";
    const qrDataUrl = otpauthUrl ? await qrcode.toDataURL(otpauthUrl) : "";

    return res.json({ otpauthUrl, qrDataUrl });
  } catch (err) {
    logServerError("auth.twoFactorSetup", err);
    return res.status(503).json({ message: MFA_VERIFY_UNAVAILABLE_MESSAGE });
  }
}

export async function twoFactorEnable(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const code = mfaLoginService.normalizeLoginTotp((req.body as { code?: unknown })?.code);
    if (!code) return respondInvalidTotp(res, 400);

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorTempSecret: true, twoFactorEnabled: true },
    });
    if (u?.twoFactorEnabled === true) {
      return res.status(409).json({ message: "Two-factor authentication is already enabled." });
    }
    const temp = u?.twoFactorTempSecret ?? null;
    if (!temp) return res.status(400).json({ message: "2FA setup has not been started" });

    const outcome = await verifyTotpWithLockout(userId, temp, code);
    if (outcome === "locked") return mfaLockedResponse(res);
    if (outcome === "invalid") {
      return respondInvalidTotp(res, 400);
    }

    const keepSessionId = await resolveCurrentRefreshSessionId(req, userId);
    if (!keepSessionId) return sessionRequiredForMfaChange(res);

    const enrolled = await prisma.user.updateMany({
      where: { id: userId, twoFactorEnabled: false, twoFactorTempSecret: temp },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: temp,
        twoFactorTempSecret: null,
      },
    });
    if (enrolled.count !== 1) {
      return res.status(409).json({ message: "Two-factor authentication is already enabled." });
    }

    const otherRevoked = await revokeOtherRefreshTokensForUser(userId, keepSessionId);

    void auditService.writeAuditLog({
      userId,
      action: "mfa.enabled",
      metadata: JSON.stringify({ path: req.originalUrl ?? req.url, otherSessionsRevoked: otherRevoked }),
    });

    return res.json({ enabled: true });
  } catch (err) {
    logServerError("auth.twoFactorEnable", err);
    return res.status(503).json({ message: MFA_VERIFY_UNAVAILABLE_MESSAGE });
  }
}

export async function twoFactorDisable(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const code = mfaLoginService.normalizeLoginTotp((req.body as { code?: unknown })?.code);
    if (!code) return respondInvalidTotp(res, 400);

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

    const outcome = await verifyTotpWithLockout(userId, u.twoFactorSecret, code);
    if (outcome === "locked") return mfaLockedResponse(res);
    if (outcome === "invalid") {
      return respondInvalidTotp(res, 400);
    }

    const keepSessionId = await resolveCurrentRefreshSessionId(req, userId);
    if (!keepSessionId) return sessionRequiredForMfaChange(res);

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorTempSecret: null },
    });

    const otherRevoked = await revokeOtherRefreshTokensForUser(userId, keepSessionId);

    void auditService.writeAuditLog({
      userId,
      action: "mfa.disabled",
      metadata: JSON.stringify({ path: req.originalUrl ?? req.url, otherSessionsRevoked: otherRevoked }),
    });

    return res.json({ enabled: false });
  } catch (err) {
    logServerError("auth.twoFactorDisable", err);
    return res.status(503).json({ message: MFA_VERIFY_UNAVAILABLE_MESSAGE });
  }
}

function notifyMfaChanged(_userId: string, email: string): Promise<void> {
  return accountEmailChange.notifySecurityChange("mfa_changed", email);
}

function respondEmailChangeError(res: Response, err: unknown) {
  if (err instanceof accountEmailChange.EmailChangeError) {
    const status = err.code === "UNAVAILABLE" ? 503 : err.code === "EMAIL_IN_USE" ? 409 : 400;
    return res.status(status).json({ message: err.message, code: err.code });
  }
  logServerError("auth.emailChange", err);
  return res.status(503).json({ message: SERVICE_UNAVAILABLE_MESSAGE });
}

function respondRecoveryError(res: Response, err: unknown) {
  if (err instanceof accountRecovery.AccountRecoveryError) {
    const status = err.code === "UNAVAILABLE" ? 503 : 400;
    return res.status(status).json({ message: err.message, code: err.code });
  }
  logServerError("auth.accountRecovery", err);
  return res.status(503).json({ message: SERVICE_UNAVAILABLE_MESSAGE });
}

/** Same answer whether or not the account exists. */
export async function requestAccountRecovery(req: Request, res: Response) {
  try {
    const body = req.body as { loginEmail?: unknown; replacementEmail?: unknown; statement?: unknown };
    await accountRecovery.requestAccountRecovery({
      loginEmail: body?.loginEmail,
      replacementEmail: body?.replacementEmail,
      statement: body?.statement,
      ipPrefix: ipPrefixForLog(resolveClientIp(req)),
    });
    return res.status(202).json({ ok: true });
  } catch (err) {
    return respondRecoveryError(res, err);
  }
}

export async function confirmAccountRecovery(req: Request, res: Response) {
  try {
    await accountRecovery.confirmReplacementEmail((req.body as { token?: unknown })?.token);
    return res.json({ ok: true });
  } catch (err) {
    return respondRecoveryError(res, err);
  }
}

export async function cancelAccountRecovery(req: Request, res: Response) {
  try {
    await accountRecovery.cancelAccountRecovery((req.body as { token?: unknown })?.token);
    return res.json({ ok: true });
  } catch (err) {
    return respondRecoveryError(res, err);
  }
}

/** The account owner changes their own login email: proven by session and password. */
export async function requestOwnEmailChange(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (req.user?.impersonatedBy) return res.status(403).json({ message: "Insufficient permissions" });
    const body = req.body as { newEmail?: unknown; currentPassword?: unknown };
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    const password = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    if (!u?.passwordHash) {
      // Social-only accounts have no password to prove, so they use the consent link instead.
      const r = await accountEmailChange.requestEmailChangeForOwnerApproval({
        userId,
        newEmail: String(body?.newEmail ?? ""),
        requestedByUserId: userId,
      });
      return res.status(202).json(r);
    }
    if (!password || !(await bcrypt.compare(password, u.passwordHash))) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }
    const r = await accountEmailChange.requestOwnEmailChange({ userId, newEmail: String(body?.newEmail ?? "") });
    return res.status(202).json(r);
  } catch (err) {
    return respondEmailChangeError(res, err);
  }
}

export async function approveEmailChange(req: Request, res: Response) {
  try {
    await accountEmailChange.approveEmailChange((req.body as { token?: unknown })?.token);
    return res.json({ ok: true });
  } catch (err) {
    return respondEmailChangeError(res, err);
  }
}

export async function confirmEmailChange(req: Request, res: Response) {
  try {
    await accountEmailChange.confirmEmailChange((req.body as { token?: unknown })?.token);
    return res.json({ ok: true });
  } catch (err) {
    return respondEmailChangeError(res, err);
  }
}

/**
 * Step 1 of replacing an active authenticator. Needs a live session, the password when the account
 * has one, and a current code from the existing device: possession of the password alone never works.
 */
export async function twoFactorReplaceStart(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (req.user?.impersonatedBy) return res.status(403).json({ message: "Insufficient permissions" });
    const body = req.body as { code?: unknown; password?: unknown };
    const code = mfaLoginService.normalizeLoginTotp(body?.code);
    if (!code) return respondInvalidTotp(res, 400);

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorEnabled: true, twoFactorSecret: true, passwordHash: true },
    });
    if (!u?.twoFactorEnabled || !u.twoFactorSecret) {
      return res.status(409).json({ message: "2FA setup has not been started" });
    }
    if (u.passwordHash) {
      const password = typeof body?.password === "string" ? body.password : "";
      if (!password || !(await bcrypt.compare(password, u.passwordHash))) {
        await recordMfaVerifyFailure(userId);
        return res.status(401).json({ message: AUTH_INVALID_CREDENTIALS_MESSAGE });
      }
    }
    const outcome = await verifyTotpWithLockout(userId, u.twoFactorSecret, code);
    if (outcome === "locked") return mfaLockedResponse(res);
    if (outcome === "invalid") return respondInvalidTotp(res, 400);

    const secret = speakeasy.generateSecret({ name: `CareTip (${u.email})`, length: 20 });
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorTempSecret: mfaLoginService.storableMfaSecret(secret.base32) },
    });
    void auditService.writeAuditLog({
      userId,
      action: "mfa.replace_started",
      metadata: JSON.stringify({ path: req.originalUrl ?? req.url }),
    });
    const otpauthUrl = secret.otpauth_url ?? "";
    const qrDataUrl = otpauthUrl ? await qrcode.toDataURL(otpauthUrl) : "";
    return res.json({ otpauthUrl, qrDataUrl });
  } catch (err) {
    logServerError("auth.twoFactorReplaceStart", err);
    return res.status(503).json({ message: MFA_VERIFY_UNAVAILABLE_MESSAGE });
  }
}

/** Step 2: proves the new device, swaps the secret and ends every other session. */
export async function twoFactorReplaceConfirm(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (req.user?.impersonatedBy) return res.status(403).json({ message: "Insufficient permissions" });
    const code = mfaLoginService.normalizeLoginTotp((req.body as { code?: unknown })?.code);
    if (!code) return respondInvalidTotp(res, 400);

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorEnabled: true, twoFactorTempSecret: true },
    });
    if (!u?.twoFactorEnabled || !u.twoFactorTempSecret) {
      return res.status(400).json({ message: "2FA setup has not been started" });
    }
    const temp = u.twoFactorTempSecret;
    const outcome = await verifyTotpWithLockout(userId, temp, code);
    if (outcome === "locked") return mfaLockedResponse(res);
    if (outcome === "invalid") return respondInvalidTotp(res, 400);

    const keepSessionId = await resolveCurrentRefreshSessionId(req, userId);
    if (!keepSessionId) return sessionRequiredForMfaChange(res);

    const swapped = await prisma.user.updateMany({
      where: { id: userId, twoFactorEnabled: true, twoFactorTempSecret: temp },
      data: { twoFactorSecret: temp, twoFactorTempSecret: null },
    });
    if (swapped.count !== 1) return res.status(409).json({ message: "2FA setup has not been started" });

    const otherRevoked = await revokeOtherRefreshTokensForUser(userId, keepSessionId);
    void auditService.writeAuditLog({
      userId,
      action: "mfa.replaced",
      metadata: JSON.stringify({ path: req.originalUrl ?? req.url, otherSessionsRevoked: otherRevoked }),
    });
    void notifyMfaChanged(userId, u.email);
    return res.json({ enabled: true });
  } catch (err) {
    logServerError("auth.twoFactorReplaceConfirm", err);
    return res.status(503).json({ message: MFA_VERIFY_UNAVAILABLE_MESSAGE });
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

/**
 * POST /api/auth/google/redirect — Google Identity Services redirect-mode `login_uri` (mobile web).
 * Cross-site form POST from accounts.google.com: protected by Google's g_csrf_token double-submit
 * cookie and the ID token signature/audience. Never creates a session; hands off to the SPA.
 */
export async function googleRedirectCallback(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const credential = typeof body.credential === "string" ? body.credential.trim() : "";
  const bodyCsrf = typeof body[GOOGLE_CSRF_COOKIE] === "string" ? (body[GOOGLE_CSRF_COOKIE] as string) : "";
  const cookieCsrf = parseCookie(req.headers.cookie, GOOGLE_CSRF_COOKIE);
  if (!bodyCsrf || !cookieCsrf || !safeSecretEqual(bodyCsrf, cookieCsrf)) {
    return res.redirect(303, buildGoogleRedirectCompleteUrl({ error: "csrf" }));
  }
  if (!credential) {
    return res.redirect(303, buildGoogleRedirectCompleteUrl({ error: "missing_credential" }));
  }
  try {
    await verifyGoogleIdentity(credential);
  } catch (err) {
    const notConfigured = err instanceof Error && err.message.includes("not configured");
    if (!(err instanceof OAuthTokenVerificationError)) logServerError("auth.googleRedirectCallback", err);
    return res.redirect(
      303,
      buildGoogleRedirectCompleteUrl({ error: notConfigured ? "unavailable" : "rejected" }),
    );
  }
  return res.redirect(303, buildGoogleRedirectCompleteUrl({ handoff: sealGoogleRedirectHandoff(credential) }));
}

export async function oauth(req: Request, res: Response) {
  let facebookDiagnosticId: string | undefined;
  try {
    const body = req.body as Record<string, unknown>;
    const provider = body.provider;
    let idToken = typeof body.idToken === "string" ? body.idToken : "";
    // Mobile web: Google redirect mode returns a sealed hand-off instead of the raw ID token.
    if (provider === "google" && isGoogleRedirectHandoff(idToken)) {
      try {
        idToken = openGoogleRedirectHandoff(idToken);
      } catch (err) {
        if (err instanceof GoogleRedirectHandoffError) {
          return res.status(400).json({ message: err.message, code: err.code });
        }
        throw err;
      }
    }
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
    if (provider === "facebook") {
      facebookDiagnosticId = resolveFacebookOAuthDiagnosticId(req);
      logFacebookOAuthDiagnostic(facebookDiagnosticId, "request_received", {
        provider: "facebook",
        isLogin,
        hasIdToken: Boolean(idToken.trim()),
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

    if (
      !isLogin &&
      intendedRole === "MANAGER" &&
      !parseMerchantLegalAcceptedFlag(
        body.merchantLegalAccepted ?? body.legalAccepted ?? body.acceptMerchantLegal,
      )
    ) {
      return res.status(400).json({
        message: MERCHANT_LEGAL_ACCEPTANCE_REQUIRED_MSG,
        code: "MERCHANT_LEGAL_ACCEPTANCE_REQUIRED",
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
      {
        acceptLanguage: req.get("accept-language") ?? undefined,
        facebookDiagnosticId,
      },
    );
    if (oauthAuthService.isOAuthMfaPending(result)) {
      const oauthMfaUser = await prisma.user.findUnique({
        where: { id: result.userId },
        select: {
          id: true,
          twoFactorEnabled: true,
          role: true,
          isPlatformAdmin: true,
        },
      });
      if (!oauthMfaUser || !mfaLoginService.needsMfaLoginChallenge(oauthMfaUser)) {
        logFacebookOAuthHttpResponse(facebookDiagnosticId, {
          httpStatus: 401,
          responseBranch: "oauth_mfa_invalid",
          responseCode: "AUTH_INVALID_CREDENTIALS",
        });
        return res.status(401).json({ message: AUTH_INVALID_CREDENTIALS_MESSAGE });
      }
      return jsonMfaLoginChallenge(req, res, oauthMfaUser);
    }
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
      if (facebookDiagnosticId) {
        logFacebookOAuthDiagnostic(facebookDiagnosticId, "session_complete", {
          provider: "facebook",
          isLogin,
          httpStatus: isLogin ? 200 : 201,
        });
      }
      if (!isLogin && session.user.role === "MANAGER") {
        try {
          await assertAndRecordMerchantLegalAcceptance({
            userId: session.user.id,
            accepted: true,
            context: MERCHANT_LEGAL_ACCEPTANCE_CONTEXT.oauth_signup,
            language: locale ?? req.get("accept-language")?.slice(0, 2),
            businessId: session.user.businessId ?? null,
          });
        } catch (acceptErr) {
          logServerError("auth.oauth.merchantLegalAcceptance", acceptErr);
        }
      }
      return res.status(isLogin ? 200 : 201).json(session);
    } catch (e) {
      logServerError("auth.oauth.issueRefreshToken", e);
      return res.status(503).json({ message: CLIENT_FALLBACK.loginUnexpected });
    }
  } catch (err) {
    if (facebookDiagnosticId) {
      const errorCode =
        err instanceof oauthAuthService.OAuthEmailRequiredError
          ? err.code
          : err instanceof oauthAuthService.OAuthSignInFailedError
            ? err.code
            : err instanceof oauthAuthService.OAuthTokenVerificationError
              ? err.code
              : err instanceof EmailNotVerifiedLoginError
                ? err.code
                : undefined;
      logFacebookOAuthDiagnostic(facebookDiagnosticId, "failure", {
        errorClass: err instanceof Error ? err.name : "Error",
        ...(errorCode ? { errorCode } : {}),
      });
    }
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
      logFacebookOAuthHttpResponse(facebookDiagnosticId, {
        httpStatus: 401,
        responseBranch: "oauth_sign_in_failed",
        responseCode: AUTH_OAUTH_SIGN_IN_FAILED_CODE,
        errorClass: err.constructor.name,
      });
      return res.status(401).json({
        message: AUTH_OAUTH_GENERIC_FAILURE_MESSAGE,
        code: AUTH_OAUTH_SIGN_IN_FAILED_CODE,
      });
    }
    if (err instanceof oauthAuthService.OAuthEmailRequiredError) {
      logFacebookOAuthHttpResponse(facebookDiagnosticId, {
        httpStatus: 400,
        responseBranch: "oauth_email_required",
        responseCode: err.code,
        errorClass: err.constructor.name,
      });
      return res.status(400).json({
        message: err.message,
        code: err.code,
      });
    }
    const message = err instanceof Error ? err.message : "OAuth sign-in failed";
    if (err instanceof oauthAuthService.OAuthTokenVerificationError) {
      logServerError("auth.oauth.verifyIdToken", err);
      logFacebookOAuthHttpResponse(facebookDiagnosticId, {
        httpStatus: 401,
        responseBranch: "oauth_token_verification_failed",
        responseCode: oauthAuthService.OAUTH_TOKEN_VERIFICATION_FAILED_CODE,
        errorClass: err.constructor.name,
      });
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
    if (err instanceof oauthAuthService.OAuthDemoAccountLinkForbiddenError) {
      return res.status(403).json({
        message: err.message,
        code: err.code,
      });
    }
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

let refreshAuthResultForUserId = authService.authResultForUserId;

/** Isolated tests only — replaces the user lookup that follows a successful rotation. */
export const authRefreshTestHooks = {
  setAuthResultForUserId(fn: typeof authService.authResultForUserId | null): void {
    refreshAuthResultForUserId = fn ?? authService.authResultForUserId;
  },
};

function isDatabaseInfrastructureError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  );
}

function refreshUnavailable(res: Response, retryable: boolean) {
  return res.status(503).json({
    message: CLIENT_FALLBACK.loginUnexpected,
    code: "REFRESH_UNAVAILABLE",
    retryable,
  });
}

/** Issues a new access token when the short-lived JWT expires (refresh token rotated each use). */
export async function refresh(req: Request, res: Response) {
  try {
    const cookieHeader = req.headers.cookie;
    const rtCookie = parseCookie(cookieHeader, refreshCookieName());

    if (rtCookie) {
      let outcome: RefreshRotationOutcome;
      try {
        outcome = await rotateRefreshTokenWithOutcome(rtCookie, { graceMs: REFRESH_ROTATION_GRACE_MS });
      } catch (err) {
        if (err instanceof RefreshTokenStoreUnavailableError) {
          // Infrastructure failure: keep the cookie, the session may be perfectly valid.
          logRefreshOutcome({
            reason: "db_error",
            status: 503,
            committed: err.committed,
            errorCode: storeErrorCode(err.storeError),
          });
          return refreshUnavailable(res, !err.committed);
        }
        throw err;
      }

      if (outcome.kind === "conflict") {
        // A concurrent request already rotated this token; its response carries the new cookie.
        logRefreshOutcome({ reason: "rotation_conflict", status: 409, userId: outcome.userId });
        return res.status(409).json({ message: "Session refresh already in progress", code: "REFRESH_CONFLICT" });
      }

      if (outcome.kind === "rotated") {
        const cookieOpts = { maxAgeMs: refreshCookieMaxAgeMs(outcome.newExpiresAt) };
        try {
          const result = await refreshAuthResultForUserId(outcome.userId, {
            refreshSessionId: outcome.newId,
          });
          setRefreshCookie(res, outcome.newToken, cookieOpts);
          logRefreshOutcome({
            reason: "ok",
            status: 200,
            userId: outcome.userId,
            sessionId: outcome.newId,
            recovered: outcome.recoveredFromSessionId != null,
            msSinceRotation: outcome.msSinceRotation,
          });
          return res.json(result);
        } catch (inner) {
          if (inner instanceof EmailNotVerifiedLoginError) {
            clearRefreshCookie(res);
            logRefreshOutcome({ reason: "email_not_verified", status: 403, userId: outcome.userId });
            return res.status(403).json({
              message: inner.message,
              code: inner.code,
              canResend: inner.canResend,
            });
          }
          if (isDatabaseInfrastructureError(inner)) {
            // Rotation already committed: hand over the new token so a retry is not a replay.
            setRefreshCookie(res, outcome.newToken, cookieOpts);
            logRefreshOutcome({
              reason: "db_error",
              status: 503,
              userId: outcome.userId,
              sessionId: outcome.newId,
              committed: true,
              errorCode: storeErrorCode(inner),
            });
            return refreshUnavailable(res, true);
          }
          const msg = inner instanceof Error ? inner.message : "";
          if (msg === "Authentication required" || msg.toLowerCase().includes("not found")) {
            clearRefreshCookie(res);
            logRefreshOutcome({ reason: "account_unavailable", status: 401, userId: outcome.userId });
            return res.status(401).json({ message: "Authentication required" });
          }
          logServerError("auth.refresh.session", inner);
          logRefreshOutcome({ reason: "account_unavailable", status: 503, userId: outcome.userId });
          return res.status(503).json({ message: CLIENT_FALLBACK.loginUnexpected });
        }
      }

      logRefreshOutcome({
        reason: outcome.reason,
        status: 401,
        userId: outcome.userId,
        revokedSessions: outcome.revokedSessions,
        msSinceRotation: outcome.msSinceRotation,
      });
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
          const result = await refreshAuthResultForUserId(userId, { refreshSessionId: rt.id });
          setRefreshCookie(res, rt.token, { maxAgeMs: refreshCookieMaxAgeMs(rt.expiresAt) });
          logRefreshOutcome({ reason: "bearer_fallback_ok", status: 200, userId, sessionId: rt.id });
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

    if (!rtCookie) {
      logRefreshOutcome({ reason: "missing_cookie", status: 401 });
      return res.status(401).json({ message: "Authentication required", code: "REFRESH_COOKIE_MISSING" });
    }
    return res.status(401).json({ message: "Authentication required" });
  } catch (err) {
    if (isDatabaseInfrastructureError(err)) {
      logRefreshOutcome({ reason: "db_error", status: 503, errorCode: storeErrorCode(err) });
      return refreshUnavailable(res, true);
    }
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

export const SESSION_MIGRATE_MAX_ACCESS_TOKEN_AGE_MS = 2 * 60_000;

function bearerToken(req: Request): string {
  const h = req.headers.authorization;
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

/** `iat` of the (already verified) Bearer token is recent. */
function bearerIssuedWithin(req: Request, maxAgeMs: number): boolean {
  try {
    const decoded = verifyJwt<DecodedAccessClaims>(bearerToken(req));
    if (typeof decoded.iat !== "number") return false;
    const ageMs = Date.now() - decoded.iat * 1000;
    return ageMs >= -5_000 && ageMs <= maxAgeMs;
  } catch {
    return false;
  }
}

/** Session bound to a valid (signature + expiry) access token, for logout only. */
function logoutSessionFromBearer(req: Request): { userId: string; sid: string } | null {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const decoded = verifyJwt<DecodedAccessClaims>(token);
    if (mfaLoginService.isPendingMfaLoginJwt(decoded) || !isAllowedAccessJwtType(decoded.type)) return null;
    if (typeof decoded.impersonatedBy === "string" && decoded.impersonatedBy) return null;
    const userId = resolveJwtSubject(decoded);
    const sid = typeof decoded.sid === "string" ? decoded.sid.trim() : "";
    return userId && sid ? { userId, sid } : null;
  } catch {
    return null;
  }
}

/**
 * One-time move of a browser session to a refresh cookie issued by this API host (API hostname
 * migration). Requires a fully validated access token (authMiddleware: signature, tv, sid,
 * active account) carrying a session id; the old session is revoked as part of the move.
 */
export async function migrateSessionHost(req: Request, res: Response) {
  const userId = req.user?.sub ?? req.user?.userId;
  const sid = req.user?.sid?.trim();
  if (!userId || !sid || req.user?.impersonatedBy) {
    return res.status(401).json({ message: "Authentication required" });
  }
  // The client calls this right after refreshing on the previous host. An older access token
  // (e.g. one leaked from memory) cannot be turned into a long-lived refresh cookie.
  if (!bearerIssuedWithin(req, SESSION_MIGRATE_MAX_ACCESS_TOKEN_AGE_MS)) {
    return res.status(401).json({ message: "Authentication required", code: "SESSION_MIGRATE_STALE_TOKEN" });
  }
  try {
    const outcome = await migrateSessionToNewRefreshToken(sid, userId);
    if (outcome.kind === "conflict") {
      logRefreshOutcome({ reason: "rotation_conflict", status: 409, userId, sessionId: sid });
      return res.status(409).json({ message: "Session refresh already in progress", code: "REFRESH_CONFLICT" });
    }
    if (outcome.kind === "rejected") {
      logRefreshOutcome({
        reason: outcome.reason === "expired" ? "expired" : outcome.reason === "revoked" ? "revoked_logout" : "not_found",
        status: 401,
        userId,
        sessionId: sid,
      });
      return res.status(401).json({ message: "Authentication required" });
    }
    const result = await refreshAuthResultForUserId(userId, { refreshSessionId: outcome.newId });
    setRefreshCookie(res, outcome.newToken, { maxAgeMs: refreshCookieMaxAgeMs(outcome.newExpiresAt) });
    logRefreshOutcome({ reason: "ok", status: 200, userId, sessionId: outcome.newId, recovered: false });
    return res.json(result);
  } catch (err) {
    if (err instanceof RefreshTokenStoreUnavailableError) {
      logRefreshOutcome({
        reason: "db_error",
        status: 503,
        userId,
        committed: err.committed,
        errorCode: storeErrorCode(err.storeError),
      });
      return refreshUnavailable(res, !err.committed);
    }
    if (isDatabaseInfrastructureError(err)) {
      logRefreshOutcome({ reason: "db_error", status: 503, userId, errorCode: storeErrorCode(err) });
      return refreshUnavailable(res, false);
    }
    if (err instanceof EmailNotVerifiedLoginError) {
      return res.status(403).json({ message: err.message, code: err.code, canResend: err.canResend });
    }
    logServerError("auth.migrateSessionHost", err);
    return res.status(401).json({ message: "Authentication required" });
  }
}

/** Logs out by revoking the current refresh session and clearing the cookie. */
export async function logout(req: Request, res: Response) {
  try {
    const cookieHeader = req.headers.cookie;
    const refreshCookie = parseCookie(cookieHeader, refreshCookieName());
    let logoutUserId: string | null = null;
    let revoked = 0;

    if (refreshCookie) {
      const r = await revokeRefreshSessionChain({ tokenHash: refreshTokenHash(refreshCookie) });
      logoutUserId = r.userId;
      revoked += r.revoked;
    }
    // The browser's access token names its session even when this host holds no cookie (API host
    // migration, logout racing a refresh). Revoking it here keeps logout complete on either host.
    const bearerSession = logoutSessionFromBearer(req);
    if (bearerSession) {
      const r = await revokeRefreshSessionChain({ id: bearerSession.sid }, bearerSession.userId);
      logoutUserId = logoutUserId ?? r.userId;
      revoked += r.revoked;
    }

    clearRefreshCookie(res);
    res.json({ ok: true, revoked });

    if (logoutUserId) {
      void import("../socket/socketServer.js")
        .then(({ disconnectUserSockets }) => {
          disconnectUserSockets(logoutUserId!);
        })
        .catch((err) => logServerError("auth.logout.sockets", err));
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
      const onboardingProfile = profile
        ? {
            name: profile.name,
            businessType: profile.type,
            registeredAddress: profile.registeredAddress,
            contactPhone: profile.contactPhone,
            logoPath: profile.logo,
          }
        : null;
      if (!managerProfileReadyToFinish(onboardingProfile)) {
        if (inferManagerOnboardingStep(onboardingProfile) < 3) {
          return res.status(400).json({
            message: "Complete business details, venue address, and team contact phone before finishing onboarding.",
          });
        }
        return res.status(400).json({
          message: "Upload a business logo before finishing onboarding.",
          code: "ONBOARDING_LOGO_REQUIRED",
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
    const activatedMfa = await prisma.user.findUnique({
      where: { id: result.user.id },
      select: { id: true, twoFactorEnabled: true, role: true, isPlatformAdmin: true },
    });
    if (activatedMfa && mfaLoginService.needsMfaLoginChallenge(activatedMfa)) {
      return jsonMfaLoginChallenge(req, res, activatedMfa);
    }
    try {
      const rt = await issueRefreshToken(result.user.id);
      const session = await authService.authResultForUserId(result.user.id, {
        refreshSessionId: rt.id,
      });
      setRefreshCookie(res, rt.token, { maxAgeMs: refreshCookieMaxAgeMs(rt.expiresAt) });
      return res.status(200).json(session);
    } catch (e) {
      logServerError("auth.activateEmployee.issueRefreshToken", e);
      return res.status(503).json({ message: "Account activated, but we couldn't start your session. Please sign in." });
    }
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
