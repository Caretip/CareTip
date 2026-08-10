/**
 * GDPR lifecycle Slice F-A — non-destructive anonymization engine (F-A01…F-A26).
 * Run: npm run test:lifecycle-slice-f-anonymization (from backend/)
 *
 * Isolated fixtures only. Does not execute production anonymization workers.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { transferBusinessOwnership } from "../src/services/businessOwnership.service.js";
import { createDsarExportJob } from "../src/services/dsarExport.service.js";
import { userMayAuthenticate } from "../src/services/accountAccess.service.js";
import {
  AnonymizationError,
  EMAIL_HASH_CLASSIFICATION,
  FORMER_TEAM_MEMBER_NAME,
  anonymizeEmployee,
  anonymizeUser,
  computeEmailHash,
  enqueueAnonymizeUserJob,
  isAnonymizationExecutionEnabled,
  normalizeEmailForHash,
  processAnonymizeLifecycleJob,
  tickAnonymizationJobs,
  tombstoneEmailForUserId,
} from "../src/services/anonymization.service.js";

// Enable gated execution for this isolated suite only.
process.env.DATA_LIFECYCLE_V1 = "true";
process.env.DATA_LIFECYCLE_ANONYMIZATION_EXECUTE = "true";
process.env.DATA_LIFECYCLE_EMAIL_PEPPER =
  process.env.DATA_LIFECYCLE_EMAIL_PEPPER?.trim() || "slice-f-a-test-pepper-not-for-prod";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const userIds: string[] = [];
  const bizIds: string[] = [];
  const storageCalls: string[] = [];
  const deleteStorageOk = async (url: string) => {
    storageCalls.push(url);
  };
  let storageFailOnce = false;
  const deleteStorageFailOnce = async (url: string) => {
    storageCalls.push(url);
    if (!storageFailOnce) {
      storageFailOnce = true;
      throw new Error("simulated storage failure");
    }
  };

  // Manager who owns business (for F-A15) + successor (F-A16)
  const owner = await prisma.user.create({
    data: {
      email: `slice-fa-owner-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      accountStatus: "active",
      business: {
        create: {
          name: "Slice FA Biz",
          slug: `slice-fa-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
    },
    include: { business: true },
  });
  userIds.push(owner.id);
  const bizId = owner.business!.id;
  bizIds.push(bizId);

  const successor = await prisma.user.create({
    data: {
      email: `slice-fa-succ-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      accountStatus: "active",
    },
  });
  userIds.push(successor.id);

  // Employee subject for anonymization (F-A01+)
  const empUser = await prisma.user.create({
    data: {
      email: `slice-fa-emp-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      accountStatus: "erasure_pending",
      isActive: false,
      deletionRequestedAt: new Date(),
      twoFactorEnabled: true,
      twoFactorSecret: "SECRET_TOTP_SLICE_FA",
      twoFactorTempSecret: "TEMP_SECRET",
      preferredLocale: "de",
      settings: { create: { summaryEmails: true, tipReceivedNotifications: true } },
      oauthAccounts: {
        create: { provider: "google", subject: `google-slice-fa-${tag}` },
      },
      pushDeviceTokens: {
        create: { token: `fcm-slice-fa-${tag}`, platform: "web" },
      },
      refreshTokens: {
        create: {
          tokenHash: `rt-slice-fa-${tag}`,
          expiresAt: new Date(Date.now() + 86400000),
        },
      },
      passwordResetTokens: {
        create: {
          tokenHash: `pr-slice-fa-${tag}`,
          expiresAt: new Date(Date.now() + 3600000),
        },
      },
      emailVerificationTokens: {
        create: {
          tokenHash: `ev-slice-fa-${tag}`,
          expiresAt: new Date(Date.now() + 3600000),
        },
      },
      mobileWebHandoffTokens: {
        create: {
          tokenHash: `hw-slice-fa-${tag}`,
          purpose: "billing",
          expiresAt: new Date(Date.now() + 600000),
        },
      },
      notifications: {
        create: {
          title: "Tip",
          message: "You got a tip",
          type: "tip",
        },
      },
      employee: {
        create: {
          name: "Slice FA Staff",
          jobTitle: "Bar",
          phone: "+49123456789",
          bio: "Loves coffee",
          avatar: `https://example.invalid/avatars/slice-fa-${tag}.png`,
          slug: `slice-fa-staff-${tag}`,
          businessId: bizId,
          isActive: true,
          activationStatus: "active",
          emailNotifications: true,
          pushNotifications: true,
        },
      },
    },
    include: { employee: true },
  });
  userIds.push(empUser.id);
  const empId = empUser.employee!.id;
  const originalEmail = empUser.email;
  const avatarUrl = empUser.employee!.avatar!;

  await prisma.employeeGoal.create({
    data: {
      employeeId: empId,
      name: "Monthly tips",
      goalAmount: 100,
      goalPeriod: "monthly",
      startDate: new Date(),
    },
  });
  await prisma.employeeActivationToken.create({
    data: {
      employeeId: empId,
      tokenHash: `act-slice-fa-${tag}`,
      email: originalEmail,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });

  const tip = await prisma.transaction.create({
    data: {
      amount: 17.25,
      status: "success",
      employeeId: empId,
      businessId: bizId,
      stripePaymentIntentId: `pi_slice_fa_${tag}`,
      receiptNumber: `CT-FA-${tag}`,
    },
  });
  const refund = await prisma.tipRefund.create({
    data: {
      businessId: bizId,
      tipId: tip.id,
      kind: "refund",
      status: "succeeded",
      amountEur: 5,
      stripeRefundId: `re_slice_fa_${tag}`,
      occurredAt: new Date(),
      originalAmountEur: 17.25,
    },
  });
  await prisma.tipFeedback.create({
    data: {
      transactionId: tip.id,
      businessId: bizId,
      employeeId: empId,
      rating: 5,
      comment: "Great service",
      customerName: "Guest Alice",
      tags: ["friendly"],
    },
  });
  await prisma.businessActivityEvent.create({
    data: {
      businessId: bizId,
      type: "tip.received",
      source: "PAYMENTS",
      occurredAt: new Date(),
      actorEmployeeId: empId,
      dedupeKey: `slice-fa-act-${tag}`,
      summary: { employeeName: "Slice FA Staff", amount: 17.25 },
    },
  });

  // Active user (F-A02)
  const activeUser = await prisma.user.create({
    data: {
      email: `slice-fa-active-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      accountStatus: "active",
      isActive: true,
    },
  });
  userIds.push(activeUser.id);

  // Legal-hold user (F-A17/F-A18)
  const holdUser = await prisma.user.create({
    data: {
      email: `slice-fa-hold-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      accountStatus: "erasure_pending",
      isActive: false,
      legalHold: true,
      legalHoldCategories: ["profile"],
      legalHoldSetAt: new Date(),
      refreshTokens: {
        create: {
          tokenHash: `rt-hold-fa-${tag}`,
          expiresAt: new Date(Date.now() + 86400000),
        },
      },
      oauthAccounts: {
        create: { provider: "google", subject: `google-hold-fa-${tag}` },
      },
    },
  });
  userIds.push(holdUser.id);

  // Cross-tenant victim
  const otherUser = await prisma.user.create({
    data: {
      email: `slice-fa-other-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      accountStatus: "erasure_pending",
      isActive: false,
    },
  });
  userIds.push(otherUser.id);

  try {
    // Static safety: no user/transaction hard-delete in engine
    const src = readFileSync(
      path.join(__dirname, "../src/services/anonymization.service.ts"),
      "utf8",
    );
    if (
      !/\bprisma\.user\.delete\s*\(/.test(src) &&
      !/\btx\.user\.delete\s*\(/.test(src) &&
      !/\bprisma\.transaction\.delete\s*\(/.test(src) &&
      !/\btx\.transaction\.delete\s*\(/.test(src) &&
      !src.includes("kyc_secure_destroy") &&
      src.includes("removeUploadedObjectByPublicUrlIfPossible")
    ) {
      pass("F-A14 engine uses scoped storage helper; no user/tip/KYC destroy APIs");
    } else {
      fail("F-A14 unsafe delete or missing scoped storage helper");
    }

    if (!isAnonymizationExecutionEnabled()) {
      fail("execution flags should be enabled for suite");
    } else {
      pass("production-style execution flags enabled for isolated suite only");
    }

    // F-A02 active cannot anonymize
    try {
      await anonymizeUser(activeUser.id, {
        bypassExecutionGate: true,
        deleteStorageObject: deleteStorageOk,
      });
      fail("F-A02 active user should not anonymize");
    } catch (e) {
      if (e instanceof AnonymizationError && e.code === "PRECONDITION") {
        pass("F-A02 active user cannot be anonymized");
      } else fail("F-A02 unexpected error");
    }

    // F-A15 owner of active business blocked
    await prisma.user.update({
      where: { id: owner.id },
      data: { accountStatus: "erasure_pending", isActive: false },
    });
    try {
      await anonymizeUser(owner.id, {
        bypassExecutionGate: true,
        deleteStorageObject: deleteStorageOk,
      });
      fail("F-A15 active Business owner should be blocked");
    } catch (e) {
      if (e instanceof AnonymizationError && e.code === "ACTIVE_BUSINESS_OWNER") {
        pass("F-A15 active Business owner cannot be anonymized");
      } else fail(`F-A15 unexpected: ${e instanceof Error ? e.message : e}`);
    }

    // F-A16 transfer then anonymize former owner
    await transferBusinessOwnership({
      businessId: bizId,
      successorUserId: successor.id,
      actorUserId: owner.id,
      source: "owner",
    });
    const former = await anonymizeUser(owner.id, {
      bypassExecutionGate: true,
      deleteStorageObject: deleteStorageOk,
      actorId: owner.id,
    });
    if (former.accountStatus === "closed" && former.anonymizedAt) {
      pass("F-A16 former owner after transfer can be anonymized");
    } else fail("F-A16 former owner anonymize failed");

    // F-A01 + core employee/user anonymization
    const result = await anonymizeUser(empUser.id, {
      bypassExecutionGate: true,
      deleteStorageObject: deleteStorageOk,
      actorId: empUser.id,
    });
    if (result.anonymizedAt && (result.accountStatus === "closed" || result.accountStatus === "anonymized")) {
      pass("F-A01 erasure_pending user can be anonymized");
    } else fail("F-A01 anonymize failed");

    const after = await prisma.user.findUnique({
      where: { id: empUser.id },
      include: {
        oauthAccounts: true,
        refreshTokens: true,
        passwordResetTokens: true,
        emailVerificationTokens: true,
        mobileWebHandoffTokens: true,
        pushDeviceTokens: true,
        settings: true,
        notifications: true,
        employee: true,
      },
    });
    if (!after) {
      fail("user row missing after anonymize");
    } else {
      if (
        after.oauthAccounts.length === 0 &&
        after.refreshTokens.length === 0 &&
        after.passwordResetTokens.length === 0 &&
        after.emailVerificationTokens.length === 0 &&
        after.mobileWebHandoffTokens.length === 0 &&
        after.pushDeviceTokens.length === 0 &&
        !after.settings &&
        after.notifications.length === 0
      ) {
        pass("F-A03 refresh/reset/verify/OAuth/device satellites removed");
      } else fail("F-A03 satellites remain");

      if (
        after.passwordHash == null &&
        after.twoFactorSecret == null &&
        after.twoFactorTempSecret == null &&
        after.twoFactorEnabled === false
      ) {
        pass("F-A04 password/MFA secrets removed");
      } else fail("F-A04 secrets remain");

      if (after.email === tombstoneEmailForUserId(empUser.id)) {
        pass("F-A05 email replaced with tombstone");
      } else fail("F-A05 email not tombstoned");

      const expectedHash = computeEmailHash(normalizeEmailForHash(originalEmail));
      if (
        after.emailHash === expectedHash &&
        result.emailHashClassification === EMAIL_HASH_CLASSIFICATION &&
        EMAIL_HASH_CLASSIFICATION === "PSEUDONYMIZED"
      ) {
        pass("F-A06 emailHash retained and classified as PSEUDONYMIZED (not anonymous)");
      } else fail("F-A06 emailHash classification/hash mismatch");
    }

    const empAfter = await prisma.employee.findUnique({ where: { id: empId } });
    if (
      empAfter &&
      empAfter.name === FORMER_TEAM_MEMBER_NAME &&
      empAfter.phone == null &&
      empAfter.bio == null &&
      empAfter.avatar == null &&
      empAfter.slug == null &&
      empAfter.anonymizedAt
    ) {
      pass("F-A07 employee PII scrubbed");
    } else fail("F-A07 employee PII not scrubbed");

    if (empAfter) pass("F-A08 Employee row survives");
    else fail("F-A08 Employee row deleted");

    if (empAfter?.userId == null) pass("F-A13 Employee.userId becomes null");
    else fail("F-A13 Employee.userId still set");

    const tipAfter = await prisma.transaction.findUnique({ where: { id: tip.id } });
    if (tipAfter) pass("F-A09 Transaction rows survive");
    else fail("F-A09 Transaction deleted");

    if (tipAfter && Number(tipAfter.amount) === 17.25) pass("F-A10 tip amounts survive");
    else fail("F-A10 tip amount changed");

    const refundAfter = await prisma.tipRefund.findUnique({ where: { id: refund.id } });
    if (refundAfter && refundAfter.tipId === tip.id) pass("F-A11 TipRefund rows survive");
    else fail("F-A11 TipRefund missing");

    if (tipAfter && (tipAfter.employeeId === empId || tipAfter.employeeId == null)) {
      // Stub preferred: points at scrubbed employee
      if (tipAfter.employeeId === empId && empAfter?.name === FORMER_TEAM_MEMBER_NAME) {
        pass("F-A12 Transaction.employeeId points to non-identifying stub");
      } else if (tipAfter.employeeId == null) {
        pass("F-A12 Transaction.employeeId null");
      } else fail("F-A12 employeeId still identifying");
    } else fail("F-A12 tip employee link broken unexpectedly");

    if (storageCalls.includes(avatarUrl)) {
      pass("F-A14 avatar deletion invoked scoped storage helper path");
    } else fail("F-A14 avatar storage helper not called");

    // F-A17 / F-A18 legal hold
    try {
      await anonymizeUser(holdUser.id, {
        bypassExecutionGate: true,
        deleteStorageObject: deleteStorageOk,
        actorId: holdUser.id,
      });
      fail("F-A17 profile hold should block anonymization");
    } catch (e) {
      if (e instanceof AnonymizationError && e.code === "LEGAL_HOLD_CATEGORY") {
        pass("F-A17 legalHold category blocks relevant anonymization");
      } else fail(`F-A17 unexpected: ${e instanceof Error ? e.message : e}`);
    }
    const holdAfter = await prisma.user.findUnique({
      where: { id: holdUser.id },
      include: { refreshTokens: true, oauthAccounts: true },
    });
    if (
      holdAfter &&
      holdAfter.accountStatus === "erasure_pending" &&
      holdAfter.refreshTokens.length === 0 &&
      holdAfter.oauthAccounts.length === 0
    ) {
      pass("F-A18 unrelated auth satellites still terminate under legal hold");
    } else fail("F-A18 auth satellites not terminated under hold");

    // F-A19 audit structured metadata
    const audit = await prisma.auditLog.findFirst({
      where: { action: "user.anonymized" },
      orderBy: { createdAt: "desc" },
    });
    if (audit?.metadata) {
      const meta = JSON.parse(audit.metadata) as Record<string, unknown>;
      const hasStructured =
        typeof meta.actorId === "string" &&
        meta.resourceType === "user" &&
        typeof meta.resourceId === "string" &&
        typeof meta.timestamp === "string" &&
        typeof meta.result === "string";
      const hasPii =
        JSON.stringify(meta).includes(originalEmail) ||
        JSON.stringify(meta).includes("Slice FA Staff") ||
        JSON.stringify(meta).includes("+49123456789");
      if (hasStructured && !hasPii) pass("F-A19 audit event contains structured metadata only");
      else fail("F-A19 audit metadata invalid or contains PII");
    } else fail("F-A19 missing user.anonymized audit");

    // F-A20 audit failure does not claim success
    const auditFailUser = await prisma.user.create({
      data: {
        email: `slice-fa-audfail-${tag}@caretip-test.local`,
        passwordHash,
        role: "EMPLOYEE",
        accountStatus: "erasure_pending",
        isActive: false,
      },
    });
    userIds.push(auditFailUser.id);
    try {
      await anonymizeUser(auditFailUser.id, {
        bypassExecutionGate: true,
        deleteStorageObject: deleteStorageOk,
        actorId: "cm_nonexistent_audit_actor_fa000",
      });
      fail("F-A20 should fail when audit cannot be written");
    } catch (e) {
      const u = await prisma.user.findUnique({ where: { id: auditFailUser.id } });
      if (
        e instanceof AnonymizationError &&
        e.code === "AUDIT_FAILED" &&
        u?.accountStatus === "erasure_pending" &&
        u.email === `slice-fa-audfail-${tag}@caretip-test.local`
      ) {
        pass("F-A20 audit failure does not silently claim successful anonymization");
      } else {
        fail(`F-A20 unexpected state: ${e instanceof Error ? e.message : e}`);
      }
    }

    // F-A21 duplicate worker / idempotent re-run
    const r2 = await anonymizeUser(empUser.id, {
      bypassExecutionGate: true,
      deleteStorageObject: deleteStorageOk,
    });
    if (r2.alreadyComplete) pass("F-A21 duplicate worker execution is safe");
    else fail("F-A21 second run not idempotent");

    // F-A22 partial storage failure retryable
    const partialUser = await prisma.user.create({
      data: {
        email: `slice-fa-partial-${tag}@caretip-test.local`,
        passwordHash,
        role: "EMPLOYEE",
        accountStatus: "erasure_pending",
        isActive: false,
        employee: {
          create: {
            name: "Partial Staff",
            jobTitle: "Wait",
            avatar: `https://example.invalid/avatars/partial-fa-${tag}.png`,
            businessId: bizId,
            isActive: true,
            activationStatus: "active",
          },
        },
      },
      include: { employee: true },
    });
    userIds.push(partialUser.id);
    storageFailOnce = false;
    try {
      await anonymizeUser(partialUser.id, {
        bypassExecutionGate: true,
        deleteStorageObject: deleteStorageFailOnce,
        actorId: partialUser.id,
      });
      fail("F-A22 expected STORAGE_PENDING on first attempt");
    } catch (e) {
      if (!(e instanceof AnonymizationError) || e.code !== "STORAGE_PENDING") {
        fail(`F-A22 expected STORAGE_PENDING got ${e instanceof Error ? e.message : e}`);
      } else {
        const mid = await prisma.user.findUnique({ where: { id: partialUser.id } });
        if (mid && (mid.accountStatus === "closed" || mid.accountStatus === "anonymized")) {
          const retry = await anonymizeUser(partialUser.id, {
            bypassExecutionGate: true,
            deleteStorageObject: deleteStorageOk,
          });
          if (retry.alreadyComplete || retry.accountStatus === "closed") {
            pass("F-A22 partial failure is retryable");
          } else fail("F-A22 retry did not complete");
        } else fail("F-A22 DB anonymization should commit before storage retry");
      }
    }

    // F-A23 cross-tenant job refusal
    const evilJob = await prisma.dataLifecycleJob.create({
      data: {
        type: "anonymize_user",
        subjectType: "user",
        subjectId: otherUser.id,
        status: "pending",
        payload: { userId: empUser.id },
      },
    });
    // Subject is otherUser; payload forges empUser — processor must use subjectId only and refuse mismatch.
    const cross = await processAnonymizeLifecycleJob(evilJob.id, {
      bypassExecutionGate: true,
      deleteStorageObject: deleteStorageOk,
    });
    const otherStill = await prisma.user.findUnique({ where: { id: otherUser.id } });
    const empStillClosed = await prisma.user.findUnique({ where: { id: empUser.id } });
    if (
      cross.status === "failed" &&
      otherStill?.accountStatus === "erasure_pending" &&
      empStillClosed?.accountStatus === "closed"
    ) {
      pass("F-A23 cross-tenant job cannot anonymize another user's data");
    } else {
      // If implementation ignores forged payload and anonymizes subject (otherUser), that is also tenant-safe.
      if (otherStill?.accountStatus === "closed" && empStillClosed?.accountStatus === "closed") {
        pass("F-A23 subjectId authoritative (forged payload ignored) — tenant safe");
      } else fail("F-A23 cross-tenant isolation failed");
    }

    // F-A24 cannot authenticate
    if (
      after &&
      !userMayAuthenticate(after) &&
      !userMayAuthenticate({ isActive: false, accountStatus: "closed" })
    ) {
      pass("F-A24 anonymized user cannot authenticate");
    } else fail("F-A24 auth gate failed");

    // F-A25 cannot request DSAR export
    try {
      await createDsarExportJob(empUser.id);
      fail("F-A25 DSAR create should deny anonymized/closed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/anonymized|closed|not available|DENIED/i.test(msg) || (e as { code?: string }).code === "DENIED_STATUS") {
        pass("F-A25 anonymized user cannot request DSAR export");
      } else fail(`F-A25 unexpected DSAR error: ${msg}`);
    }

    // F-A26 financial/business intact
    const biz = await prisma.business.findUnique({ where: { id: bizId } });
    const tipCount = await prisma.transaction.count({ where: { businessId: bizId } });
    const refundCount = await prisma.tipRefund.count({ where: { businessId: bizId } });
    if (biz && tipCount >= 1 && refundCount >= 1 && Number(tipAfter?.amount) === 17.25) {
      pass("F-A26 financial/business records remain intact after anonymization");
    } else fail("F-A26 financial/business integrity failed");

    // Goals/activation gone; feedback scrubbed
    const goals = await prisma.employeeGoal.count({ where: { employeeId: empId } });
    const acts = await prisma.employeeActivationToken.count({ where: { employeeId: empId } });
    const fb = await prisma.tipFeedback.findFirst({ where: { employeeId: empId } });
    if (goals === 0 && acts === 0 && fb?.customerName == null && fb?.comment == null) {
      pass("employee goals/tokens removed and guest feedback fields scrubbed");
    } else fail("employee satellite scrub incomplete");

    // Job enqueue + tick gate when flags off
    process.env.DATA_LIFECYCLE_ANONYMIZATION_EXECUTE = "false";
    const gated = await tickAnonymizationJobs(5);
    if (gated.gated && gated.processed === 0) {
      pass("tickAnonymizationJobs fail-closed when execution flag off");
    } else fail("tick should be gated when flag off");
    process.env.DATA_LIFECYCLE_ANONYMIZATION_EXECUTE = "true";

    // Successful job path (platform-authorized user already closed — enqueue duplicate-safe)
    const { jobId } = await enqueueAnonymizeUserJob(empUser.id);
    const processed = await processAnonymizeLifecycleJob(jobId, {
      bypassExecutionGate: true,
      deleteStorageObject: deleteStorageOk,
    });
    if (processed.status === "succeeded") pass("anonymize_user job idempotent succeed");
    else fail(`job status ${processed.status}`);

    // Standalone anonymizeEmployee idempotency
    const empOnly = await anonymizeEmployee(empId, {
      bypassExecutionGate: true,
      deleteStorageObject: deleteStorageOk,
    });
    if (empOnly.alreadyComplete && empOnly.tipCount >= 1) {
      pass("anonymizeEmployee idempotent; tips preserved");
    } else fail("anonymizeEmployee idempotency failed");
  } finally {
    // Cleanup fixtures (order matters for Restrict FKs)
    await prisma.dataLifecycleJob.deleteMany({
      where: { subjectId: { in: [...userIds, empId] } },
    }).catch(() => undefined);
    await prisma.tipFeedback.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.tipRefund.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.businessActivityEvent.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.transaction.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.employeeGoal.deleteMany({ where: { employee: { businessId: { in: bizIds } } } }).catch(() => undefined);
    await prisma.employeeActivationToken.deleteMany({
      where: { employee: { businessId: { in: bizIds } } },
    }).catch(() => undefined);
    await prisma.employeeTableAssignment.deleteMany({
      where: { employee: { businessId: { in: bizIds } } },
    }).catch(() => undefined);
    await prisma.employee.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.business.deleteMany({ where: { id: { in: bizIds } } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.pushDeviceToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.mobileWebHandoffToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.oAuthAccount.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.userSettings.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({
      where: { action: { in: ["user.anonymized", "employee.anonymized", "user.erasure_anonymization_started", "employee.erasure_anonymization_started", "business.ownership_transferred"] } },
    }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  }

  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) console.log(line);
  console.log(`\nSlice F-A: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
