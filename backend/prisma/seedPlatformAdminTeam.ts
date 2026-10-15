import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

export type PlatformAdminTeamMember = {
  email: string;
  displayName: string;
};

/**
 * Additional platform operators — same dashboard & data, separate logins and MFA.
 * DB role is SUPER_ADMIN + isPlatformAdmin (API label: platform_admin).
 */
export function getPlatformAdminTeamMembers(): PlatformAdminTeamMember[] {
  const raw = process.env.SEED_ADMIN_EMAILS?.trim();
  if (!raw) {
    throw new Error(
      "Set SEED_ADMIN_EMAILS (comma-separated platform admin emails) before seeding the admin team.",
    );
  }
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) {
    throw new Error("SEED_ADMIN_EMAILS must contain at least one email address.");
  }
  return emails.map((email) => ({
    email,
    displayName: email.split("@")[0] ?? email,
  }));
}

export function requireSeedAdminPassword(): string {
  const password = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      "Set SEED_ADMIN_PASSWORD before seeding platform admins. No default password is allowed.",
    );
  }
  if (password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters.");
  }
  return password;
}

export type SeedPlatformAdminTeamResult = {
  created: string[];
  updated: string[];
  passwordReset: string[];
  passwordPreserved: string[];
};

/**
 * Idempotent: upserts team admins by email. Never creates tenants or duplicated platform data.
 * Preserves existing password + MFA secrets unless `resetPasswords` is true.
 */
export async function seedPlatformAdminTeam(
  prisma: PrismaClient,
  options: { resetPasswords?: boolean } = {},
): Promise<SeedPlatformAdminTeamResult> {
  const resetPasswords = options.resetPasswords === true;
  const teamPassword = requireSeedAdminPassword();
  const members = getPlatformAdminTeamMembers();
  const result: SeedPlatformAdminTeamResult = {
    created: [],
    updated: [],
    passwordReset: [],
    passwordPreserved: [],
  };

  for (const member of members) {
    const email = member.email.toLowerCase();
    const existing = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
      },
    });

    const shouldSetPassword = !existing || resetPasswords;
    const passwordHash = shouldSetPassword
      ? await bcrypt.hash(teamPassword, 10)
      : undefined;

    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        passwordHash: passwordHash!,
        role: "SUPER_ADMIN",
        isPlatformAdmin: true,
        isActive: true,
        emailVerified: true,
        hasCompletedOnboarding: true,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorTempSecret: null,
      },
      update: {
        role: "SUPER_ADMIN",
        isPlatformAdmin: true,
        isActive: true,
        emailVerified: true,
        hasCompletedOnboarding: true,
        ...(passwordHash ? { passwordHash } : {}),
        // Never wipe MFA on re-seed — each admin keeps their own authenticator setup.
      },
    });

    await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });

    if (!existing) {
      result.created.push(email);
      result.passwordReset.push(email);
    } else {
      result.updated.push(email);
      if (passwordHash) {
        result.passwordReset.push(email);
      } else {
        result.passwordPreserved.push(email);
      }
    }
  }

  return result;
}

export async function listPlatformAdminAccounts(prisma: PrismaClient) {
  return prisma.user.findMany({
    where: { role: "SUPER_ADMIN", isPlatformAdmin: true },
    select: {
      email: true,
      isActive: true,
      twoFactorEnabled: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}
