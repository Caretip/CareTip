import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { login } from "../src/services/auth.service.js";
import {
  getPlatformAdminTeamMembers,
  requireSeedAdminPassword,
} from "../prisma/seedPlatformAdminTeam.js";

function buildAccounts(): Array<{
  email: string;
  role: "MANAGER" | "EMPLOYEE" | "SUPER_ADMIN";
  password: string;
}> {
  const demoPassword = process.env.SEED_PASSWORD?.trim();
  if (!demoPassword) {
    throw new Error("Set SEED_PASSWORD to verify demo accounts.");
  }
  const demoManager = process.env.SEED_DEMO_MANAGER_EMAIL?.trim().toLowerCase();
  const demoEmployee = process.env.SEED_DEMO_EMPLOYEE_EMAIL?.trim().toLowerCase();
  const platformAdmin = process.env.SEED_PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (!demoManager || !demoEmployee || !platformAdmin) {
    throw new Error(
      "Set SEED_DEMO_MANAGER_EMAIL, SEED_DEMO_EMPLOYEE_EMAIL, and SEED_PLATFORM_ADMIN_EMAIL.",
    );
  }
  const teamPassword = requireSeedAdminPassword();
  return [
    { email: demoManager, role: "MANAGER", password: demoPassword },
    { email: demoEmployee, role: "EMPLOYEE", password: demoPassword },
    { email: platformAdmin, role: "SUPER_ADMIN", password: demoPassword },
    ...getPlatformAdminTeamMembers().map((m) => ({
      email: m.email,
      role: "SUPER_ADMIN" as const,
      password: teamPassword,
    })),
  ];
}

async function main() {
  const ACCOUNTS = buildAccounts();
  const raw = process.env.DATABASE_URL ?? "";
  const ref = raw.match(/postgres\.([^:]+)@/)?.[1];
  const host = raw.match(/@([^:/]+)/)?.[1];
  console.log(JSON.stringify({ host, database: "postgres", projectRef: ref }));

  for (const a of ACCOUNTS) {
    const user = await prisma.user.findUnique({
      where: { email: a.email },
      include: { business: { select: { id: true } }, employee: { select: { id: true, businessId: true } } },
    });
    if (!user) {
      console.log(a.email, "MISSING");
      continue;
    }
    let auth = "skip";
    try {
      await login({ email: a.email, password: a.password });
      auth = "OK";
    } catch (e) {
      auth = e instanceof Error ? e.message : "fail";
    }
    console.log(
      JSON.stringify({
        email: a.email,
        userId: user.id,
        role: user.role,
        isPlatformAdmin: user.isPlatformAdmin,
        twoFactorEnabled: user.twoFactorEnabled,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        businessId: user.business?.id ?? null,
        employeeId: user.employee?.id ?? null,
        auth,
      }),
    );
  }
}

main().finally(() => prisma.$disconnect());
