import jwt from "jsonwebtoken";
import type { JwtPayload } from "../middleware/auth.middleware.js";
import {
  type DecodedAccessClaims,
  isAllowedAccessJwtType,
  resolveJwtSubject,
  verifyJwt,
} from "./jwtConfig.js";
import { isPendingMfaLoginJwt } from "../services/mfaLogin.service.js";

/** Grace period after access JWT expiry — allows session recovery when refresh cookie was lost (e.g. dev proxy misconfig). */
const EXPIRED_ACCESS_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

let expiredAccessRefreshWarned = false;

/**
 * Disabled in production — `ALLOW_EXPIRED_ACCESS_TOKEN_REFRESH` is ignored when `NODE_ENV=production`.
 * In non-production, opt-in via `true`/`1`; default enabled for dev recovery.
 */
export function isExpiredAccessTokenRefreshAllowed(): boolean {
  if (process.env.NODE_ENV === "production") {
    const raw = process.env.ALLOW_EXPIRED_ACCESS_TOKEN_REFRESH?.trim().toLowerCase();
    if (raw === "true" || raw === "1") {
      if (!expiredAccessRefreshWarned) {
        expiredAccessRefreshWarned = true;
        console.warn(
          "[auth] ALLOW_EXPIRED_ACCESS_TOKEN_REFRESH is set but ignored in production — expired Bearer refresh fallback is disabled.",
        );
      }
    }
    return false;
  }

  const raw = process.env.ALLOW_EXPIRED_ACCESS_TOKEN_REFRESH?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") {
    if (!expiredAccessRefreshWarned) {
      expiredAccessRefreshWarned = true;
      console.warn(
        "[auth] ALLOW_EXPIRED_ACCESS_TOKEN_REFRESH is enabled — Bearer fallback accepts recently expired access JWTs (development only).",
      );
    }
    return true;
  }
  return true;
}

/**
 * Resolve user id from Bearer access token for POST /api/auth/refresh fallback.
 * Always accepts currently-valid access JWTs.
 * Recently expired tokens are accepted only when expired-grace is enabled (non-prod default).
 */
export function userIdFromAccessTokenForRefresh(bearer: string): string | null {
  const token = String(bearer ?? "").trim();
  if (!token) return null;

  try {
    const decoded = verifyJwt<DecodedAccessClaims & JwtPayload>(token);
    if (isPendingMfaLoginJwt(decoded) || !isAllowedAccessJwtType(decoded.type)) return null;
    return resolveJwtSubject(decoded);
  } catch (err) {
    if (!(err instanceof jwt.TokenExpiredError)) return null;
    if (!isExpiredAccessTokenRefreshAllowed()) return null;
    try {
      const decoded = verifyJwt<DecodedAccessClaims & JwtPayload & { exp?: number }>(token, {
        ignoreExpiration: true,
      });
      if (isPendingMfaLoginJwt(decoded) || !isAllowedAccessJwtType(decoded.type)) return null;
      const exp = decoded.exp;
      if (typeof exp === "number" && Date.now() - exp * 1000 > EXPIRED_ACCESS_GRACE_MS) {
        return null;
      }
      return resolveJwtSubject(decoded);
    } catch {
      return null;
    }
  }
}
