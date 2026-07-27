import crypto from "crypto";
import { prisma } from "../prisma.js";
import { bumpAuthTokenVersion } from "./authTokenVersion.service.js";

const COOKIE_NAME = "caretip_refresh";
/** Readable by native clients that cannot access HttpOnly Set-Cookie (same opaque token). */
export const CARETIP_REFRESH_HEADER = "X-CareTip-Refresh";

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Default 7 days; override with `REFRESH_TOKEN_EXPIRES_DAYS` (1–365). */
export function refreshTokenTtlDays(): number {
  const raw = process.env.REFRESH_TOKEN_EXPIRES_DAYS?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0 && n <= 365) return Math.floor(n);
  return 7;
}

function nowPlusDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function defaultRefreshCookieMaxAgeMs(): number {
  return refreshTokenTtlDays() * 24 * 60 * 60 * 1000;
}

/** Align `Set-Cookie` max-age with DB expiry (floor at 60s). */
export function refreshCookieMaxAgeMs(expiresAt: Date): number {
  return Math.max(60_000, expiresAt.getTime() - Date.now());
}

export function refreshCookieName(): string {
  return COOKIE_NAME;
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  for (const p of parts) {
    const [k, ...rest] = p.trim().split("=");
    if (!k) continue;
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setRefreshCookie(
  res: {
    cookie: (name: string, value: string, opts: Record<string, unknown>) => void;
    setHeader?: (name: string, value: string) => void;
  },
  value: string,
  opts?: { maxAgeMs?: number }
): void {
  const isProd = process.env.NODE_ENV === "production";
  const maxAge = typeof opts?.maxAgeMs === "number" ? opts.maxAgeMs : defaultRefreshCookieMaxAgeMs();
  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge,
  });
  // Expo / React Native cannot reliably read Set-Cookie; mirror the same refresh token.
  res.setHeader?.(CARETIP_REFRESH_HEADER, value);
}

export function clearRefreshCookie(
  res: {
    cookie: (name: string, value: string, opts: Record<string, unknown>) => void;
    setHeader?: (name: string, value: string) => void;
  },
): void {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, "", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
  res.setHeader?.(CARETIP_REFRESH_HEADER, "");
}

export async function issueRefreshToken(
  userId: string,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(48).toString("base64url");
  const tokenHash = sha256Hex(token);
  const expiresAt = nowPlusDays(refreshTokenTtlDays());
  const row = await prisma.refreshToken.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
      revokedAt: null,
      replacedByTokenId: null,
    },
    select: { id: true },
  });
  return { id: row.id, token, expiresAt };
}

/** Revoke all active refresh sessions for a user (e.g. reused / stolen refresh token). */
export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await bumpAuthTokenVersion(userId);
}

/**
 * Rotates a refresh token inside a transaction (race-safe).
 * Reuse of a revoked refresh token revokes all refresh sessions for that user.
 */
export async function rotateRefreshToken(
  token: string
): Promise<{ userId: string; newId: string; newToken: string; newExpiresAt: Date } | null> {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  const tokenHash = sha256Hex(raw);

  try {
    // Avoid interactive transactions (Prisma $transaction callback) because with
    // Supabase transaction pooler + connection_limit=1 they can intermittently fail
    // to start under dashboard load (P2028). This stays race-resistant via a
    // conditional update; worst case is an extra created token that we immediately revoke.
    const existing = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true, replacedByTokenId: true },
    });
    if (!existing) return null;

    if (existing.revokedAt) {
      // If the token was explicitly revoked (e.g. via logout), do not revoke other devices' sessions.
      // If the token was revoked due to rotation/reuse, `replacedByTokenId` is set and we treat it as reuse.
      if (existing.replacedByTokenId == null) return null;
      await prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return null;
    }
    if (existing.expiresAt.getTime() <= Date.now()) return null;

    const newPlain = crypto.randomBytes(48).toString("base64url");
    const newHash = sha256Hex(newPlain);
    const newExpiresAt = nowPlusDays(refreshTokenTtlDays());

    const created = await prisma.refreshToken.create({
      data: {
        tokenHash: newHash,
        userId: existing.userId,
        expiresAt: newExpiresAt,
        revokedAt: null,
        replacedByTokenId: null,
      },
      select: { id: true },
    });

    const updated = await prisma.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedByTokenId: created.id },
    });
    if (updated.count !== 1) {
      await prisma.refreshToken.update({
        where: { id: created.id },
        data: { revokedAt: new Date() },
      });
      return null;
    }

    return { userId: existing.userId, newId: created.id, newToken: newPlain, newExpiresAt };
  } catch (e) {
    console.warn("[refreshToken.rotate]", e);
    return null;
  }
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = sha256Hex(String(token ?? "").trim());
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revokes a refresh session and returns the owning user id in one round-trip when possible.
 * Used by logout so push-token cleanup can run after the HTTP response is sent.
 */
export async function revokeRefreshTokenAndGetUserId(token: string): Promise<string | null> {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  const tokenHash = sha256Hex(raw);
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { userId: true, revokedAt: true },
  });
  if (!row) return null;
  if (!row.revokedAt) {
    await prisma.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }
  return row.userId;
}

/** Resolve user id for logout when only the raw refresh cookie value is available. */
export async function userIdForRefreshToken(token: string): Promise<string | null> {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  const tokenHash = sha256Hex(raw);
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { userId: true },
  });
  return row?.userId ?? null;
}
