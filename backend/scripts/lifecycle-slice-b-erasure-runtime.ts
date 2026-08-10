/**
 * GDPR lifecycle Slice B — safe employee erasure (F-01).
 * Run: npm run test:lifecycle-slice-b (from backend/)
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import * as employeeService from "../src/services/employee.service.js";
import { requestAccountErasure } from "../src/services/erasureRequest.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function main() {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const mgr = await prisma.user.create({
    data: {
      email: `slice-b-mgr-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: {
          name: "Slice B Biz",
          slug: `slice-b-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
    },
    include: { business: true },
  });
  const empUser = await prisma.user.create({
    data: {
      email: `slice-b-emp-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      isActive: true,
      employee: {
        create: {
          name: "Slice B Staff",
          jobTitle: "Bar",
          businessId: mgr.business!.id,
          isActive: true,
          activationStatus: "active",
        },
      },
    },
    include: { employee: true },
  });
  const empId = empUser.employee!.id;
  const bizId = mgr.business!.id;
  const tip = await prisma.transaction.create({
    data: {
      amount: 12.5,
      status: "success",
      employeeId: empId,
      businessId: bizId,
      stripePaymentIntentId: `pi_slice_b_${tag}`,
    },
  });

  try {
    // Manager blocked by SOLE_BUSINESS_OWNER
    const mgrResult = await requestAccountErasure(mgr.id);
    if (!mgrResult.ok && mgrResult.status.blockers.some((b) => b.code === "SOLE_BUSINESS_OWNER")) {
      pass("manager erasure blocked by SOLE_BUSINESS_OWNER");
    } else {
      fail("manager erasure should be blocked by SOLE_BUSINESS_OWNER");
    }
    const mgrStill = await prisma.user.findUnique({ where: { id: mgr.id } });
    if (mgrStill && mgrStill.isActive) pass("manager user row kept active when blocked");
    else fail("manager should remain active when erasure blocked");

    await employeeService.deleteEmployeeAccount(empUser.id);

    const empAfter = await prisma.employee.findUnique({ where: { id: empId } });
    const userAfter = await prisma.user.findUnique({ where: { id: empUser.id } });
    const tipAfter = await prisma.transaction.findUnique({ where: { id: tip.id } });

    if (userAfter) pass("employee User row retained (no hard delete)");
    else fail("employee User was hard-deleted");

    if (userAfter && userAfter.isActive === false) pass("employee User deactivated");
    else fail("employee User should be inactive");

    if (empAfter?.isDeleted === true) pass("employee membership soft-deleted");
    else fail("employee should be soft-deleted");

    if (tipAfter && Number(tipAfter.amount) === 12.5) pass("tip ledger preserved after self-erasure");
    else fail("tip ledger lost after self-erasure");

    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../src/services/employee.service.ts", import.meta.url), "utf8"),
    );
    if (/prisma\.user\.delete\s*\(/.test(src)) {
      fail("employee.service still contains prisma.user.delete");
    } else {
      pass("employee.service has no prisma.user.delete");
    }
  } catch (err) {
    fail(`run: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: { in: [mgr.id, empUser.id] } } });
    await prisma.transaction.deleteMany({ where: { businessId: bizId } });
    await prisma.employee.deleteMany({ where: { businessId: bizId } });
    await prisma.business.delete({ where: { id: bizId } }).catch(() => undefined);
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [mgr.id, empUser.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [mgr.id, empUser.id] } } });
    await prisma.$disconnect().catch(() => undefined);
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
