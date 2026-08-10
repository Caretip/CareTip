/**
 * GDPR lifecycle Slice D — FK contract + null-safe financial survival.
 * Covers T-F01-a/b/c, T-F02-a/b/c, T-F03-a/b, T-F10-a.
 * Run: npm run test:lifecycle-slice-d (from backend/)
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import * as employeeService from "../src/services/employee.service.js";
import { deleteBusinessCascadeUsers } from "../src/services/business.service.js";
import { softDeleteBusinessForAdmin } from "../src/services/businessOperationalLifecycle.service.js";
import { writeAuditLog } from "../src/services/audit.service.js";
import { listAuditLogsForAdmin } from "../src/services/platform.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function main() {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);

  const mgr = await prisma.user.create({
    data: {
      email: `slice-d-mgr-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: {
          name: "Slice D Biz",
          slug: `slice-d-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
    },
    include: { business: true },
  });
  const bizId = mgr.business!.id;

  const empUser = await prisma.user.create({
    data: {
      email: `slice-d-emp-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      isActive: true,
      accountStatus: "active",
      employee: {
        create: {
          name: "Slice D Staff",
          jobTitle: "Bar",
          businessId: bizId,
          isActive: true,
          activationStatus: "active",
        },
      },
    },
    include: { employee: true },
  });
  const empId = empUser.employee!.id;

  const tipIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const tip = await prisma.transaction.create({
      data: {
        amount: 10 + i,
        status: "success",
        employeeId: empId,
        businessId: bizId,
        stripePaymentIntentId: `pi_slice_d_${tag}_${i}`,
      },
    });
    tipIds.push(tip.id);
  }

  const refund = await prisma.tipRefund.create({
    data: {
      businessId: bizId,
      tipId: tipIds[0]!,
      kind: "refund",
      status: "succeeded",
      amountEur: 10,
      occurredAt: new Date(),
      stripeRefundId: `re_slice_d_${tag}`,
    },
  });

  await writeAuditLog({
    userId: empUser.id,
    action: "slice_d.test_audit",
    metadata: JSON.stringify({ actorId: empUser.id, resourceType: "user", resourceId: empUser.id }),
  });

  try {
    const tipCountBefore = await prisma.transaction.count({ where: { businessId: bizId } });
    if (tipCountBefore !== 10) fail(`setup tip count ${tipCountBefore}`);
    else pass("setup: 10 tips");

    // T-F01-a/b — employee self-erasure (safe path)
    await employeeService.deleteEmployeeAccount(empUser.id);
    const tipCountAfterErasure = await prisma.transaction.count({ where: { businessId: bizId } });
    if (tipCountAfterErasure === 10) pass("T-F01-a tip count unchanged after employee erasure");
    else fail(`T-F01-a tip count ${tipCountAfterErasure}`);

    const userStill = await prisma.user.findUnique({ where: { id: empUser.id } });
    if (userStill) pass("T-F01-b User row retained (no hard delete)");
    else fail("T-F01-b User was hard-deleted");

    // Simulate post-anonymization detach (Slice D FK contract)
    await prisma.transaction.updateMany({
      where: { employeeId: empId },
      data: { employeeId: null },
    });
    await prisma.employee.update({
      where: { id: empId },
      data: { userId: null },
    });

    const detached = await prisma.transaction.findMany({
      where: { id: { in: tipIds } },
      select: { id: true, amount: true, status: true, businessId: true, employeeId: true, stripePaymentIntentId: true },
    });
    if (
      detached.length === 10 &&
      detached.every(
        (t) =>
          t.employeeId === null &&
          t.businessId === bizId &&
          t.status === "success" &&
          t.stripePaymentIntentId,
      )
    ) {
      pass("T-F01-c tips survive with null employeeId; business/amount/PI intact");
    } else {
      fail("T-F01-c detachment invariants failed");
    }

    const amountsOk = detached.every((t, i) => Number(t.amount) === 10 + i);
    if (amountsOk) pass("financial amounts unchanged after detach");
    else fail("financial amounts changed");

    // T-F03 — delete user; audit survives with null userId
    await prisma.user.delete({ where: { id: empUser.id } });
    const audit = await prisma.auditLog.findFirst({
      where: { action: "slice_d.test_audit" },
    });
    if (audit && audit.userId === null) pass("T-F03-a AuditLog.userId null after user delete");
    else fail(`T-F03-a audit userId=${audit?.userId}`);

    await writeAuditLog({
      userId: null,
      action: "slice_d.null_actor",
      metadata: JSON.stringify({ resourceType: "system", resourceId: "slice-d" }),
    });
    const nullActor = await prisma.auditLog.findFirst({ where: { action: "slice_d.null_actor" } });
    if (nullActor && nullActor.userId === null) pass("T-F03-b audit write with null actor");
    else fail("T-F03-b null actor audit failed");

    const adminList = await listAuditLogsForAdmin({ take: 5, skip: 0 });
    if (adminList.items.every((i) => i.userEmail === null || typeof i.userEmail === "string")) {
      pass("audit admin list null-safe for userEmail");
    } else fail("audit admin list not null-safe");

    // T-F10 — refund survives tip detach (SetNull on tip delete path)
    const refundBefore = await prisma.tipRefund.findUnique({ where: { id: refund.id } });
    await prisma.transaction.delete({ where: { id: tipIds[0]! } });
    const refundAfter = await prisma.tipRefund.findUnique({ where: { id: refund.id } });
    if (refundAfter && refundAfter.tipId === null && Number(refundAfter.amountEur) === 10) {
      pass("T-F10-a TipRefund survives tip delete with tipId null");
    } else {
      fail(`T-F10-a refund after tip delete: ${JSON.stringify(refundAfter)}`);
    }
    // restore tip count expectation: 9 tips left
    tipIds.shift();

    // T-F02-a — cannot delete owner while Business exists
    let ownerBlocked = false;
    try {
      await prisma.user.delete({ where: { id: mgr.id } });
    } catch {
      ownerBlocked = true;
    }
    if (ownerBlocked) pass("T-F02-a owner User delete Restricted while Business exists");
    else fail("T-F02-a owner User delete should fail (Restrict)");

    // T-F02-b — hard business delete refused with financial history
    let hardBlocked = false;
    try {
      await deleteBusinessCascadeUsers(bizId);
    } catch (e) {
      hardBlocked = e instanceof Error && /financial history/i.test(e.message);
    }
    if (hardBlocked) pass("T-F02-b hard-delete blocked when tips/refunds exist");
    else fail("T-F02-b hard-delete should refuse financial history");

    const tipsStill = await prisma.transaction.count({ where: { businessId: bizId } });
    const refundsStill = await prisma.tipRefund.count({ where: { businessId: bizId } });
    if (tipsStill === 9 && refundsStill === 1) pass("ledger intact after refused hard-delete");
    else fail(`ledger unexpected tips=${tipsStill} refunds=${refundsStill}`);

    // T-F02-c soft-close — use a second empty business for soft-close eligibility,
    // and verify tips/refunds on primary remain when we soft-close is not available.
    // Soft-close on biz with tips is ineligible; verify assess + soft-close on empty biz.
    const emptyMgr = await prisma.user.create({
      data: {
        email: `slice-d-empty-${tag}@caretip-test.local`,
        passwordHash,
        role: "MANAGER",
        emailVerified: true,
        business: {
          create: {
            name: "Slice D Empty",
            slug: `slice-d-empty-${tag}`,
            verificationStatus: "verified",
            onboardingVerificationStatus: "rejected",
            subscriptionTier: "basic",
          },
        },
      },
      include: { business: true },
    });
    const emptyBizId = emptyMgr.business!.id;
    await softDeleteBusinessForAdmin(emptyBizId, { adminUserId: emptyMgr.id, reason: "slice-d" });
    const soft = await prisma.business.findUnique({ where: { id: emptyBizId } });
    if (soft?.deletedAt && soft.lifecycleStatus === "soft_closed") {
      pass("T-F02-c soft-close sets deletedAt + soft_closed");
    } else {
      fail(`T-F02-c soft-close state ${JSON.stringify(soft)}`);
    }

    // Primary business tips/refunds still present
    if (
      (await prisma.transaction.count({ where: { businessId: bizId } })) === 9 &&
      (await prisma.tipRefund.count({ where: { businessId: bizId } })) === 1
    ) {
      pass("T-F02-c primary business tips/refunds preserved");
    } else {
      fail("T-F02-c primary ledger disrupted");
    }

    // Source guard: no Art. 17 user.delete in employee.service
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../src/services/employee.service.ts", import.meta.url), "utf8"),
    );
    if (/prisma\.user\.delete\s*\(/.test(src)) fail("employee.service contains prisma.user.delete");
    else pass("employee.service has no prisma.user.delete");

    // Cleanup empty biz users
    await prisma.auditLog.deleteMany({ where: { userId: emptyMgr.id } });
    await prisma.business.delete({ where: { id: emptyBizId } }).catch(async () => {
      // Restrict: delete business then user
      await prisma.$executeRawUnsafe(`DELETE FROM businesses WHERE id = $1`, emptyBizId);
    });
    await prisma.user.delete({ where: { id: emptyMgr.id } }).catch(() => undefined);
  } catch (err) {
    fail(`run: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await prisma.auditLog.deleteMany({
      where: { action: { in: ["slice_d.test_audit", "slice_d.null_actor", "business.soft_deleted"] } },
    });
    await prisma.tipRefund.deleteMany({ where: { businessId: bizId } });
    await prisma.transaction.deleteMany({ where: { businessId: bizId } });
    await prisma.employee.deleteMany({ where: { businessId: bizId } });
    // Business Restrict: delete business before owner
    await prisma.business.delete({ where: { id: bizId } }).catch(() => undefined);
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [mgr.id, empUser.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [mgr.id, empUser.id] } } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
