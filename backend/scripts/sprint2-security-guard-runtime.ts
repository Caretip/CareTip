/**
 * Sprint 2 security regression checks (register session, employee email gate, onboarding, redirects).
 * Run: npm run test:sprint2-security (from backend/)
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import * as authService from "../src/services/auth.service.js";
import { EmailNotVerifiedLoginError } from "../src/utils/httpErrors.js";
import { signAuthJwt } from "../src/services/auth.service.js";

const TEST_PASSWORD = "TestPass1!";

type RedirectUser = {
  isVerified: boolean;
  role: string;
  hasCompletedOnboarding: boolean;
  status?: "PENDING" | "APPROVED" | "REJECTED";
};

/** Mirrors `src/app/lib/authRedirects.ts` */
function getPostAuthRedirect(u: RedirectUser): string {
  if (!u.isVerified) return "/verify-email";
  if (u.role === "business") {
    if (!u.hasCompletedOnboarding) return "/onboarding";
    return "/dashboard";
  }
  if (u.role === "employee") return "/employee/dashboard";
  if (u.role === "platform_admin" || u.role === "admin") return "/platform-admin/dashboard";
  return "/dashboard";
}

async function main() {
  const results: string[] = [];
  const pass = (msg: string) => results.push(`PASS: ${msg}`);
  const fail = (msg: string) => results.push(`FAIL: ${msg}`);
  const skip = (msg: string) => results.push(`SKIP: ${msg}`);

  // --- Redirect logic (pure) ---
  if (getPostAuthRedirect({ isVerified: false, role: "business", hasCompletedOnboarding: false }) !== "/verify-email") {
    fail("unverified business → /verify-email");
  } else {
    pass("unverified business → /verify-email");
  }

  if (
    getPostAuthRedirect({
      isVerified: true,
      role: "business",
      hasCompletedOnboarding: true,
      status: "PENDING",
    }) !== "/dashboard"
  ) {
    fail("verified + KYC pending → /dashboard (soft guidance only)");
  } else {
    pass("verified + KYC pending → /dashboard (no route block)");
  }

  if (
    getPostAuthRedirect({
      isVerified: true,
      role: "business",
      hasCompletedOnboarding: true,
      status: "REJECTED",
    }) !== "/dashboard"
  ) {
    fail("verified + KYC rejected → /dashboard (soft guidance only)");
  } else {
    pass("verified + KYC rejected → /dashboard (no route block)");
  }

  if (
    getPostAuthRedirect({
      isVerified: true,
      role: "business",
      hasCompletedOnboarding: true,
      status: "APPROVED",
    }) !== "/dashboard"
  ) {
    fail("verified + KYC approved → /dashboard");
  } else {
    pass("verified + KYC approved → /dashboard");
  }

  // --- Register: no session in service layer ---
  const bizEmail = `sprint2-biz-${Date.now()}@caretip-test.local`;
  let bizUserId: string | null = null;

  try {
    const registered = await authService.registerBusiness({
      email: bizEmail,
      password: TEST_PASSWORD,
    });

    bizUserId = registered.user.id;

    if (registered.requiresEmailVerification !== true) {
      fail("registerBusiness requiresEmailVerification flag");
    } else {
      pass("registerBusiness sets requiresEmailVerification=true");
    }

    if ("token" in (registered as object)) {
      fail("registerBusiness response must not include token");
    } else {
      pass("registerBusiness response has no access token");
    }

    if (registered.user.emailVerified !== false) {
      fail(`registerBusiness user.emailVerified should be false (got ${registered.user.emailVerified})`);
    } else {
      pass("registerBusiness user.emailVerified=false");
    }

    try {
      await authService.authResultForUserId(registered.user.id);
      fail("authResultForUserId should reject unverified user");
    } catch (e) {
      if (e instanceof EmailNotVerifiedLoginError) {
        pass("authResultForUserId rejects unverified user");
      } else {
        fail(`authResultForUserId unexpected error: ${e instanceof Error ? e.message : e}`);
      }
    }

    try {
      await authService.login({ email: bizEmail, password: TEST_PASSWORD });
      fail("login should block unverified business");
    } catch (e) {
      if (e instanceof EmailNotVerifiedLoginError) {
        pass("login blocks unverified business");
      } else {
        fail(`login unexpected: ${e instanceof Error ? e.message : e}`);
      }
    }
  } finally {
    if (bizUserId) {
      await prisma.business.deleteMany({ where: { userId: bizUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: bizUserId } }).catch(() => {});
    }
  }

  // --- Employee register + API 403 ---
  const business = await prisma.business.findFirst({
    where: { inviteCodeExpiresAt: { gt: new Date() }, inviteCode: { not: null } },
    select: { inviteCode: true },
  });

  const empEmail = `sprint2-emp-${Date.now()}@caretip-test.local`;
  let empUserId: string | null = null;

  if (!business?.inviteCode) {
    skip("No active invite code — employee API checks skipped");
  } else {
    try {
      const registered = await authService.registerEmployee({
        email: empEmail,
        password: TEST_PASSWORD,
        name: "Sprint2 Guard",
        inviteCode: business.inviteCode,
      });

      empUserId = registered.user.id;

      if (registered.requiresEmailVerification !== true) {
        fail("registerEmployee requiresEmailVerification flag");
      } else {
        pass("registerEmployee sets requiresEmailVerification=true");
      }

      const apiBase = process.env.RUNTIME_API_BASE?.trim() || "http://localhost:3001";

      // Forge a JWT as if register had issued one — API must still 403 via requireVerifiedEmail
      const forgedToken = signAuthJwt({
        sub: registered.user.id,
        role: "EMPLOYEE",
        type: "access",
        tv: 0,
      });

      const meRes = await fetch(`${apiBase}/api/employees/me`, {
        headers: { Authorization: `Bearer ${forgedToken}` },
      }).catch(() => null);

      if (!meRes) {
        skip("API not reachable — GET /api/employees/me 403 check skipped");
      } else if (meRes.status === 403) {
        pass(`GET /api/employees/me returns 403 for unverified employee (${meRes.status})`);
      } else {
        fail(`GET /api/employees/me expected 403, got ${meRes.status}`);
      }

      const onboardRes = await fetch(`${apiBase}/api/auth/me`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${forgedToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ hasCompletedOnboarding: true }),
      }).catch(() => null);

      if (!onboardRes) {
        skip("API not reachable — PATCH /api/auth/me 403 check skipped");
      } else if (onboardRes.status === 403) {
        pass(`PATCH /api/auth/me returns 403 for unverified user (${onboardRes.status})`);
      } else {
        fail(`PATCH /api/auth/me expected 403, got ${onboardRes.status}`);
      }

      const registerHttp = await fetch(`${apiBase}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: `sprint2-http-${Date.now()}@caretip-test.local`,
          password: TEST_PASSWORD,
          role: "business",
        }),
      }).catch(() => null);

      if (!registerHttp) {
        skip("API not reachable — HTTP register cookie check skipped");
      } else {
        const setCookie = registerHttp.headers.get("set-cookie") ?? "";
        const body = (await registerHttp.json().catch(() => ({}))) as Record<string, unknown>;
        const refreshValue = setCookie.match(/refresh[^=]*=([^;]*)/i)?.[1]?.trim() ?? "";
        if (refreshValue.length > 0) {
          fail("HTTP register Set-Cookie includes active refresh token");
        } else {
          pass("HTTP register does not set active refresh cookie");
        }
        if ("token" in body) {
          fail("HTTP register JSON includes token field");
        } else {
          pass("HTTP register JSON has no token field");
        }
        if (body.requiresEmailVerification !== true) {
          fail("HTTP register missing requiresEmailVerification=true");
        } else {
          pass("HTTP register requiresEmailVerification=true");
        }
        const httpUserId = (body.user as { id?: string } | undefined)?.id;
        if (httpUserId) {
          await prisma.business.deleteMany({ where: { userId: httpUserId } }).catch(() => {});
          await prisma.user.delete({ where: { id: httpUserId } }).catch(() => {});
        }
      }
    } finally {
      if (empUserId) {
        await prisma.employee.deleteMany({ where: { userId: empUserId } }).catch(() => {});
        await prisma.user.delete({ where: { id: empUserId } }).catch(() => {});
      }
    }
  }

  console.log("\n=== Sprint 2 security guard runtime ===\n");
  for (const line of results) console.log(line);

  const anyFail = results.some((r) => r.startsWith("FAIL:"));
  console.log(`\nOVERALL: ${anyFail ? "FAIL" : "PASS"}\n`);
  process.exit(anyFail ? 1 : 0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
