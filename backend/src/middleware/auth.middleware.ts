import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import type { Role as PrismaRole } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  ACCESS_JWT_TYPE,
  IMPERSONATION_JWT_TYPE,
  type DecodedAccessClaims,
  accessTokenMissingRequiredSessionBind,
  isAllowedAccessJwtType,
  resolveJwtSubject,
  verifyJwt,
} from "../lib/jwtConfig.js";
import { isPendingMfaLoginJwt } from "../services/mfaLogin.service.js";

export interface JwtPayload {
  /** Canonical subject (user id). */
  sub: string;
  /** @deprecated Legacy alias — use `sub`. */
  userId?: string;
  /** @deprecated Legacy alias — use `sub`. */
  id?: string;
  role: PrismaRole;
  type?: typeof ACCESS_JWT_TYPE | typeof IMPERSONATION_JWT_TYPE | string;
  /** Refresh session id — when present, must match an active refresh row. */
  sid?: string;
  /** Must match `users.auth_token_version` when present. */
  tv?: number;
  /** Present when a platform admin is acting as a business owner JWT. */
  impersonatedBy?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function normalizeJwtPayload(decoded: DecodedAccessClaims): JwtPayload | null {
  const sub = resolveJwtSubject(decoded);
  if (!sub || !decoded.role) return null;
  return {
    sub,
    userId: sub,
    id: sub,
    role: decoded.role as PrismaRole,
    type: decoded.type,
    sid: typeof decoded.sid === "string" ? decoded.sid : undefined,
    tv: typeof decoded.tv === "number" ? decoded.tv : undefined,
    impersonatedBy:
      typeof decoded.impersonatedBy === "string" ? decoded.impersonatedBy : undefined,
  };
}

export async function assertAccessJwtStillValid(payload: JwtPayload): Promise<string | null> {
  if (accessTokenMissingRequiredSessionBind(payload)) {
    return "SESSION_STALE";
  }
  const uid = payload.sub;
  const userRow = await prisma.user.findUnique({
    where: { id: uid },
    select: { authTokenVersion: true, isActive: true, accountStatus: true },
  });
  if (!userRow || userRow.isActive !== true || userRow.accountStatus !== "active") {
    return "Authentication required";
  }

  if (typeof payload.tv === "number" && payload.tv !== userRow.authTokenVersion) {
    return "SESSION_STALE";
  }

  const sid = payload.sid?.trim();
  if (sid) {
    const session = await prisma.refreshToken.findUnique({
      where: { id: sid },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (
      !session ||
      session.userId !== uid ||
      session.revokedAt != null ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      return "SESSION_STALE";
    }
  }

  return null;
}

function invalidTokenResponse(res: Response, err: unknown) {
  if (err instanceof jwt.TokenExpiredError) {
    return res.status(401).json({ message: "Access token expired", code: "TOKEN_EXPIRED" });
  }
  return res.status(401).json({ message: "Invalid or expired token", code: "TOKEN_INVALID" });
}

/** Sets `req.user` when a valid Bearer token is present; does not reject missing/invalid tokens. */
export function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return next();
  }
  void (async () => {
    try {
      const decoded = verifyJwt<DecodedAccessClaims>(token);
      if (isPendingMfaLoginJwt(decoded) || !isAllowedAccessJwtType(decoded.type)) return next();
      const payload = normalizeJwtPayload(decoded);
      if (!payload) return next();
      // Even for optional-auth endpoints, never trust a stale/revoked/disabled session.
      const staleCode = await assertAccessJwtStillValid(payload);
      if (staleCode) return next();

      req.user = payload;
    } catch {
      // ignore invalid optional token
    }
    next();
  })();
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  void (async () => {
    try {
      const decoded = verifyJwt<DecodedAccessClaims>(token);
      if (isPendingMfaLoginJwt(decoded) || !isAllowedAccessJwtType(decoded.type)) {
        return res.status(401).json({ message: "Invalid or expired token", code: "TOKEN_INVALID" });
      }
      const payload = normalizeJwtPayload(decoded);
      if (!payload) {
        return res.status(401).json({ message: "Invalid or expired token", code: "TOKEN_INVALID" });
      }

      const staleCode = await assertAccessJwtStillValid(payload);
      if (staleCode) {
        return res.status(401).json({
          message: "Authentication required",
          code: staleCode === "SESSION_STALE" ? "SESSION_STALE" : undefined,
        });
      }

      req.user = payload;
      next();
    } catch (err) {
      return invalidTokenResponse(res, err);
    }
  })();
}

export function requireRole(...roles: PrismaRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const uid = req.user?.sub ?? req.user?.userId ?? req.user?.id;
    if (!uid) {
      return res.status(401).json({ message: "Authentication required" });
    }
    try {
      const row = await prisma.user.findUnique({
        where: { id: uid },
        select: { role: true, isActive: true },
      });
      if (!row || row.isActive !== true) {
        return res.status(401).json({ message: "Authentication required" });
      }
      if (!roles.includes(row.role)) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      if (req.user) {
        req.user.role = row.role;
        req.user.sub = uid;
        req.user.userId = uid;
        req.user.id = uid;
      }
      next();
    } catch {
      return res.status(503).json({ message: "Service temporarily unavailable" });
    }
  };
}

/**
 * Admin-route gate based on JWT role claim.
 * Applies only where explicitly mounted (e.g. /api/platform).
 *
 * IMPORTANT:
 * - Does not replace DB-backed checks (see requirePlatformAdmin).
 * - If role claim is missing, logs a warning and returns 403 (does not crash).
 */
export function requireAdminRoleClaim(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (!role) {
    console.warn("[rbac] Missing role claim on admin route", {
      userId: req.user?.sub ?? req.user?.userId ?? req.user?.id,
      path: req.originalUrl ?? req.url,
    });
    return res.status(403).json({ message: "Insufficient permissions" });
  }

  // Support both the requested string "admin" and the app's canonical SUPER_ADMIN role.
  const s = String(role).trim().toLowerCase();
  if (s !== "admin" && role !== Role.SUPER_ADMIN) {
    return res.status(403).json({ message: "Insufficient permissions" });
  }
  next();
}

/**
 * Enforces that the authenticated user's email is verified.
 * Kept separate from authMiddleware so public routes can still authenticate without this gate if needed.
 */
export async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  const uid = req.user?.sub ?? req.user?.userId ?? req.user?.id;
  if (!uid) {
    return res.status(401).json({ message: "Authentication required" });
  }
  try {
    const row = await prisma.user.findUnique({
      where: { id: uid },
      select: { emailVerified: true, isActive: true, role: true, isPlatformAdmin: true },
    });
    if (!row || row.isActive !== true) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (row.emailVerified !== true) {
      return res.status(403).json({ message: "Email verification required" });
    }
    // Reject stale JWT role claims (e.g. after demotion or role change in DB).
    if (req.user && req.user.role !== row.role) {
      return res.status(401).json({ message: "Authentication required", code: "SESSION_STALE" });
    }
    if (req.user) {
      req.user.role = row.role;
    }
    next();
  } catch {
    return res.status(503).json({ message: "Service temporarily unavailable" });
  }
}

/**
 * Platform / Super Admin routes only. Does **not** trust JWT role claims: always loads the user from PostgreSQL.
 * Requires: user exists, `role === SUPER_ADMIN`, `isPlatformAdmin === true`, `isActive === true`.
 */
export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const uid = req.user?.sub ?? req.user?.userId ?? req.user?.id;
  if (!uid) {
    return res.status(401).json({ message: "Authentication required" });
  }
  try {
    const row = await prisma.user.findUnique({
      where: { id: uid },
      select: { id: true, role: true, isPlatformAdmin: true, isActive: true, emailVerified: true },
    });
    if (
      !row ||
      row.role !== Role.SUPER_ADMIN ||
      !row.isPlatformAdmin ||
      !row.isActive ||
      !row.emailVerified
    ) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  } catch {
    return res.status(503).json({ message: "Service temporarily unavailable" });
  }
}
