/**
 * GDPR lifecycle Slice G — Legal Hold APIs (platform-admin control plane).
 * Run: npm run test:lifecycle-slice-g (from backend/)
 *
 * Isolated fixtures only. Does not enable production destruction flags.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  LegalHoldError,
  assertAuditMetadataHasNoPii,
  clearBusinessLegalHold,
  clearUserLegalHold,
  getUserLegalHold,
  setBusinessLegalHold,
  setUserLegalHold,
} from "../src/services/legalHold.service.js";
import { terminateUserSessions } from "../src/services/accountAccess.service.js";
import { transferBusinessOwnership } from "../src/services/businessOwnership.service.js";
import { anonymizeUser } from "../src/services/anonymization.service.js";
import { isCategoryHeld } from "../src/services/retentionPolicy.helpers.js";
import { issueRefreshToken } from "../src/services/refreshToken.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function main() {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);

  const admin = await prisma.user.create({
    data: {
      email: `slice-g-admin-${tag}@caretip-test.local`,
      passwordHash,
      role: "SUPER_ADMIN",
      isPlatformAdmin: true,
      emailVerified: true,
      accountStatus: "active",
      isActive: true,
    },
  });

  const manager = await prisma.user.create({
    data: {
      email: `slice-g-mgr-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      accountStatus: "active",
      business: {
        create: {
          name: "Slice G Biz",
          slug: `slice-g-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
    },
    include: { business: true },
  });
  const businessId = manager.business!.id;

  const employeeUser = await prisma.user.create({
    data: {
      email: `slice-g-emp-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      accountStatus: "active",
      employee: {
        create: {
          name: "Slice G Staff",
          jobTitle: "Server",
          businessId,
          isActive: true,
        },
      },
    },
  });

  const successor = await prisma.user.create({
    data: {
      email: `slice-g-succ-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      accountStatus: "active",
    },
  });

  const otherBizOwner = await prisma.user.create({
    data: {
      email: `slice-g-other-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      accountStatus: "active",
      business: {
        create: {
          name: "Other Biz",
          slug: `slice-g-other-${tag}`,
          verificationStatus: "verified",
        },
      },
    },
    include: { business: true },
  });

  const savedAnon = process.env.DATA_LIFECYCLE_V1;
  const savedExec = process.env.DATA_LIFECYCLE_ANONYMIZATION_EXECUTE;
  const savedPepper = process.env.DATA_LIFECYCLE_EMAIL_PEPPER;

  try {
    // --- Unauthorized ---
    try {
      await setUserLegalHold({
        userId: employeeUser.id,
        actorUserId: manager.id,
        reason: "mgr attempt",
        categories: ["kyc"],
      });
      fail("manager must not set user legal hold");
    } catch (e) {
      if (e instanceof LegalHoldError && e.code === "FORBIDDEN") {
        pass("unauthorized manager cannot set user legal hold");
      } else fail(`unexpected manager hold error: ${e}`);
    }

    try {
      await setBusinessLegalHold({
        businessId,
        actorUserId: employeeUser.id,
        reason: "emp attempt",
        categories: ["financial"],
      });
      fail("employee must not set business legal hold");
    } catch (e) {
      if (e instanceof LegalHoldError && e.code === "FORBIDDEN") {
        pass("unauthorized employee cannot set business legal hold");
      } else fail(`unexpected employee hold error: ${e}`);
    }

    // --- Set / get / clear user hold ---
    const setUser = await setUserLegalHold({
      userId: employeeUser.id,
      actorUserId: admin.id,
      reason: "dispute investigation ref-CASE",
      categories: ["profile", "financial"],
    });
    if (
      setUser.legalHold === true &&
      setUser.legalHoldCategories.includes("profile") &&
      setUser.legalHoldCategories.includes("financial") &&
      setUser.legalHoldSetByUserId === admin.id
    ) {
      pass("set user legal hold with categories + setBy");
    } else fail(`set user hold unexpected: ${JSON.stringify(setUser)}`);

    const got = await getUserLegalHold(employeeUser.id, admin.id);
    if (got.legalHold && got.legalHoldReason?.includes("dispute")) {
      pass("retrieve user legal hold state");
    } else fail("get user legal hold failed");

    const setAudit = await prisma.auditLog.findFirst({
      where: { action: "lifecycle.legal_hold.user.set", userId: admin.id },
      orderBy: { createdAt: "desc" },
    });
    if (setAudit && assertAuditMetadataHasNoPii(setAudit.metadata)) {
      const meta = JSON.parse(setAudit.metadata!);
      if (
        meta.actorId === admin.id &&
        meta.resourceId === employeeUser.id &&
        Array.isArray(meta.categories) &&
        !("email" in meta) &&
        !("name" in meta)
      ) {
        pass("structured audit for user set has ids, no email/name/phone");
      } else fail(`audit metadata shape unexpected: ${setAudit.metadata}`);
    } else fail("missing or PII-tainted user set audit");

    // --- Category isolation ---
    const heldUser = await prisma.user.findUnique({
      where: { id: employeeUser.id },
      select: { legalHold: true, legalHoldCategories: true },
    });
    if (isCategoryHeld(heldUser!, "financial") && !isCategoryHeld(heldUser!, "analytics")) {
      pass("category-specific hold: financial held, analytics not");
    } else fail("category isolation broken for user hold");

    // --- Session revoke still allowed under hold ---
    await issueRefreshToken(employeeUser.id);
    await terminateUserSessions(employeeUser.id, { disconnectSockets: false });
    const refreshLeft = await prisma.refreshToken.count({
      where: { userId: employeeUser.id, revokedAt: null },
    });
    if (refreshLeft === 0) {
      pass("authentication/session revocation remains allowed under hold");
    } else fail("refresh tokens should be revoked under hold");

    // --- Destructive anonymize blocked for held profile ---
    process.env.DATA_LIFECYCLE_V1 = "true";
    process.env.DATA_LIFECYCLE_ANONYMIZATION_EXECUTE = "true";
    process.env.DATA_LIFECYCLE_EMAIL_PEPPER = "slice-g-test-pepper-32chars-min!!";
    try {
      await anonymizeUser(employeeUser.id, {
        platformAuthorized: true,
        bypassExecutionGate: true,
      });
      fail("anonymize must be blocked while profile held");
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "LEGAL_HOLD_CATEGORY") {
        pass("destructive anonymize blocked for held profile category");
      } else fail(`unexpected anonymize error under hold: ${e}`);
    }

    // Unrelated category eligibility: analytics not held on user → helper says not held
    if (!isCategoryHeld(heldUser!, "analytics") && !isCategoryHeld(heldUser!, "notify")) {
      pass("unrelated categories remain eligible (not held)");
    } else fail("unrelated categories incorrectly held");

    const clearedUser = await clearUserLegalHold({
      userId: employeeUser.id,
      actorUserId: admin.id,
      releaseReason: "matter closed",
    });
    if (!clearedUser.legalHold && clearedUser.legalHoldCategories.length === 0) {
      pass("clear user legal hold");
    } else fail("clear user hold failed");

    const clearAudit = await prisma.auditLog.findFirst({
      where: { action: "lifecycle.legal_hold.user.clear", userId: admin.id },
      orderBy: { createdAt: "desc" },
    });
    if (clearAudit && assertAuditMetadataHasNoPii(clearAudit.metadata)) {
      pass("structured audit for user clear has no PII keys");
    } else fail("user clear audit missing/PII");

    // --- Business hold + ownership transfer blocked ---
    const setBiz = await setBusinessLegalHold({
      businessId,
      actorUserId: admin.id,
      reason: "regulator request",
      categories: ["kyc", "financial"],
    });
    if (setBiz.legalHold && setBiz.legalHoldCategories.includes("kyc")) {
      pass("set business legal hold");
    } else fail("set business hold failed");

    try {
      await transferBusinessOwnership({
        businessId,
        successorUserId: successor.id,
        actorUserId: manager.id,
        source: "owner",
      });
      fail("ownership transfer must be blocked under business legal hold");
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "LEGAL_HOLD") {
        pass("ownership transfer blocked while business legal hold set");
      } else fail(`unexpected transfer error: ${e}`);
    }

    const bizRow = await prisma.business.findUnique({
      where: { id: businessId },
      select: { legalHold: true, legalHoldCategories: true },
    });
    if (isCategoryHeld(bizRow!, "kyc") && !isCategoryHeld(bizRow!, "analytics")) {
      pass("business category hold: kyc held, analytics eligible");
    } else fail("business category isolation failed");

    const clearedBiz = await clearBusinessLegalHold({
      businessId,
      actorUserId: admin.id,
      releaseReason: "matter closed",
    });
    if (!clearedBiz.legalHold) pass("clear business legal hold");
    else fail("clear business hold failed");

    // After clear, transfer should succeed
    try {
      await transferBusinessOwnership({
        businessId,
        successorUserId: successor.id,
        actorUserId: admin.id,
        source: "platform",
      });
      const bizAfter = await prisma.business.findUnique({
        where: { id: businessId },
        select: { userId: true },
      });
      if (bizAfter?.userId === successor.id) pass("ownership transfer works after hold clear");
      else fail("ownership transfer after clear did not reassign");
    } catch (e) {
      fail(`transfer after clear failed: ${e}`);
    }

    // --- Cross-tenant: admin targets by verified server id; forged nonexistent id fails ---
    try {
      await setUserLegalHold({
        userId: "nonexistent-user-id-slice-g",
        actorUserId: admin.id,
        reason: "x",
        categories: ["audit"],
      });
      fail("nonexistent user hold must 404");
    } catch (e) {
      if (e instanceof LegalHoldError && e.code === "NOT_FOUND") {
        pass("cross-tenant/nonexistent target rejected with NOT_FOUND");
      } else fail(`unexpected nonexistent hold error: ${e}`);
    }

    // Manager cannot manipulate another business via service (forbidden actor)
    try {
      await setBusinessLegalHold({
        businessId: otherBizOwner.business!.id,
        actorUserId: manager.id,
        reason: "cross",
        categories: ["audit"],
      });
      fail("manager must not set hold on another business");
    } catch (e) {
      if (e instanceof LegalHoldError && e.code === "FORBIDDEN") {
        pass("non-admin cannot manipulate cross-tenant business hold");
      } else fail(`unexpected cross-tenant hold error: ${e}`);
    }

    // --- erasure_continue wake on clear while erasure_pending ---
    await prisma.user.update({
      where: { id: employeeUser.id },
      data: {
        accountStatus: "erasure_pending",
        isActive: false,
        deletionRequestedAt: new Date(),
        legalHold: true,
        legalHoldCategories: ["profile"],
        legalHoldReason: "pending erase hold",
        legalHoldSetAt: new Date(),
        legalHoldSetByUserId: admin.id,
      },
    });
    await prisma.dataLifecycleJob.create({
      data: {
        type: "anonymize_user",
        subjectType: "user",
        subjectId: employeeUser.id,
        status: "skipped_legal_hold",
        payload: {},
      },
    });
    await clearUserLegalHold({
      userId: employeeUser.id,
      actorUserId: admin.id,
      releaseReason: "matter closed",
    });
    const woken = await prisma.dataLifecycleJob.findFirst({
      where: {
        type: "anonymize_user",
        subjectId: employeeUser.id,
        status: "pending",
      },
    });
    const cont = await prisma.dataLifecycleJob.findFirst({
      where: {
        type: "erasure_continue",
        subjectId: employeeUser.id,
        status: "pending",
      },
    });
    if (woken && cont) pass("hold clear wakes skipped jobs and enqueues erasure_continue");
    else fail(`wake after clear failed woken=${!!woken} cont=${!!cont}`);

    // Hold must not restore access
    const afterClear = await prisma.user.findUnique({
      where: { id: employeeUser.id },
      select: { accountStatus: true, isActive: true },
    });
    if (afterClear?.accountStatus === "erasure_pending" && afterClear.isActive === false) {
      pass("clearing legal hold does not restore account access");
    } else fail("clear hold incorrectly restored access");

    // Validation: empty categories rejected
    try {
      await setUserLegalHold({
        userId: successor.id,
        actorUserId: admin.id,
        reason: "empty cats",
        categories: [],
      });
      fail("empty categories must be rejected");
    } catch (e) {
      if (e instanceof LegalHoldError && e.code === "VALIDATION") {
        pass("empty categories rejected (Amendment A2)");
      } else fail(`empty categories error: ${e}`);
    }
  } finally {
    if (savedAnon === undefined) delete process.env.DATA_LIFECYCLE_V1;
    else process.env.DATA_LIFECYCLE_V1 = savedAnon;
    if (savedExec === undefined) delete process.env.DATA_LIFECYCLE_ANONYMIZATION_EXECUTE;
    else process.env.DATA_LIFECYCLE_ANONYMIZATION_EXECUTE = savedExec;
    if (savedPepper === undefined) delete process.env.DATA_LIFECYCLE_EMAIL_PEPPER;
    else process.env.DATA_LIFECYCLE_EMAIL_PEPPER = savedPepper;

    await prisma.dataLifecycleJob.deleteMany({
      where: {
        subjectId: {
          in: [employeeUser.id, businessId, manager.id, successor.id, otherBizOwner.business!.id],
        },
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: admin.id },
          { userId: employeeUser.id },
          { userId: manager.id },
          { userId: successor.id },
        ],
      },
    });
    await prisma.employee.deleteMany({ where: { businessId: { in: [businessId, otherBizOwner.business!.id] } } });
    await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBizOwner.business!.id] } } });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: [employeeUser.id, manager.id, admin.id, successor.id, otherBizOwner.id] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [employeeUser.id, manager.id, admin.id, successor.id, otherBizOwner.id] },
      },
    });
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  if (failed.length) {
    console.error(`\n${failed.length} failure(s)`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} Slice G checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
