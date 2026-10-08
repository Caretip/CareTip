import type { Request, Response } from "express";
import * as authService from "../services/auth.service.js";
import * as oauthAuthService from "../services/oauthAuth.service.js";
import {
  buildFrontendCompleteUrl,
  consumeFacebookOAuthCompletion,
  consumeFacebookOAuthState,
  createFacebookOAuthCompletion,
  createFacebookOAuthState,
  exchangeFacebookAuthorizationCode,
  FacebookOAuthCompletionError,
  FacebookOAuthStateError,
  hashFacebookOAuthStateIdForLog,
  logFacebookOAuthStateRejection,
  newFacebookOAuthCorrelationId,
  resolveAllowlistedReturnPath,
  resolveFacebookOAuthStateCompleteError,
  applyFacebookOAuthCallbackCacheHeaders,
  recordFacebookOAuthRedirectSuccess,
  resolveFacebookOAuthConsumedStateReplay,
  type FacebookOAuthRedirectFlow,
  type FacebookOAuthStatePayload,
} from "../services/oauth/facebookOAuthRedirect.service.js";
import { logFacebookOAuthDiagnostic } from "../services/oauth/facebookOAuthDiagnostic.js";
import {
  logFacebookOAuthStartServer,
  sanitizeFacebookRedirectTargetForLog,
} from "../services/oauth/facebookOAuthStartLog.js";
import {
  issueRefreshToken,
  refreshCookieMaxAgeMs,
  setRefreshCookie,
} from "../services/refreshToken.service.js";
import { CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";
import {
  MERCHANT_LEGAL_ACCEPTANCE_CONTEXT,
  MERCHANT_LEGAL_ACCEPTANCE_REQUIRED_MSG,
  assertAndRecordMerchantLegalAcceptance,
  parseMerchantLegalAcceptedFlag,
} from "../lib/merchantLegalAcceptance.js";
import * as mfaLoginService from "../services/mfaLogin.service.js";
import { prisma } from "../prisma.js";
import { extractLoginRequestContext, handlePostLoginNotifications } from "../services/loginNotification.service.js";
import { resolveFacebookOAuthAuthCompleteError } from "../lib/facebookOAuthRedirectCompleteErrors.js";
import { OAuthEmailRequiredError } from "../services/oauthAuth.service.js";

function getUserId(req: Request): string | null {
  const uid = req.user?.sub ?? req.user?.userId ?? req.user?.id;
  return typeof uid === "string" && uid.trim() ? uid.trim() : null;
}

function parseClientTimeZone(body: Record<string, unknown>): string | undefined {
  const tz = body.clientTimeZone ?? body.timeZone ?? body.timezone;
  return typeof tz === "string" && tz.trim() ? tz.trim().slice(0, 64) : undefined;
}

async function issueRefreshSessionForUser(
  res: Response,
  userId: string,
): Promise<authService.AuthResult> {
  const rt = await issueRefreshToken(userId);
  const result = await authService.authResultForUserId(userId, { refreshSessionId: rt.id });
  setRefreshCookie(res, rt.token, { maxAgeMs: refreshCookieMaxAgeMs(rt.expiresAt) });
  return result;
}

function redirectComplete(res: Response, params: Record<string, string>): void {
  applyFacebookOAuthCallbackCacheHeaders(res);
  res.redirect(302, buildFrontendCompleteUrl(params));
}

function startFailureJson(
  res: Response,
  requestId: string,
  status: number,
  fields: { reason: string; message: string; code?: string },
): void {
  logFacebookOAuthStartServer("START_FAILURE", {
    requestId,
    status,
    reason: fields.reason,
    ...(fields.code ? { code: fields.code } : {}),
  });
  res.status(status).json({
    message: fields.message,
    requestId,
    ...(fields.code ? { code: fields.code } : {}),
  });
}

function failRedirect(
  res: Response,
  correlationId: string | undefined,
  error: string,
  extra?: Record<string, string>,
): void {
  if (correlationId) {
    logFacebookOAuthDiagnostic(correlationId, "facebook_oauth_failed", {
      channel: "redirect",
      errorCode: error,
    });
  }
  redirectComplete(res, { error, ...(extra ?? {}) });
}

/**
 * POST /api/auth/facebook/start
 * Body mirrors POST /api/auth/oauth signup/login context (no idToken).
 */
export async function startFacebookOAuthRedirect(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const correlationId =
    (typeof body.correlationId === "string" && body.correlationId.trim()) ||
    newFacebookOAuthCorrelationId();
  const requestId = correlationId;
  const startedAt = Date.now();

  try {
    const path = req.originalUrl ?? req.url ?? "";
    const flowRaw =
      path.includes("/facebook/start/link") ? "link" : typeof body.flow === "string" ? body.flow.trim() : "";
    const isLoginFlag = body.isLogin === true || body.isLogin === "true";
    const flow: FacebookOAuthRedirectFlow =
      flowRaw === "link" ? "link" : isLoginFlag ? "login" : "signup";

    const origin = req.get("origin")?.trim() || undefined;
    const refererOrigin = (() => {
      const ref = req.get("referer")?.trim();
      if (!ref) return undefined;
      try {
        return new URL(ref).origin;
      } catch {
        return undefined;
      }
    })();

    logFacebookOAuthStartServer("START_REQUEST_RECEIVED", {
      requestId,
      flow,
      origin: origin ?? refererOrigin ?? null,
      userAgent: req.get("user-agent")?.slice(0, 256) ?? null,
      method: req.method,
      path,
      hasOriginHeader: Boolean(origin),
      hasReferer: Boolean(req.get("referer")),
    });

    const returnPath = resolveAllowlistedReturnPath(
      typeof body.returnPath === "string" ? body.returnPath : undefined,
      flow,
    );

    let linkUserId: string | undefined;
    if (flow === "link") {
      const uid = getUserId(req);
      if (!uid) {
        startFailureJson(res, requestId, 401, {
          reason: "authentication_required",
          message: "Authentication required",
        });
        return;
      }
      linkUserId = uid;
    }

    const isLogin = flow === "login";
    const intendedRole = authService.parseLoginIntendedRole(body.intendedRole);

    if (flow === "signup" && !isLogin && !intendedRole) {
      startFailureJson(res, requestId, 400, {
        reason: "intended_role_required",
        message: "intendedRole is required and must be 'MANAGER', 'EMPLOYEE', or 'SUPER_ADMIN'",
      });
      return;
    }

    if (
      flow === "signup" &&
      !isLogin &&
      intendedRole === "MANAGER" &&
      !parseMerchantLegalAcceptedFlag(
        body.merchantLegalAccepted ?? body.legalAccepted ?? body.acceptMerchantLegal,
      )
    ) {
      startFailureJson(res, requestId, 400, {
        reason: "merchant_legal_acceptance_required",
        message: MERCHANT_LEGAL_ACCEPTANCE_REQUIRED_MSG,
        code: "MERCHANT_LEGAL_ACCEPTANCE_REQUIRED",
      });
      return;
    }

    const payload: FacebookOAuthStatePayload = {
      version: 1,
      flow,
      correlationId,
      isLogin,
      returnPath,
      ...(flow === "signup" && !isLogin
        ? {
            intendedRole: intendedRole ?? undefined,
            name: typeof body.name === "string" ? body.name : undefined,
            businessName: typeof body.businessName === "string" ? body.businessName : undefined,
            businessType: typeof body.businessType === "string" ? body.businessType : undefined,
            location: typeof body.location === "string" ? body.location : undefined,
            inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : undefined,
            locale: typeof body.locale === "string" ? body.locale.trim() : undefined,
            merchantLegalAccepted: parseMerchantLegalAcceptedFlag(
              body.merchantLegalAccepted ?? body.legalAccepted ?? body.acceptMerchantLegal,
            ),
          }
        : {}),
      ...(linkUserId ? { linkUserId } : {}),
    };

    const { ip, userAgent } = extractLoginRequestContext(req);
    const { authorizationUrl } = await createFacebookOAuthState({
      payload,
      createdIp: ip,
      createdUserAgent: userAgent,
    });

    logFacebookOAuthStartServer("START_STATE_CREATED", {
      requestId,
      flow,
      elapsedMs: Date.now() - startedAt,
    });

    const redirectTargetForLog = sanitizeFacebookRedirectTargetForLog(authorizationUrl);
    logFacebookOAuthStartServer("START_REDIRECT_CREATED", {
      requestId,
      flow,
      redirectTarget: redirectTargetForLog,
      elapsedMs: Date.now() - startedAt,
    });

    logFacebookOAuthStartServer("START_RESPONSE", {
      requestId,
      status: 302,
      redirected: true,
      redirectTarget: redirectTargetForLog,
      elapsedMs: Date.now() - startedAt,
    });

    res.redirect(302, authorizationUrl);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logFacebookOAuthStartServer("START_EXCEPTION", {
      requestId,
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
      stage: "startFacebookOAuthRedirect",
      elapsedMs: Date.now() - startedAt,
    });
    logServerError("facebookOAuthRedirect.start", err);
    res.status(503).json({
      message: CLIENT_FALLBACK.loginUnexpected,
      requestId,
    });
  }
}

/**
 * GET /api/auth/facebook/callback — Facebook redirects here (no trusted Origin).
 */
export async function facebookOAuthCallback(req: Request, res: Response): Promise<void> {
  const query = req.query as Record<string, string | undefined>;
  const stateId = typeof query.state === "string" ? query.state : "";
  let correlationId: string | undefined;

  try {
    if (query.error === "access_denied" || query.error === "user_denied") {
      failRedirect(res, undefined, "cancelled");
      return;
    }
    if (query.error) {
      failRedirect(res, undefined, "denied");
      return;
    }

    const code = typeof query.code === "string" ? query.code.trim() : "";
    if (!code || !stateId) {
      failRedirect(res, undefined, "invalid_callback");
      return;
    }

    let state: FacebookOAuthStatePayload;
    try {
      state = await consumeFacebookOAuthState(stateId);
    } catch (e) {
      if (e instanceof FacebookOAuthStateError) {
        let stateFailCorrelationId: string | undefined;
        try {
          const id = stateId.trim();
          if (id) {
            const row = await prisma.facebookOAuthState.findUnique({
              where: { id },
              select: { payload: true },
            });
            const payload = row?.payload as FacebookOAuthStatePayload | undefined;
            stateFailCorrelationId = payload?.correlationId;
          }
        } catch {
          /* logging only */
        }
        if (e.code === "consumed") {
          const replayParams = await resolveFacebookOAuthConsumedStateReplay(stateId);
          if (replayParams) {
            logFacebookOAuthDiagnostic(
              stateFailCorrelationId ?? `fb_state_${hashFacebookOAuthStateIdForLog(stateId)}`,
              "facebook_oauth_replay_recovered",
              { stateIdHash: hashFacebookOAuthStateIdForLog(stateId) },
            );
            redirectComplete(res, replayParams);
            return;
          }
        }
        logFacebookOAuthStateRejection(stateId, e.code, stateFailCorrelationId);
        const completeError = resolveFacebookOAuthStateCompleteError(e.code);
        failRedirect(res, stateFailCorrelationId, completeError);
        return;
      }
      throw e;
    }

    correlationId = state.correlationId;
    logFacebookOAuthDiagnostic(correlationId, "facebook_callback_received", {
      flow: state.flow,
      isLogin: state.isLogin,
    });
    logFacebookOAuthDiagnostic(correlationId, "facebook_state_validated", { flow: state.flow });

    const accessToken = await exchangeFacebookAuthorizationCode(code, correlationId);

    if (state.flow === "link") {
      const linkUserId = state.linkUserId?.trim();
      if (!linkUserId) {
        failRedirect(res, correlationId, "state_invalid");
        return;
      }
      await oauthAuthService.linkOAuthProviderForUser(linkUserId, "facebook", accessToken);
      logFacebookOAuthDiagnostic(correlationId, "facebook_redirect_completed", {
        channel: "link",
      });
      try {
        await recordFacebookOAuthRedirectSuccess({
          kind: "link_ok",
          correlationId,
          stateId,
          returnPath: state.returnPath,
        });
      } catch (recordErr) {
        logServerError("facebookOAuthRedirect.recordLinkCompletion", recordErr);
      }
      redirectComplete(res, {
        link: "ok",
        return: state.returnPath,
      });
      return;
    }

    const result = await oauthAuthService.authenticateWithOAuth(
      "facebook",
      {
        idToken: accessToken,
        isLogin: state.isLogin,
        intendedRole: state.intendedRole,
        name: state.name,
        businessName: state.businessName,
        inviteCode: state.inviteCode,
        businessType: state.businessType,
        location: state.location,
        locale: state.locale,
      },
      {
        acceptLanguage: req.get("accept-language") ?? undefined,
        facebookDiagnosticId: correlationId,
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
        failRedirect(res, correlationId, "sign_in_failed");
        return;
      }
      const mfaSetupRequired = mfaLoginService.mfaSetupRequiredForLogin(oauthMfaUser);
      const pendingMfaToken = mfaLoginService.signPendingMfaLoginToken(oauthMfaUser.id);
      const { plainToken } = await createFacebookOAuthCompletion({
        kind: "mfa",
        correlationId,
        payload: { mfaRequired: true, mfaSetupRequired, pendingMfaToken },
      });
      redirectComplete(res, { completion: plainToken });
      return;
    }

    if (!result.token?.trim() || !result.user?.id) {
      failRedirect(res, correlationId, "sign_in_failed");
      return;
    }

    try {
      await issueRefreshSessionForUser(res, result.user.id);
    } catch (e) {
      logServerError("facebookOAuthRedirect.issueRefresh", e);
      failRedirect(res, correlationId, "session_failed");
      return;
    }

    if (state.isLogin) {
      const locale = state.locale === "en" || state.locale === "de" ? state.locale : undefined;
      void (async () => {
        try {
          const { ip, userAgent } = extractLoginRequestContext(req);
          await handlePostLoginNotifications({
            userId: result.user.id,
            email: result.user.email,
            ip,
            userAgent,
            explicitLocale: locale,
            clientTimeZone: parseClientTimeZone({}),
          });
        } catch (e) {
          logServerError("facebookOAuthRedirect.loginSecurityAlert", e);
        }
      })();
    }

    if (!state.isLogin && result.user.role === "MANAGER") {
      try {
        await assertAndRecordMerchantLegalAcceptance({
          userId: result.user.id,
          accepted: state.merchantLegalAccepted === true,
          context: MERCHANT_LEGAL_ACCEPTANCE_CONTEXT.oauth_signup,
          language: state.locale ?? req.get("accept-language")?.slice(0, 2),
          businessId: result.user.businessId ?? null,
        });
      } catch (acceptErr) {
        logServerError("facebookOAuthRedirect.merchantLegal", acceptErr);
      }
    }

    logFacebookOAuthDiagnostic(correlationId, "facebook_session_created", {
      isLogin: state.isLogin,
      userId: result.user.id,
    });
    logFacebookOAuthDiagnostic(correlationId, "facebook_redirect_completed", {
      channel: state.isLogin ? "login" : "signup",
    });

    try {
      await recordFacebookOAuthRedirectSuccess({
        kind: "session",
        correlationId,
        stateId,
        userId: result.user.id,
      });
    } catch (recordErr) {
      logServerError("facebookOAuthRedirect.recordSessionCompletion", recordErr);
    }

    redirectComplete(res, { success: "1" });
  } catch (err) {
    if (correlationId) {
      const code = resolveFacebookOAuthAuthCompleteError(err);
      if (err instanceof OAuthEmailRequiredError) {
        failRedirect(res, correlationId, "email_required");
        return;
      }
      failRedirect(res, correlationId, code);
      return;
    }
    logServerError("facebookOAuthRedirect.callback", err);
    failRedirect(res, undefined, "sign_in_failed");
  }
}

/**
 * POST /api/auth/facebook/complete — consume one-time MFA handoff (session uses refresh cookie).
 */
export async function consumeFacebookOAuthComplete(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      res.status(400).json({ message: "token is required" });
      return;
    }
    const row = await consumeFacebookOAuthCompletion(token);
    if (row.kind === "mfa") {
      res.status(200).json(row.payload);
      return;
    }
    res.status(400).json({ message: "Invalid completion token" });
  } catch (err) {
    if (err instanceof FacebookOAuthCompletionError) {
      res.status(400).json({ message: err.message });
      return;
    }
    logServerError("facebookOAuthRedirect.complete", err);
    res.status(503).json({ message: CLIENT_FALLBACK.loginUnexpected });
  }
}
