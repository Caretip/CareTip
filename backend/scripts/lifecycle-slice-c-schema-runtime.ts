/**
 * GDPR lifecycle Slice C — schema expand + dual-write (no FK contract).
 * Run: npm run test:lifecycle-slice-c (from backend/)
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { requestAccountErasure } from "../src/services/erasureRequest.service.js";
import { userMayAuthenticate } from "../src/services/accountAccess.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function main() {
  if (
    userMayAuthenticate({ isActive: true, accountStatus: "erasure_pending" })
  ) {
    fail("erasure_pending must not authenticate");
  } else {
    pass("erasure_pending must not authenticate");
  }

  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  let empUserId: string | null = null;
  let bizId: string | null = null;
  let mgrId: string | null = null;

  try {
    const mgr = await prisma.user.create({
      data: {
        email: `slice-c-mgr-${tag}@caretip-test.local`,
        passwordHash,
        role: "MANAGER",
        emailVerified: true,
        business: {
          create: {
            name: "Slice C Biz",
            slug: `slice-c-${tag}`,
            verificationStatus: "verified",
            subscriptionTier: "premium",
          },
        },
      },
      include: { business: true },
    });
    mgrId = mgr.id;
    bizId = mgr.business!.id;

    const empUser = await prisma.user.create({
      data: {
        email: `slice-c-emp-${tag}@caretip-test.local`,
        passwordHash,
        role: "EMPLOYEE",
        emailVerified: true,
        isActive: true,
        accountStatus: "active",
        employee: {
          create: {
            name: "Slice C Staff",
            jobTitle: "Bar",
            businessId: bizId,
            isActive: true,
            activationStatus: "active",
          },
        },
      },
    });
    empUserId = empUser.id;

    const result = await requestAccountErasure(empUserId);
    if (!result.ok) fail(`erasure failed: ${result.message}`);
    else pass("employee erasure ok");

    const after = await prisma.user.findUnique({
      where: { id: empUserId },
      select: { isActive: true, accountStatus: true, deletionRequestedAt: true },
    });
    if (after?.accountStatus === "erasure_pending" && after.isActive === false) {
      pass("dual-write accountStatus=erasure_pending + isActive=false");
    } else {
      fail(`unexpected status: ${JSON.stringify(after)}`);
    }
    if (after?.deletionRequestedAt) pass("deletionRequestedAt set");
    else fail("deletionRequestedAt missing");

    const jobCount = await prisma.dataLifecycleJob.count();
    if (jobCount >= 0) pass("data_lifecycle_jobs table readable");
    else fail("data_lifecycle_jobs missing");
  } catch (err) {
    fail(`run: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (empUserId) {
      await prisma.auditLog.deleteMany({ where: { userId: empUserId } });
      await prisma.refreshToken.deleteMany({ where: { userId: empUserId } });
    }
    if (bizId) {
      await prisma.employee.deleteMany({ where: { businessId: bizId } });
      await prisma.business.delete({ where: { id: bizId } }).catch(() => undefined);
    }
    if (mgrId || empUserId) {
      await prisma.user.deleteMany({
        where: { id: { in: [mgrId, empUserId].filter(Boolean) as string[] } },
      });
    }
    await prisma.$disconnect().catch(() => undefined);
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
