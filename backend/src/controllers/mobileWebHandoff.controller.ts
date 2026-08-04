import type { Request, Response } from "express";
import {
  createMobileWebHandoff,
  consumeMobileWebHandoff,
  isMobileWebHandoffPurpose,
  auditMobileWebHandoff,
  auditHandoffFailure,
  MobileWebHandoffError,
} from "../services/mobileWebHandoff.service.js";
import * as authService from "../services/auth.service.js";
import {
  refreshCookieMaxAgeMs,
  setRefreshCookie,
} from "../services/refreshToken.service.js";
import { clientSafeMessage, CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";
import { extractLoginRequestContext } from "../services/loginNotification.service.js";

function getUserId(req: Request): string | null {
  const uid = req.user?.sub ?? req.user?.userId ?? req.user?.id;
  return typeof uid === "string" && uid.trim() ? uid.trim() : null;
}

/**
 * POST /api/mobile/create-billing-session
 * Authenticated mobile manager → short-lived one-time web handoff URL.
 */
export async function createBillingSession(req: Request, res: Response): Promise<void> {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }

    const body = (req.body ?? {}) as { purpose?: unknown; destination?: unknown };
    // Ignore any client destination — purpose alone selects the server allowlist path.
    if (body.destination != null) {
      void auditMobileWebHandoff("mobile_web_handoff.destination_ignored", userId, {
        destination: typeof body.destination === "string" ? body.destination.slice(0, 200) : typeof body.destination,
      });
    }
    const purpose = isMobileWebHandoffPurpose(body.purpose) ? body.purpose : "billing";
    const { ip, userAgent } = extractLoginRequestContext(req);

    const result = await createMobileWebHandoff({
      userId,
      purpose,
      createdIp: ip,
      createdUserAgent: userAgent,
    });

    void auditMobileWebHandoff("mobile_web_handoff.created", userId, {
      purpose: result.purpose,
      destinationPath: result.destinationPath,
      expiresAt: result.expiresAt,
      createdIp: ip,
      createdUserAgentFamily: userAgent ? "native_or_client" : null,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof MobileWebHandoffError) {
      auditHandoffFailure(err);
      if (err.message === "Authentication required") {
        res.status(401).json({ message: err.message });
        return;
      }
      if (err.code === "wrong_role") {
        res.status(403).json({ message: err.message || "Insufficient permissions" });
        return;
      }
      res.status(400).json({ message: "Handoff link is invalid or has expired." });
      return;
    }
    logServerError("mobileWebHandoff.createBillingSession", err);
    const message = err instanceof Error ? err.message : "";
    if (message === "Authentication required") {
      res.status(401).json({ message });
      return;
    }
    if (message === "Insufficient permissions") {
      res.status(403).json({ message });
      return;
    }
    if (message === "Email verification required" || message === "Onboarding incomplete") {
      res.status(403).json({ message });
      return;
    }
    // Common ops failure: code shipped before migrate deploy applied the handoff table.
    if (
      /mobile_web_handoff_tokens/i.test(message) &&
      (/does not exist/i.test(message) || /42P01/.test(message) || /P2021/.test(message))
    ) {
      res.status(503).json({
        message: "Billing handoff is temporarily unavailable. Please try again shortly.",
      });
      return;
    }
    res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.generic),
    });
  }
}

/**
 * POST /api/auth/mobile-web-handoff/consume
 * Public (token-gated): mint normal web session (refresh cookie + access JWT).
 *
 * Multi-session policy: adds a new web refresh session; does not revoke the mobile
 * app's refresh token or other concurrent sessions.
 */
export async function consumeMobileWebHandoffSession(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const body = (req.body ?? {}) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    const { ip, userAgent } = extractLoginRequestContext(req);

    const consumed = await consumeMobileWebHandoff({
      plainToken: token,
      consumeIp: ip,
      consumeUserAgent: userAgent,
    });

    const session = await authService.authResultForUserId(consumed.userId, {
      refreshSessionId: consumed.refreshTokenId,
    });
    setRefreshCookie(res, consumed.refreshToken, {
      maxAgeMs: refreshCookieMaxAgeMs(consumed.refreshExpiresAt),
    });

    void auditMobileWebHandoff("mobile_web_handoff.consumed", consumed.userId, {
      purpose: consumed.purpose,
      destinationPath: consumed.destinationPath,
      consumeIp: ip,
      multiSession: true,
    });

    res.status(200).json({
      ...session,
      destinationPath: consumed.destinationPath,
      purpose: consumed.purpose,
    });
  } catch (err) {
    if (err instanceof MobileWebHandoffError) {
      auditHandoffFailure(err);
      res.status(400).json({ message: "Handoff link is invalid or has expired." });
      return;
    }
    logServerError("mobileWebHandoff.consume", err);
    res.status(400).json({
      message: clientSafeMessage(err, "Handoff link is invalid or has expired."),
    });
  }
}
