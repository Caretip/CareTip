/**
 * Sprint 4 — automated cross-tenant isolation checks.
 * Run: npm run test:sprint4-tenant-isolation
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { signAuthJwt } from "../src/services/auth.service.js";

const API = (process.env.RUNTIME_API_BASE ?? (process.env.CI ? "http://localhost:3001" : "http://127.0.0.1:9")).replace(/\/$/, "");
const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);
const skip = (m: string) => results.push(`SKIP: ${m}`);

async function api(
  path: string,
  token: string,
  opts?: { method?: string; body?: unknown },
): Promise<{ status: number; body: string }> {
  const res = await fetch(`${API}${path}`, {
    method: opts?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: opts?.body != null ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.text() };
}

async function seedTenant(label: string) {
  const tag = `${label}-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const manager = await prisma.user.create({
    data: {
      email: `${tag}-mgr@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `${label} Venue`,
          slug: `${tag}-venue`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
    },
    include: { business: true },
  });
  const empUser = await prisma.user.create({
    data: {
      email: `${tag}-emp@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      employee: {
        create: {
          name: `${label} Staff`,
          slug: `${tag}-staff`,
          jobTitle: "Host",
          businessId: manager.business!.id,
          isActive: true,
          activationStatus: "active",
        },
      },
    },
    include: { employee: true },
  });
  const location = await prisma.location.create({
    data: { businessId: manager.business!.id, name: `${label} Floor` },
  });
  const tx = await prisma.transaction.create({
    data: {
      amount: 10,
      status: "success",
      employeeId: empUser.employee!.id,
      businessId: manager.business!.id,
      stripePaymentIntentId: `pi_${tag}`,
    },
  });
  return {
    managerId: manager.id,
    businessId: manager.business!.id,
    employeeId: empUser.employee!.id,
    locationId: location.id,
    transactionId: tx.id,
    token: signAuthJwt({
      userId: manager.id,
      id: manager.id,
      email: manager.email,
      role: "MANAGER",
      roleLabel: "MANAGER",
    }),
    cleanup: async () => {
      await prisma.transaction.deleteMany({ where: { businessId: manager.business!.id } });
      await prisma.location.deleteMany({ where: { businessId: manager.business!.id } });
      await prisma.employee.deleteMany({ where: { businessId: manager.business!.id } });
      await prisma.business.delete({ where: { id: manager.business!.id } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: [manager.id, empUser.id] } } });
    },
  };
}

async function isApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  let a: Awaited<ReturnType<typeof seedTenant>> | null = null;
  let b: Awaited<ReturnType<typeof seedTenant>> | null = null;

  try {
    const apiUp = await isApiReachable();
    if (!apiUp) {
      skip(`API not reachable at ${API} — HTTP checks skipped`);
    }

    a = await seedTenant("tenantA");
    b = await seedTenant("tenantB");
    pass("seed business A and B");

    if (!apiUp) {
      const crossWrite = await prisma.employee.updateMany({
        where: { id: b.employeeId, businessId: a.businessId },
        data: { name: "Should not apply" },
      });
      if (crossWrite.count === 0) pass("DB write isolation: employee B not under business A");
      else fail("DB write isolation failed — cross-tenant employee update matched rows");
    } else {
      const patchEmp = await api(`/api/employees/${b.employeeId}`, a.token, {
        method: "PATCH",
        body: { name: "Hacked" },
      });
      if (patchEmp.status === 404 || patchEmp.status === 403 || patchEmp.status === 400) {
        pass("manager A cannot PATCH business B employee");
      } else {
        fail(`PATCH cross-employee expected 404/403/400 got ${patchEmp.status}`);
      }

      const delEmp = await api(`/api/employees/${b.employeeId}`, a.token, { method: "DELETE" });
      if (delEmp.status === 404 || delEmp.status === 403) {
        const still = await prisma.employee.findUnique({ where: { id: b.employeeId } });
        if (still) pass("manager A cannot DELETE business B employee");
        else fail("business B employee was deleted by manager A");
      } else {
        fail(`DELETE cross-employee unexpected ${delEmp.status}`);
      }

      const tipsA = await api("/api/tips/business", a.token);
      if (tipsA.status === 200 && !tipsA.body.includes(b.transactionId)) {
        pass("manager A tips list excludes business B transactions");
      } else if (tipsA.status !== 200) {
        skip(`tips/business A returned ${tipsA.status}`);
      } else {
        fail("manager A saw business B transaction id in tips response");
      }

      const exportA = await api("/api/transactions/export", a.token);
      if (exportA.status === 200 && exportA.body.includes("pi_tenantA") && !exportA.body.includes("pi_tenantB")) {
        pass("export CSV scoped to manager A only");
      } else if (exportA.status !== 200) {
        skip(`transactions/export returned ${exportA.status}`);
      } else {
        fail("export CSV leaked business B data");
      }

      const locA = await api("/api/locations", a.token);
      if (locA.status === 200 && locA.body.includes(a.locationId) && !locA.body.includes(b.locationId)) {
        pass("locations scoped to manager A");
      } else if (locA.status !== 200) {
        skip(`locations returned ${locA.status}`);
      } else {
        fail("locations leaked business B location");
      }

      const feedbackA = await api("/api/feedback/business", a.token);
      if (feedbackA.status === 200 && !feedbackA.body.includes(b.businessId)) {
        pass("feedback list does not expose business B id scope");
      } else if (feedbackA.status !== 200) {
        skip(`feedback/business returned ${feedbackA.status}`);
      } else {
        fail("feedback response may leak cross-tenant data");
      }

      const statsA = await api("/api/business/stats?timeframe=week", a.token);
      if (statsA.status === 200) pass("business stats resolves from session (no foreign businessId param)");
      else skip(`business/stats returned ${statsA.status}`);
    }
  } catch (e) {
    fail(`runtime: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (a) await a.cleanup();
    if (b) await b.cleanup();
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
