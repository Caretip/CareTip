/**
 * Approved GDPR retention policy runtime tests (isolated fixtures).
 * Run: npm run test:gdpr-retention-policy (from backend/)
 *
 * Does not enable production execute flags in committed env.
 * Does not delete shared financial production rows.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { userErasurePendingData, computeErasureClocksFromRequestedAt } from "../src/services/lifecycleStatus.helpers.js";
import {
  cancelAccountErasure,
  ErasureCancelError,
  requestAccountErasure,
} from "../src/services/erasureRequest.service.js";
import {
  auditLegalHeldBusinesses,
  clearBusinessLegalHold,
  clearUserLegalHold,
  LegalHoldError,
  setBusinessLegalHold,
  setUserLegalHold,
} from "../src/services/legalHold.service.js";
import { runAnalyticsTtl, runGuestScrub, runNotifyCleanup, runStaffPiiScrub } from "../src/services/categoryRetention.service.js";
import { QR_ANONYMIZED_SESSION_ID } from "../src/services/retentionPolicy.constants.js";
import { evaluateKycDestroyDryRunScan, evaluateKycDestroyEligibility } from "../src/services/kycSecureDestroy.service.js";
import { resolveApprovedCategoryPolicy } from "../src/services/retentionPolicy.helpers.js";
import {
  backfillMissingErasureClocks,
  ERASURE_CLOCK_BACKFILL_APPLY_TOKEN,
} from "../src/services/erasureClockBackfill.service.js";
import { evaluateAnonymizeUser } from "../src/services/anonymization.service.js";
import { evaluateDsarCleanupDryRun, localDsarAbsolutePath } from "../src/services/dsarExport.service.js";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function main() {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const userIds: string[] = [];
  const bizIds: string[] = [];

  const admin = await prisma.user.create({
    data: {
      email: `gdpr-admin-${tag}@caretip-test.local`,
      passwordHash,
      role: "SUPER_ADMIN",
      isPlatformAdmin: true,
      emailVerified: true,
      accountStatus: "active",
    },
  });
  userIds.push(admin.id);

  const manager = await prisma.user.create({
    data: {
      email: `gdpr-mgr-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      accountStatus: "active",
      business: {
        create: {
          name: "GDPR Policy Biz",
          slug: `gdpr-pol-${tag}`,
          verificationStatus: "verified",
          timezone: "UTC",
        },
      },
    },
    include: { business: true },
  });
  userIds.push(manager.id);
  const bizId = manager.business!.id;
  bizIds.push(bizId);

  const empUser = await prisma.user.create({
    data: {
      email: `gdpr-emp-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      accountStatus: "active",
      employee: {
        create: {
          name: "Keep Historic Name",
          jobTitle: "Bar",
          phone: "+49999",
          bio: "bio-text",
          avatar: "/uploads/x.png",
          businessId: bizId,
          activationStatus: "active",
        },
      },
    },
    include: { employee: true },
  });
  userIds.push(empUser.id);
  const empId = empUser.employee!.id;

  const tip = await prisma.transaction.create({
    data: {
      amount: 5,
      status: "success",
      businessId: bizId,
      employeeId: empId,
      stripePaymentIntentId: `pi_gdpr_${tag}`,
    },
  });
  const refund = await prisma.tipRefund.create({
    data: {
      businessId: bizId,
      tipId: tip.id,
      kind: "refund",
      status: "succeeded",
      amountEur: 1,
      occurredAt: new Date(),
      stripeRefundId: `re_gdpr_${tag}`,
    },
  });

  try {
    const pol = resolveApprovedCategoryPolicy("notify", {});
    if (pol.ok && pol.kind === "days" && pol.days === 90) pass("notify approved policy is 90 days");
    else fail("notify policy");

    const contra = resolveApprovedCategoryPolicy("notify", { RETENTION_T_NOTIFY_DAYS: "30" } as NodeJS.ProcessEnv);
    if (!contra.ok && contra.reason === "contradicts_policy") {
      pass("contradicting RETENTION_T_NOTIFY_DAYS fail-closed");
    } else fail("notify contradiction");

    const erasure = await requestAccountErasure(empUser.id);
    if (
      erasure.ok &&
      erasure.status.accountStatus === "erasure_pending" &&
      erasure.status.canCancelDeletion &&
      erasure.status.erasureLifecycleState === "ERASURE_CANCELLATION_WINDOW"
    ) {
      pass("erasure: immediate deactivate + 14-day cancel window");
    } else fail(`erasure request: ${JSON.stringify(erasure.status)}`);

    const u = await prisma.user.findUnique({ where: { id: empUser.id } });
    if (u && u.deletionCancelUntil && u.anonymizeEligibleAt && u.deletionCancelUntil < u.anonymizeEligibleAt) {
      pass("deletionCancelUntil (14d) is before anonymizeEligibleAt (30d)");
    } else fail("14/30 timestamps");

    await cancelAccountErasure(empUser.id);
    const restored = await prisma.user.findUnique({ where: { id: empUser.id } });
    if (restored?.accountStatus === "active" && restored.isActive && !restored.deletionRequestedAt) {
      pass("14-day cancel restores account");
    } else fail("cancel restore");

    await prisma.user.update({
      where: { id: empUser.id },
      data: {
        ...userErasurePendingData(new Date(Date.now() - 15 * 86400000)),
      },
    });
    try {
      await cancelAccountErasure(empUser.id);
      fail("cancel after 14 days should expire");
    } catch (e) {
      if (e instanceof ErasureCancelError && e.code === "EXPIRED") pass("cancel rejected after 14-day window");
      else fail(`cancel expired: ${e}`);
    }

    try {
      await setUserLegalHold({
        userId: empUser.id,
        actorUserId: manager.id,
        reason: "manager should not place hold",
        categories: ["profile"],
      });
      fail("manager must not place legal hold");
    } catch (e) {
      if (e instanceof LegalHoldError && e.code === "FORBIDDEN") pass("ordinary manager cannot place legal hold");
      else fail(`manager hold: ${e}`);
    }

    const held = await setUserLegalHold({
      userId: empUser.id,
      actorUserId: admin.id,
      reason: "regulator",
      categories: ["profile", "financial"],
    });
    if (held.legalHold) pass("platform admin (Admin mapping) can place legal hold");
    else fail("admin place hold");

    try {
      await clearUserLegalHold({
        userId: empUser.id,
        actorUserId: manager.id,
        releaseReason: "nope",
      });
      fail("manager must not release hold");
    } catch (e) {
      if (e instanceof LegalHoldError && e.code === "FORBIDDEN") pass("ordinary manager cannot release legal hold");
      else fail(`manager release: ${e}`);
    }

    const cleared = await clearUserLegalHold({
      userId: empUser.id,
      actorUserId: admin.id,
      releaseReason: "matter closed",
    });
    if (!cleared.legalHold && cleared.legalHoldReleasedByUserId === admin.id) {
      pass("Admin can release legal hold with audited reason");
    } else fail("admin release");

    const { deleteEmployeeForBusiness } = await import("../src/services/employee.service.js");
    await prisma.user.update({
      where: { id: empUser.id },
      data: { accountStatus: "active", isActive: true, deletionRequestedAt: null, deletionCancelUntil: null, anonymizeEligibleAt: null },
    });
    await prisma.employee.update({
      where: { id: empId },
      data: { isDeleted: false, deletedAt: null, isActive: true, phone: "+49999", bio: "bio-text", avatar: "/uploads/x.png", name: "Keep Historic Name" },
    });
    await deleteEmployeeForBusiness(bizId, empId);
    const afterRemove = await prisma.employee.findUnique({ where: { id: empId } });
    const tipAfter = await prisma.transaction.findUnique({ where: { id: tip.id } });
    const refundAfter = await prisma.tipRefund.findUnique({ where: { id: refund.id } });
    if (
      afterRemove &&
      afterRemove.isDeleted &&
      afterRemove.name === "Keep Historic Name" &&
      afterRemove.phone == null &&
      afterRemove.bio == null &&
      afterRemove.avatar == null &&
      tipAfter &&
      refundAfter &&
      tipAfter.stripePaymentIntentId === `pi_gdpr_${tag}`
    ) {
      pass("manager remove: non-essential PII stripped; name + tips + Stripe ids preserved");
    } else fail("employee remove preservation");

    const staffRecent = await runStaffPiiScrub({
      bypassExecutionGate: true,
      env: {},
      businessId: bizId,
    });
    const stillNamed = await prisma.employee.findUnique({ where: { id: empId } });
    if (stillNamed?.name === "Keep Historic Name" && staffRecent.scrubbed === 0) {
      pass("staff 10-year job does not anonymize name before calendar-year expiry");
    } else fail("staff early name wipe");

    await prisma.notification.createMany({
      data: [
        { userId: manager.id, title: "Old", message: "o", type: "system", createdAt: new Date(Date.now() - 91 * 86400000) },
        { userId: manager.id, title: "New", message: "n", type: "system", createdAt: new Date() },
      ],
    });
    await runNotifyCleanup({ bypassExecutionGate: true, env: {}, userId: manager.id });
    const notes = await prisma.notification.findMany({ where: { userId: manager.id } });
    if (notes.length === 1 && notes[0].title === "New") pass("90-day notification cleanup");
    else fail(`notify ${notes.map((n) => n.title).join(",")}`);

    const oldScan = await prisma.qrScanEvent.create({
      data: {
        businessId: bizId,
        scanType: "staff",
        entryPath: "/t/x",
        deviceType: "mobile",
        sessionId: `sess-old-${tag}`,
        dedupeKey: `gdpr-old-${tag}`,
        scannedAt: new Date(Date.now() - 49 * 3600000),
        userAgent: "Mozilla/Test",
        country: "DE",
      },
    });
    const youngScan = await prisma.qrScanEvent.create({
      data: {
        businessId: bizId,
        scanType: "staff",
        entryPath: "/t/y",
        deviceType: "mobile",
        sessionId: `sess-new-${tag}`,
        dedupeKey: `gdpr-new-${tag}`,
        scannedAt: new Date(),
      },
    });
    const dry = await runAnalyticsTtl({
      bypassExecutionGate: true,
      env: { DATA_LIFECYCLE_V1: "true", DATA_LIFECYCLE_DRY_RUN: "true" } as NodeJS.ProcessEnv,
      businessId: bizId,
    });
    const stillPersonal = await prisma.qrScanEvent.findUnique({ where: { id: oldScan.id } });
    if (dry.dryRun && stillPersonal?.userAgent === "Mozilla/Test") {
      pass("dry-run reports QR anonymize without mutating");
    } else fail("dry-run mutated or skipped");

    await runAnalyticsTtl({ bypassExecutionGate: true, env: {}, businessId: bizId });
    const anon = await prisma.qrScanEvent.findUnique({ where: { id: oldScan.id } });
    const young = await prisma.qrScanEvent.findUnique({ where: { id: youngScan.id } });
    if (
      anon &&
      anon.sessionId === QR_ANONYMIZED_SESSION_ID &&
      anon.userAgent == null &&
      anon.anonymizedAt &&
      young?.sessionId === `sess-new-${tag}`
    ) {
      pass("QR personal session anonymized after 48h; row and aggregates preserved");
    } else fail("QR anonymize");

    await prisma.tipFeedback.create({
      data: {
        transactionId: tip.id,
        businessId: bizId,
        employeeId: empId,
        rating: 5,
        tags: ["fast"],
        customerName: "Guest Bob",
        comment: "Nice",
      },
    });
    await runGuestScrub({ bypassExecutionGate: true, env: {}, businessId: bizId });
    const fb = await prisma.tipFeedback.findFirst({ where: { transactionId: tip.id } });
    if (fb && fb.customerName == null && fb.comment === "Nice" && fb.rating === 5) {
      pass("guest name leftover scrubbed; feedback body preserved");
    } else fail("guest scrub");

    const kycEarly = evaluateKycDestroyEligibility(
      {
        id: bizId,
        lifecycleStatus: "soft_closed",
        deletedAt: new Date(),
        kycRetainUntil: null,
        legalHold: false,
        legalHoldCategories: [],
      },
      { env: {} },
    );
    if (!kycEarly.eligible && kycEarly.code === "RETENTION_NOT_ELAPSED") {
      pass("KYC 10-year calendar-year not elapsed for recent closure");
    } else fail(`kyc early ${kycEarly.code}`);

    const kycContra = evaluateKycDestroyEligibility(
      {
        id: bizId,
        lifecycleStatus: "soft_closed",
        deletedAt: new Date("2010-01-01T00:00:00.000Z"),
        kycRetainUntil: null,
        legalHold: false,
        legalHoldCategories: [],
      },
      { env: { RETENTION_T_KYC_DAYS: "1" } as NodeJS.ProcessEnv },
    );
    if (!kycContra.eligible && kycContra.code === "POLICY_CONTRADICTION") {
      pass("rolling T_KYC_DAYS contradicts 10-year calendar policy");
    } else fail(`kyc contra ${kycContra.code}`);

    const kycHeld = evaluateKycDestroyEligibility(
      {
        id: bizId,
        lifecycleStatus: "soft_closed",
        deletedAt: new Date("2010-01-01T00:00:00.000Z"),
        kycRetainUntil: null,
        legalHold: true,
        legalHoldCategories: ["kyc"],
      },
      { env: {} },
    );
    if (!kycHeld.eligible && kycHeld.code === "LEGAL_HOLD_KYC") {
      pass("KYC legal hold blocks destroy even after 10 years");
    } else fail("kyc hold");

    const kycOk = evaluateKycDestroyEligibility(
      {
        id: bizId,
        lifecycleStatus: "soft_closed",
        deletedAt: new Date("2010-06-01T00:00:00.000Z"),
        kycRetainUntil: null,
        legalHold: false,
        legalHoldCategories: [],
      },
      { env: {}, now: new Date("2021-01-01T00:00:00.000Z") },
    );
    if (kycOk.eligible) pass("KYC eligible after end of 2010 + 10 years (2021-01-01)");
    else fail(`kyc eligible ${kycOk.code} ${kycOk.earliestDestroyAt}`);

    const requestedAt = new Date(Date.now() - 2 * 86400000);
    const legacy = await prisma.user.create({
      data: {
        email: `gdpr-legacy-${tag}@caretip-test.local`,
        passwordHash,
        role: "EMPLOYEE",
        emailVerified: true,
        isActive: false,
        accountStatus: "erasure_pending",
        deletionRequestedAt: requestedAt,
        deletionCancelUntil: null,
        anonymizeEligibleAt: null,
      },
    });
    userIds.push(legacy.id);

    const expectedClocks = computeErasureClocksFromRequestedAt(requestedAt);
    const dryBackfill = await backfillMissingErasureClocks({ dryRun: true });
    const legacyAfterDry = await prisma.user.findUnique({ where: { id: legacy.id } });
    if (
      dryBackfill.dryRun &&
      dryBackfill.applied === 0 &&
      dryBackfill.candidates.some((c) => c.userId === legacy.id) &&
      legacyAfterDry?.deletionCancelUntil == null &&
      legacyAfterDry?.anonymizeEligibleAt == null
    ) {
      pass("legacy erasure clock backfill dry-run does not write");
    } else fail("legacy backfill dry-run mutated or missed candidate");

    try {
      await backfillMissingErasureClocks({
        dryRun: false,
        confirmApply: ERASURE_CLOCK_BACKFILL_APPLY_TOKEN,
      });
      fail("backfill apply without subjectIds must refuse");
    } catch (e) {
      if (e instanceof Error && /subjectIds/.test(e.message)) pass("backfill apply refuses blanket write");
      else fail(`backfill blanket: ${e}`);
    }

    const appliedBackfill = await backfillMissingErasureClocks({
      dryRun: false,
      confirmApply: ERASURE_CLOCK_BACKFILL_APPLY_TOKEN,
      subjectIds: [legacy.id],
    });
    const legacyAfter = await prisma.user.findUnique({ where: { id: legacy.id } });
    if (
      !appliedBackfill.dryRun &&
      appliedBackfill.applied === 1 &&
      legacyAfter?.deletionCancelUntil &&
      legacyAfter.anonymizeEligibleAt &&
      Math.abs(legacyAfter.deletionCancelUntil.getTime() - expectedClocks.deletionCancelUntil.getTime()) < 1000 &&
      Math.abs(legacyAfter.anonymizeEligibleAt.getTime() - expectedClocks.anonymizeEligibleAt.getTime()) < 1000 &&
      legacyAfter.deletionCancelUntil < legacyAfter.anonymizeEligibleAt &&
      legacyAfter.accountStatus === "erasure_pending"
    ) {
      pass("legacy dual clocks backfilled 14d vs 30d without status change");
    } else fail("legacy backfill apply");

    const second = await backfillMissingErasureClocks({
      dryRun: false,
      confirmApply: ERASURE_CLOCK_BACKFILL_APPLY_TOKEN,
      subjectIds: [legacy.id],
    });
    const legacyUnchanged = await prisma.user.findUnique({ where: { id: legacy.id } });
    if (
      second.applied === 0 &&
      legacyUnchanged?.deletionCancelUntil?.getTime() === legacyAfter?.deletionCancelUntil?.getTime()
    ) {
      pass("backfill does not overwrite existing clocks");
    } else fail("backfill overwrite");

    const skipEval = await evaluateAnonymizeUser(manager.id);
    if (skipEval.action === "WOULD_SKIP_NOT_ELIGIBLE" && skipEval.reason === "PRECONDITION_not_erasure_pending") {
      pass("anonymize eval skips non-erasure_pending without mutation");
    } else fail(`anonymize eval active: ${skipEval.action} ${skipEval.reason}`);

    const recent = await prisma.user.create({
      data: {
        email: `gdpr-recent-${tag}@caretip-test.local`,
        passwordHash,
        role: "EMPLOYEE",
        emailVerified: true,
        ...userErasurePendingData(new Date()),
      },
    });
    userIds.push(recent.id);
    const recentEval = await evaluateAnonymizeUser(recent.id);
    const recentAfter = await prisma.user.findUnique({ where: { id: recent.id } });
    if (
      recentEval.action === "WOULD_SKIP_NOT_ELIGIBLE" &&
      recentEval.reason === "ACCOUNT_ERASURE_30_DAY_NOT_ELAPSED" &&
      recentAfter?.email === `gdpr-recent-${tag}@caretip-test.local` &&
      recentAfter.passwordHash
    ) {
      pass("anonymize eval skips 30-day gate without terminating sessions");
    } else fail(`anonymize eval 30d: ${recentEval.action} ${recentEval.reason}`);

    const heldUser = await prisma.user.create({
      data: {
        email: `gdpr-hold-eval-${tag}@caretip-test.local`,
        passwordHash,
        role: "EMPLOYEE",
        emailVerified: true,
        ...userErasurePendingData(new Date(Date.now() - 31 * 86400000)),
      },
    });
    userIds.push(heldUser.id);
    await setUserLegalHold({
      userId: heldUser.id,
      actorUserId: admin.id,
      reason: "eval hold",
      categories: ["profile"],
    });
    const holdEval = await evaluateAnonymizeUser(heldUser.id);
    const heldAfter = await prisma.user.findUnique({ where: { id: heldUser.id } });
    if (
      holdEval.action === "WOULD_SKIP_LEGAL_HOLD" &&
      heldAfter?.passwordHash &&
      heldAfter.email === `gdpr-hold-eval-${tag}@caretip-test.local`
    ) {
      pass("anonymize eval legal hold skips without session terminate");
    } else fail(`anonymize eval hold: ${holdEval.action}`);

    const eligible = await prisma.user.create({
      data: {
        email: `gdpr-elig-eval-${tag}@caretip-test.local`,
        passwordHash,
        role: "EMPLOYEE",
        emailVerified: true,
        ...userErasurePendingData(new Date(Date.now() - 31 * 86400000)),
      },
    });
    userIds.push(eligible.id);
    const eligEval = await evaluateAnonymizeUser(eligible.id);
    const eligAfter = await prisma.user.findUnique({ where: { id: eligible.id } });
    if (
      eligEval.action === "WOULD_ANONYMIZE" &&
      eligAfter?.email === `gdpr-elig-eval-${tag}@caretip-test.local` &&
      eligAfter.accountStatus === "erasure_pending"
    ) {
      pass("anonymize eval WOULD_ANONYMIZE without calling anonymizeUser");
    } else fail(`anonymize eval eligible: ${eligEval.action}`);

    await setBusinessLegalHold({
      businessId: bizId,
      actorUserId: admin.id,
      reason: "eval biz hold",
      categories: ["kyc", "analytics"],
    });
    const heldBizAudit = await auditLegalHeldBusinesses();
    const fixtureHold = heldBizAudit.find((b) => b.businessId === bizId);
    if (
      fixtureHold &&
      fixtureHold.legalHoldCategories.includes("kyc") &&
      fixtureHold.legalHoldCategories.includes("analytics") &&
      fixtureHold.holdDecisions.kyc === "held" &&
      fixtureHold.holdDecisions.analytics === "held" &&
      fixtureHold.holdDecisions.guest === "clear" &&
      !fixtureHold.ambiguousEmptyCategories
    ) {
      pass("legal-held business audit reports categories without PII");
    } else fail("legal hold business audit");
    await clearBusinessLegalHold({
      businessId: bizId,
      actorUserId: admin.id,
      releaseReason: "eval cleanup",
    });

    const kycScan = await evaluateKycDestroyDryRunScan({ env: {} });
    const bizAfterKycScan = await prisma.business.findUnique({
      where: { id: bizId },
      select: { verificationDocumentPath: true, taxId: true, kycDocuments: true },
    });
    if (kycScan.wouldDestroy === 0 || kycScan.rows.every((r) => r.taxIdUntouched)) {
      pass("KYC destroy dry-run scan does not mutate taxId/refs");
    } else fail("kyc dry-run scan");
    if (bizAfterKycScan?.verificationDocumentPath == null) pass("fixture KYC refs unchanged after dry-run scan");
    else fail("kyc scan mutated path");

    const orphanJobId = `orphan${tag}`;
    const orphanAbs = localDsarAbsolutePath(eligible.id, orphanJobId);
    await mkdir(path.dirname(orphanAbs), { recursive: true });
    await writeFile(orphanAbs, "{\"dry\":true}", "utf8");
    const dsarEval = await evaluateDsarCleanupDryRun();
    if (dsarEval.localOrphans.some((o) => o.jobId === orphanJobId && o.userId === eligible.id) && existsSync(orphanAbs)) {
      pass("DSAR cleanup dry-run lists local orphan without unlink");
    } else fail("dsar dry-run orphan");
    await unlink(orphanAbs).catch(() => undefined);

    const expiredJob = await prisma.dataLifecycleJob.create({
      data: {
        type: "dsar_export",
        status: "succeeded",
        subjectType: "user",
        subjectId: eligible.id,
        payload: {
          downloadToken: "token",
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
          artifact: { kind: "inline", json: { n: 1 } },
        },
      },
    });
    const dsarExpired = await evaluateDsarCleanupDryRun();
    const jobAfter = await prisma.dataLifecycleJob.findUnique({ where: { id: expiredJob.id } });
    if (
      dsarExpired.expiredSucceededJobs.some((j) => j.jobId === expiredJob.id) &&
      jobAfter?.status === "succeeded"
    ) {
      pass("DSAR eval WOULD_DELETE expired artifact without cancelling job");
    } else fail("dsar expired eval");

    const tipFinal = await prisma.transaction.findUnique({ where: { id: tip.id } });
    if (tipFinal?.stripePaymentIntentId === `pi_gdpr_${tag}`) pass("financial Stripe id preserved through lifecycle tests");
    else fail("financial id lost");
  } finally {
    await prisma.dataLifecycleJob.deleteMany({ where: { subjectId: { in: [...userIds, ...bizIds] } } }).catch(() => undefined);
    await prisma.tipFeedback.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.tipRefund.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.qrScanEvent.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.transaction.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.employee.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.business.deleteMany({ where: { id: { in: bizIds } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  }

  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) console.log(line);
  console.log(`\nGDPR retention policy: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
