import speakeasy from "speakeasy";
import type { User } from "@prisma/client";
import { prisma } from "../prisma.js";
import { signJwt, verifyJwt } from "../lib/jwtConfig.js";

const PENDING_MFA_PURPOSE = "mfa_login_pending";

export function isPlatformAdminAccount(
  user: Pick<User, "role" | "isPlatformAdmin">,
): boolean {
  return user.role === "SUPER_ADMIN" && user.isPlatformAdmin === true;
}

export function signPendingMfaLoginToken(userId: string): string {
  return signJwt({ userId, purpose: PENDING_MFA_PURPOSE }, "10m");
}

export function userIdFromPendingMfaLoginToken(token: string): string | null {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  try {
    const decoded = verifyJwt<{ userId?: string; purpose?: string }>(raw);
    if (decoded.purpose !== PENDING_MFA_PURPOSE) return null;
    const userId = decoded.userId?.trim();
    return userId || null;
  } catch {
    return null;
  }
}

export async function loadPlatformAdminForMfaLogin(userId: string) {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      isPlatformAdmin: true,
      isActive: true,
      emailVerified: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      twoFactorTempSecret: true,
    },
  });
  if (!row || !isPlatformAdminAccount(row) || row.isActive !== true || row.emailVerified !== true) {
    return null;
  }
  return row;
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const token = String(code ?? "").trim();
  if (!token) return false;
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
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
