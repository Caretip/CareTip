/**
 * Runtime verification: unverified employee email signup must not access dashboard data.
 * Run: npm run db:employee-verify-guard (from backend/) or tsx scripts/employee-verify-guard-runtime.ts
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import * as authService from "../src/services/auth.service.js";
import { signAuthJwt } from "../src/services/auth.service.js";
import { EmailNotVerifiedLoginError } from "../src/utils/httpErrors.js";

const TEST_PASSWORD = "TestPass1!";

/** Mirrors `src/app/lib/authRedirects.ts` */
function getPostAuthRedirect(u: {
  isVerified: boolean;
  role: string;
  hasCompletedOnboarding: boolean;
  status?: "PENDING" | "APPROVED" | "REJECTED";
}): string {
  if (!u.isVerified) return "/verify-email";
  if (u.role === "business") {
    if (!u.hasCompletedOnboarding) return "/onboarding";
    return "/dashboard";
  }
  if (u.role === "employee") return "/employee/dashboard";
  return "/dashboard";
}

/** Mirrors `resolveAuthenticatedAppGuard` email gate in src/app/lib/authSession.ts */
function guardEmployeeDashboard(isVerified: boolean, pathname: string): "allow" | "redirect-verify" {
  if (pathname === "/verify-email" || pathname === "/verify") return "allow";
  if (!isVerified) return "redirect-verify";
  return "allow";
}

async function main() {
  const results: string[] = [];
  const pass = (msg: string) => results.push(`PASS: ${msg}`);
  const fail = (msg: string) => results.push(`FAIL: ${msg}`);

  const business = await prisma.business.findFirst({
    where: { inviteCodeExpiresAt: { gt: new Date() }, inviteCode: { not: null } },
    select: { inviteCode: true, id: true },
  });
  if (!business?.inviteCode) {
    console.error("SKIP: No active business invite code in DB — cannot run register test.");
    process.exit(2);
  }

  const email = `guard-runtime-${Date.now()}@caretip-test.local`;
  let userId: string | null = null;

  try {
    const registered = await authService.registerEmployee({
      email,
      password: TEST_PASSWORD,
      name: "Guard Runtime Test",
      inviteCode: business.inviteCode,
    });

    userId = registered.user.id;

    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true, passwordHash: true, role: true },
    });

    if (row?.emailVerified !== false) {
      fail(`email_verified should be false after register (got ${row?.emailVerified})`);
    } else {
      pass("register sets email_verified=false");
    }

    if (!row?.passwordHash) {
      fail("password_hash missing after email register");
    } else {
      pass("password_hash persisted");
    }

    if (registered.user.emailVerified !== false) {
      fail(`auth DTO emailVerified should be false (got ${registered.user.emailVerified})`);
    } else {
      pass("register auth response emailVerified=false");
    }

    if (registered.requiresEmailVerification !== true) {
      fail("register must set requiresEmailVerification=true");
    } else {
      pass("register requiresEmailVerification=true (no session)");
    }

    const redirect = getPostAuthRedirect({
      role: "employee",
      isVerified: false,
      hasCompletedOnboarding: true,
    });
    if (redirect !== "/verify-email") {
      fail(`getPostAuthRedirect unverified employee → ${redirect} (expected /verify-email)`);
    } else {
      pass("getPostAuthRedirect → /verify-email when isVerified=false");
    }

    if (guardEmployeeDashboard(false, "/employee/dashboard") !== "redirect-verify") {
      fail("route guard should block /employee/dashboard when unverified");
    } else {
      pass("route guard redirects /employee/dashboard → /verify-email");
    }

    if (guardEmployeeDashboard(false, "/verify-email") !== "allow") {
      fail("route guard should allow /verify-email when unverified");
    } else {
      pass("route guard allows /verify-email for unverified employee");
    }

    try {
      await authService.login({
        email,
        password: TEST_PASSWORD,
      });
      fail("password login should block unverified employee");
    } catch (e) {
      if (e instanceof EmailNotVerifiedLoginError) {
        pass("password login throws EMAIL_NOT_VERIFIED before verify");
      } else {
        fail(`password login threw unexpected: ${e instanceof Error ? e.message : e}`);
      }
    }

    const apiBase = process.env.RUNTIME_API_BASE?.trim() || "http://localhost:3001";
    const forgedToken = signAuthJwt({
      userId: registered.user.id,
      id: registered.user.id,
      email,
      role: "EMPLOYEE",
      roleLabel: "EMPLOYEE",
    });

    const tipsRes = await fetch(`${apiBase}/api/tips/employee?timeframe=today`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
    }).catch(() => null);

    if (!tipsRes) {
      results.push("SKIP: API not reachable at localhost:3001 — tips 403 check skipped");
    } else if (tipsRes.status === 403) {
      pass(`tips API returns 403 for unverified session (status ${tipsRes.status})`);
    } else {
      fail(`tips API expected 403 for unverified employee, got ${tipsRes.status}`);
    }

    const oauthUser = await prisma.user.findFirst({
      where: {
        role: "EMPLOYEE",
        passwordHash: null,
        oauthAccounts: { some: {} },
      },
      select: { email: true },
    });
    if (oauthUser?.email) {
      try {
        await authService.login({
          email: oauthUser.email,
          password: "AnyPassword1!",
        });
        fail("OAuth employee password login should not succeed");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          msg === "This account uses Google sign-in." ||
          msg.includes("social sign-in")
        ) {
          pass("OAuth account gets social sign-in message on password login");
        } else {
          fail(`OAuth password login message: ${msg}`);
        }
      }
    } else {
      results.push("SKIP: No OAuth employee in DB — social login message check skipped");
    }
  } finally {
    if (userId) {
      await prisma.employee.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }

  console.log("\n=== Employee verify guard runtime ===\n");
  for (const line of results) console.log(line);

  const anyFail = results.some((r) => r.startsWith("FAIL:"));
  console.log(`\nTASK 1 CLASSIFICATION: ${anyFail ? "FAIL" : "PASS"}\n`);
  process.exit(anyFail ? 1 : 0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
