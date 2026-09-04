import crypto from "crypto";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import type { User } from "@prisma/client";
import { prisma } from "../prisma.js";
import { signJwt, verifyJwt } from "../lib/jwtConfig.js";

export const MFA_LOGIN_PENDING_PURPOSE = "mfa_login_pending";
const MFA_CHALLENGE_TTL_MS = 10 * 60 * 1000;

export function isPlatformAdminAccount(
  user: Pick<User, "role" | "isPlatformAdmin">,
): boolean {
  return user.role === "SUPER_ADMIN" && user.isPlatformAdmin === true;
}

/** Platform admins always; other roles only when TOTP is actually enabled. */
export function needsMfaLoginChallenge(
  user: Pick<User, "role" | "isPlatformAdmin" | "twoFactorEnabled">,
): boolean {
  if (isPlatformAdminAccount(user)) return true;
  return user.twoFactorEnabled === true;
}

export function mfaSetupRequiredForLogin(
  user: Pick<User, "role" | "isPlatformAdmin" | "twoFactorEnabled">,
): boolean {
  return isPlatformAdminAccount(user) && user.twoFactorEnabled !== true;
}

export function signPendingMfaLoginToken(userId: string): string {
  return signJwt(
    {
      userId,
      purpose: MFA_LOGIN_PENDING_PURPOSE,
      /** Explicit non-access type so refresh/socket/middleware cannot treat this as a session JWT. */
      type: MFA_LOGIN_PENDING_PURPOSE,
      jti: crypto.randomUUID(),
    },
    "10m",
  );
}

export type PendingMfaParse =
  | { ok: true; userId: string; jti: string }
  | { ok: false; reason: "expired" | "invalid" };

export function parsePendingMfaLoginToken(token: string): PendingMfaParse {
  const raw = String(token ?? "").trim();
  if (!raw) return { ok: false, reason: "invalid" };
  try {
    const decoded = verifyJwt<{ userId?: string; purpose?: string; jti?: string }>(raw);
    if (decoded.purpose !== MFA_LOGIN_PENDING_PURPOSE) return { ok: false, reason: "invalid" };
    const userId = decoded.userId?.trim();
    const jti = decoded.jti?.trim();
    if (!userId || !jti) return { ok: false, reason: "invalid" };
    return { ok: true, userId, jti };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

export function userIdFromPendingMfaLoginToken(token: string): string | null {
  const parsed = parsePendingMfaLoginToken(token);
  return parsed.ok ? parsed.userId : null;
}

export function isPendingMfaLoginJwt(decoded: { purpose?: unknown; type?: unknown }): boolean {
  return decoded.purpose === MFA_LOGIN_PENDING_PURPOSE;
}

/** First successful consume wins across all API instances (unique jti row). */
export type MfaChallengeConsume = "consumed" | "already_used" | "unavailable";

export async function consumeMfaChallengeJti(jti: string): Promise<MfaChallengeConsume> {
  const id = jti.trim();
  if (!id || id.length > 64) return "already_used";
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);
  try {
    if (Math.random() < 0.02) {
      await prisma.$executeRaw`DELETE FROM "consumed_mfa_challenges" WHERE "expires_at" < CURRENT_TIMESTAMP`;
    }
    const inserted = await prisma.$queryRaw<Array<{ jti: string }>>`
      INSERT INTO "consumed_mfa_challenges" ("jti", "expires_at", "created_at")
      VALUES (${id}, ${expiresAt}, CURRENT_TIMESTAMP)
      ON CONFLICT ("jti") DO NOTHING
      RETURNING "jti"
    `;
    return inserted.length > 0 ? "consumed" : "already_used";
  } catch {
    return "unavailable";
  }
}

export function normalizeLoginTotp(code: unknown): string | null {
  const digits = String(code ?? "").replace(/\D/g, "");
  if (digits.length !== 6) return null;
  return digits;
}

const mfaLoginUserSelect = {
  id: true,
  email: true,
  role: true,
  isPlatformAdmin: true,
  isActive: true,
  emailVerified: true,
  twoFactorEnabled: true,
  twoFactorSecret: true,
  twoFactorTempSecret: true,
} as const;

export async function loadPlatformAdminForMfaLogin(userId: string) {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: mfaLoginUserSelect,
  });
  if (!row || !isPlatformAdminAccount(row) || row.isActive !== true || row.emailVerified !== true) {
    return null;
  }
  return row;
}

/** Completing a login TOTP challenge (admin setup or any role with 2FA enabled). */
export async function loadUserForMfaVerify(userId: string) {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: mfaLoginUserSelect,
  });
  if (!row || row.isActive !== true) return null;
  if (isPlatformAdminAccount(row)) {
    return row.emailVerified === true ? row : null;
  }
  if (row.twoFactorEnabled !== true) return null;
  if ((row.role === "MANAGER" || row.role === "EMPLOYEE") && row.emailVerified !== true) {
    return null;
  }
  return row;
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const token = normalizeLoginTotp(code);
  if (!token) return false;
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
    digits: 6,
    step: 30,
    algorithm: "sha1",
  });
}

export async function assertPlatformAdminMfaSessionAllowed(
  user: Pick<User, "role" | "isPlatformAdmin" | "twoFactorEnabled">,
): Promise<void> {
  if (!isPlatformAdminAccount(user)) return;
  if (user.twoFactorEnabled !== true) {
    throw new Error("MFA setup required for platform administrators");
  }
}
