import jwt, { type SignOptions, type VerifyOptions } from "jsonwebtoken";

/** Only HS256 is permitted — blocks algorithm confusion / downgrade attacks. */
export const JWT_HS256_ALGORITHMS = ["HS256"] as const;

export const ACCESS_JWT_TYPE = "access";
export const IMPERSONATION_JWT_TYPE = "impersonation";

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("JWT_SECRET not configured");
  }
  return secret;
}

export function jwtSignOptions(expiresIn: SignOptions["expiresIn"]): SignOptions {
  return {
    algorithm: "HS256",
    expiresIn,
  };
}

export function jwtVerifyOptions(extra?: Pick<VerifyOptions, "ignoreExpiration">): VerifyOptions {
  return {
    algorithms: [...JWT_HS256_ALGORITHMS],
    ...extra,
  };
}

export function verifyJwt<T extends jwt.JwtPayload>(
  token: string,
  extra?: Pick<VerifyOptions, "ignoreExpiration">,
): T {
  return jwt.verify(token, getJwtSecret(), jwtVerifyOptions(extra)) as T;
}

export function signJwt(
  payload: Record<string, unknown>,
  expiresIn: SignOptions["expiresIn"],
): string {
  return jwt.sign(payload, getJwtSecret(), jwtSignOptions(expiresIn));
}

export type DecodedAccessClaims = jwt.JwtPayload & {
  sub?: string;
  userId?: string;
  id?: string;
  role?: string;
  type?: string;
  sid?: string;
  tv?: number;
  impersonatedBy?: string;
};

/** Resolve subject from new (`sub`) or legacy (`userId` / `id`) access JWT claims. */
export function resolveJwtSubject(decoded: DecodedAccessClaims): string | null {
  const candidates = [decoded.sub, decoded.userId, decoded.id];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** Access middleware accepts legacy tokens (no `type`) and explicit access / impersonation types. */
export function isAllowedAccessJwtType(type: unknown): boolean {
  if (type == null || type === "") return true;
  if (type === ACCESS_JWT_TYPE || type === IMPERSONATION_JWT_TYPE) return true;
  return false;
}

/**
 * Session-bound impersonation claims. Used by `signImpersonationToken`.
 */
export function buildImpersonationJwtPayload(params: {
  targetUserId: string;
  platformAdminUserId: string;
  authTokenVersion: number;
  refreshSessionId: string;
}): Record<string, unknown> {
  return {
    sub: params.targetUserId,
    role: "MANAGER",
    type: IMPERSONATION_JWT_TYPE,
    impersonatedBy: params.platformAdminUserId,
    tv: params.authTokenVersion,
    sid: params.refreshSessionId,
  };
}

/**
 * Impersonation JWTs always require `tv` + `sid`.
 * Production access JWTs also require them (no sid-less residual session).
 */
export function accessTokenMissingRequiredSessionBind(payload: {
  type?: unknown;
  tv?: unknown;
  sid?: unknown;
}): boolean {
  const sid = typeof payload.sid === "string" ? payload.sid.trim() : "";
  const hasTv = typeof payload.tv === "number";
  const hasSid = Boolean(sid);
  if (payload.type === IMPERSONATION_JWT_TYPE) {
    return !hasTv || !hasSid;
  }
  if (process.env.NODE_ENV === "production") {
    return !hasTv || !hasSid;
  }
  return false;
}
