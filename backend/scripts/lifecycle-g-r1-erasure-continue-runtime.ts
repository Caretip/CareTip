/**
 * G-R1 remediation — erasure_continue wiring regression.
 * Run: npm run test:lifecycle-g-r1-erasure-continue (from backend/)
 *
 * Proves: hold → erasure paused → hold cleared → erasure_continue → anonymize path.
 * Isolated fixtures. Does not enable production destruction permanently.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  setUserLegalHold,
  clearUserLegalHold,
} from "../src/services/legalHold.service.js";
import { requestAccountErasure } from "../src/services/erasureRequest.service.js";
import {
  processErasureContinueJob,
  reclaimStaleErasureContinueJobs,
  tickErasureContinueJobs,
} from "../src/services/erasureContinue.service.js";
import { anonymizeUser } from "../src/services/anonymization.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function main() {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);

  const saved = {
    v1: process.env.DATA_LIFECYCLE_V1,
    exec: process.env.DATA_LIFECYCLE_ANONYMIZATION_EXECUTE,
    pepper: process.env.DATA_LIFECYCLE_EMAIL_PEPPER,
  };

  process.env.DATA_LIFECYCLE_V1 = "true";
  process.env.DATA_LIFECYCLE_ANONYMIZATION_EXECUTE = "true";
  process.env.DATA_LIFECYCLE_EMAIL_PEPPER = "g-r1-remediation-pepper-32chars!!";

  const admin = await prisma.user.create({
    data: {
      email: `g-r1-admin-${tag}@caretip-test.local`,
      passwordHash,
      role: "SUPER_ADMIN",
      isPlatformAdmin: true,
      emailVerified: true,
      accountStatus: "active",
    },
  });

  const owner = await prisma.user.create({
    data: {
      email: `g-r1-owner-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      accountStatus: "active",
      business: {
        create: {
          name: "G-R1 Biz",
          slug: `g-r1-${tag}`,
          verificationStatus: "verified",
        },
      },
    },
    include: { business: true },
  });
  const businessId = owner.business!.id;

  const emp = await prisma.user.create({
    data: {
      email: `g-r1-emp-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      accountStatus: "active",
      employee: {
        create: {
          name: "G-R1 Staff",
          jobTitle: "Server",
          businessId,
          isActive: true,
        },
      },
    },
    include: { employee: true },
  });

  const tip = await prisma.transaction.create({
    data: {
      amount: 3.25,
      status: "success",
      businessId,
      employeeId: emp.employee!.id,
      stripePaymentIntentId: `pi_gr1_${tag}`,
    },
  });

  try {
    // 1) Place profile legal hold
    await setUserLegalHold({
      userId: emp.id,
      actorUserId: admin.id,
      reason: "G-R1 dispute hold",
      categories: ["profile"],
    });

    // 2) Erasure request → erasure_pending (hold does not block recording intent)
    const erasure = await requestAccountErasure(emp.id);
    if (erasure.ok && erasure.status.accountStatus === "erasure_pending") {
      pass("erasure_pending recorded under profile legal hold");
    } else fail(`erasure under hold unexpected: ${JSON.stringify(erasure)}`);

    // 3) Direct anonymize blocked while held
    try {
      await anonymizeUser(emp.id, { bypassExecutionGate: true });
      fail("anonymize must pause under profile hold");
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "LEGAL_HOLD_CATEGORY") pass("anonymize paused under profile hold");
      else fail(`unexpected anonymize error: ${e}`);
    }

    // 4) Manual erasure_continue while hold active → skipped_legal_hold
    const contWhileHeld = await prisma.dataLifecycleJob.create({
      data: {
        type: "erasure_continue",
        subjectType: "user",
        subjectId: emp.id,
        status: "pending",
        payload: { reason: "test_while_held" },
      },
    });
    const heldResult = await processErasureContinueJob(contWhileHeld.id, {
      bypassExecutionGate: true,
      runAnonymizeInline: true,
    });
    if (heldResult.status === "skipped_legal_hold") {
      pass("erasure_continue skips while profile category held");
    } else fail(`expected skipped_legal_hold got ${heldResult.status}`);

    // 5) Clear hold → enqueues erasure_continue (legalHold.service)
    await clearUserLegalHold({ userId: emp.id, actorUserId: admin.id, releaseReason: "matter closed" });
    const woken = await prisma.dataLifecycleJob.findFirst({
      where: {
        type: "erasure_continue",
        subjectId: emp.id,
        status: "pending",
      },
      orderBy: { createdAt: "desc" },
    });
    if (woken) pass("hold clear enqueues erasure_continue");
    else fail("hold clear did not enqueue erasure_continue");

    // 6) Process erasure_continue → anonymize path (30-day eligibility must already have elapsed)
    await prisma.user.update({
      where: { id: emp.id },
      data: {
        anonymizeEligibleAt: new Date(Date.now() - 1000),
        deletionCancelUntil: new Date(Date.now() - 1000),
      },
    });
    const contId = woken!.id;
    const contResult = await processErasureContinueJob(contId, {
      bypassExecutionGate: true,
      runAnonymizeInline: true,
      deleteStorageObject: async () => {},
    });
    if (contResult.status === "succeeded" && contResult.anonymizeJobId) {
      pass("erasure_continue succeeded and linked anonymize_user job");
    } else fail(`continue result unexpected: ${JSON.stringify(contResult)}`);

    const after = await prisma.user.findUnique({
      where: { id: emp.id },
      select: { accountStatus: true, anonymizedAt: true, email: true },
    });
    if (after?.accountStatus === "anonymized" || after?.accountStatus === "closed") {
      pass("anonymization path completed after hold clear + erasure_continue");
    } else fail(`user not anonymized: ${after?.accountStatus}`);

    const tipAfter = await prisma.transaction.findUnique({ where: { id: tip.id } });
    if (tipAfter && Number(tipAfter.amount) === 3.25 && tipAfter.businessId === businessId) {
      pass("tip financial row survived anonymization");
    } else fail("tip survival failed");

    // 7) Idempotency — second continue succeeds without error
    const again = await prisma.dataLifecycleJob.create({
      data: {
        type: "erasure_continue",
        subjectType: "user",
        subjectId: emp.id,
        status: "pending",
        payload: { reason: "idempotent" },
      },
    });
    const againResult = await processErasureContinueJob(again.id, {
      bypassExecutionGate: true,
      runAnonymizeInline: true,
    });
    if (againResult.status === "succeeded") pass("erasure_continue idempotent after anonymize");
    else fail(`idempotent continue failed: ${againResult.status}`);

    // 8) Tenant isolation — forged payload userId
    const other = await prisma.user.create({
      data: {
        email: `g-r1-other-${tag}@caretip-test.local`,
        passwordHash,
        role: "EMPLOYEE",
        emailVerified: true,
        accountStatus: "erasure_pending",
        isActive: false,
      },
    });
    const forged = await prisma.dataLifecycleJob.create({
      data: {
        type: "erasure_continue",
        subjectType: "user",
        subjectId: emp.id,
        status: "pending",
        payload: { userId: other.id },
      },
    });
    const forgedResult = await processErasureContinueJob(forged.id, {
      bypassExecutionGate: true,
    });
    if (forgedResult.status === "failed") {
      pass("cross-tenant forged payload userId rejected");
    } else fail(`forged payload should fail got ${forgedResult.status}`);
    await prisma.user.delete({ where: { id: other.id } });

    // 9) Reclaim stale running
    const stale = await prisma.dataLifecycleJob.create({
      data: {
        type: "erasure_continue",
        subjectType: "user",
        subjectId: emp.id,
        status: "running",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        payload: {},
      },
    });
    // Force updatedAt via raw if needed — prisma may overwrite updatedAt
    await prisma.$executeRaw`
      UPDATE data_lifecycle_jobs
      SET updated_at = NOW() - INTERVAL '20 minutes'
      WHERE id = ${stale.id}
    `;
    const n = await reclaimStaleErasureContinueJobs(new Date(), 15 * 60 * 1000);
    const staleAfter = await prisma.dataLifecycleJob.findUnique({ where: { id: stale.id } });
    if (n >= 1 && staleAfter?.status === "pending") pass("stale erasure_continue running lease reclaimed");
    else fail(`reclaim unexpected n=${n} status=${staleAfter?.status}`);

    // 10) Tick path
    const tickJob = await prisma.dataLifecycleJob.create({
      data: {
        type: "erasure_continue",
        subjectType: "user",
        subjectId: emp.id,
        status: "pending",
        payload: { reason: "tick" },
      },
    });
    const tick = await tickErasureContinueJobs({
      bypassExecutionGate: true,
      runAnonymizeInline: true,
      limit: 5,
    });
    const tickRow = await prisma.dataLifecycleJob.findUnique({ where: { id: tickJob.id } });
    if (tick.processed >= 1 && tickRow?.status === "succeeded") {
      pass("tickErasureContinueJobs processes pending continue jobs");
    } else fail(`tick unexpected processed=${tick.processed} status=${tickRow?.status}`);

    // 11) Blockers path — pending tip blocks continue
    const blockedUser = await prisma.user.create({
      data: {
        email: `g-r1-block-${tag}@caretip-test.local`,
        passwordHash,
        role: "EMPLOYEE",
        emailVerified: true,
        accountStatus: "erasure_pending",
        isActive: false,
        deletionRequestedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        deletionCancelUntil: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        anonymizeEligibleAt: new Date(Date.now() - 1000),
        employee: {
          create: {
            name: "Blocked",
            jobTitle: "Bar",
            businessId,
            isActive: false,
            isDeleted: true,
            deletedAt: new Date(),
          },
        },
      },
      include: { employee: true },
    });
    await prisma.transaction.create({
      data: {
        amount: 1,
        status: "pending",
        businessId,
        employeeId: blockedUser.employee!.id,
        stripePaymentIntentId: `pi_gr1_block_${tag}`,
      },
    });
    const blockJob = await prisma.dataLifecycleJob.create({
      data: {
        type: "erasure_continue",
        subjectType: "user",
        subjectId: blockedUser.id,
        status: "pending",
        payload: {},
      },
    });
    const blockResult = await processErasureContinueJob(blockJob.id, {
      bypassExecutionGate: true,
      runAnonymizeInline: true,
    });
    const blockRow = await prisma.dataLifecycleJob.findUnique({ where: { id: blockJob.id } });
    if (
      blockResult.status === "pending" &&
      blockRow?.lastError?.includes("PENDING_TIP_PAYMENT")
    ) {
      pass("erasure_continue defers when payment blockers remain");
    } else fail(`blocker defer unexpected: ${blockResult.status} ${blockRow?.lastError}`);

    await prisma.transaction.deleteMany({
      where: { stripePaymentIntentId: `pi_gr1_block_${tag}` },
    });
    await prisma.employee.deleteMany({ where: { id: blockedUser.employee!.id } });
    await prisma.dataLifecycleJob.deleteMany({ where: { subjectId: blockedUser.id } });
    await prisma.user.delete({ where: { id: blockedUser.id } });
  } finally {
    if (saved.v1 === undefined) delete process.env.DATA_LIFECYCLE_V1;
    else process.env.DATA_LIFECYCLE_V1 = saved.v1;
    if (saved.exec === undefined) delete process.env.DATA_LIFECYCLE_ANONYMIZATION_EXECUTE;
    else process.env.DATA_LIFECYCLE_ANONYMIZATION_EXECUTE = saved.exec;
    if (saved.pepper === undefined) delete process.env.DATA_LIFECYCLE_EMAIL_PEPPER;
    else process.env.DATA_LIFECYCLE_EMAIL_PEPPER = saved.pepper;

    await prisma.dataLifecycleJob.deleteMany({
      where: { subjectId: { in: [emp.id, admin.id] } },
    });
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [admin.id, emp.id, owner.id] } },
    });
    await prisma.transaction.deleteMany({ where: { businessId } });
    await prisma.employee.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: [admin.id, emp.id, owner.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [admin.id, emp.id, owner.id] } },
    });
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  if (failed.length) {
    console.error(`\n${failed.length} failure(s)`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} G-R1 checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
