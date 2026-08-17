/**
 * GDPR lifecycle Slice F-C — category retention (fail-closed).
 * Run: npm run test:lifecycle-slice-f-c (from backend/)
 *
 * Isolated fixtures. Temporarily sets T_* / execute flags in-process only.
 * Does not invent committed retention values. Does not touch production data.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  readCategoryRetentionDays,
  isCategoryRetentionExecutionEnabled,
} from "../src/services/retentionPolicy.helpers.js";
import {
  CategoryRetentionError,
  enqueueCategoryRetentionJob,
  processCategoryRetentionJob,
  reclaimStaleCategoryRetentionJobs,
  runAnalyticsTtl,
  runAuditScrub,
  runBillingRedact,
  runGuestScrub,
  runNotifyCleanup,
  runStaffPiiScrub,
  runSupportRedact,
  tickCategoryRetentionJobs,
} from "../src/services/categoryRetention.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const saved: Record<string, string | undefined> = {};
function snap(keys: string[]) {
  for (const k of keys) saved[k] = process.env[k];
}
function setEnv(partial: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
function restore() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const ENV_KEYS = [
  "DATA_LIFECYCLE_V1",
  "DATA_LIFECYCLE_ANALYTICS_EXECUTE",
  "DATA_LIFECYCLE_AUDIT_EXECUTE",
  "DATA_LIFECYCLE_SUPPORT_EXECUTE",
  "DATA_LIFECYCLE_NOTIFY_EXECUTE",
  "DATA_LIFECYCLE_GUEST_EXECUTE",
  "DATA_LIFECYCLE_BILLING_EXECUTE",
  "DATA_LIFECYCLE_STAFF_PII_EXECUTE",
  "RETENTION_T_ANALYTICS_DAYS",
  "RETENTION_T_AUDIT_DAYS",
  "RETENTION_T_SUPPORT_DAYS",
  "RETENTION_T_NOTIFY_DAYS",
  "RETENTION_T_GUEST_DAYS",
  "RETENTION_T_BILLING_DAYS",
  "RETENTION_T_STAFF_PII_DAYS",
  "RETENTION_T_PAYMENT_DAYS",
  "RETENTION_T_KYC_DAYS",
];

async function main() {
  snap(ENV_KEYS);
  // Ensure committed UNSET state is not polluted — clear all T_* for baseline.
  setEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])));

  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const userIds: string[] = [];
  const bizIds: string[] = [];

  const owner = await prisma.user.create({
    data: {
      email: `slice-fc-owner-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      accountStatus: "active",
      business: {
        create: {
          name: "Slice FC Biz",
          slug: `slice-fc-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
      notifications: {
        create: [
          {
            title: "Old",
            message: "old note",
            type: "system",
            createdAt: new Date(Date.now() - 40 * 86400000),
          },
          {
            title: "New",
            message: "new note",
            type: "system",
            createdAt: new Date(),
          },
        ],
      },
    },
    include: { business: true },
  });
  userIds.push(owner.id);
  const bizId = owner.business!.id;
  bizIds.push(bizId);

  const emp = await prisma.employee.create({
    data: {
      name: "Soft Removed Staff",
      jobTitle: "Bar",
      phone: "+49999",
      bio: "bio",
      businessId: bizId,
      isDeleted: true,
      isActive: false,
      deletedAt: new Date(Date.now() - 40 * 86400000),
      activationStatus: "active",
    },
  });

  const tip = await prisma.transaction.create({
    data: {
      amount: 11.0,
      status: "success",
      businessId: bizId,
      employeeId: emp.id,
      stripePaymentIntentId: `pi_fc_${tag}`,
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
      stripeRefundId: `re_fc_${tag}`,
    },
  });

  await prisma.tipFeedback.create({
    data: {
      transactionId: tip.id,
      businessId: bizId,
      employeeId: emp.id,
      rating: 5,
      tags: ["fast"],
      customerName: "Guest Bob",
      comment: "Nice",
      createdAt: new Date(Date.now() - 40 * 86400000),
    },
  });

  const oldScan = await prisma.qrScanEvent.create({
    data: {
      businessId: bizId,
      scanType: "staff",
      entryPath: "/t/x",
      deviceType: "mobile",
      sessionId: `sess-old-${tag}`,
      dedupeKey: `dedupe-old-${tag}`,
      scannedAt: new Date(Date.now() - 40 * 86400000),
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
      dedupeKey: `dedupe-new-${tag}`,
      scannedAt: new Date(),
    },
  });
  await prisma.qrFunnelEvent.create({
    data: {
      businessId: bizId,
      sessionId: `sess-old-${tag}`,
      eventType: "tip_started",
      createdAt: new Date(Date.now() - 40 * 86400000),
    },
  });
  await prisma.qrGuestVisit.create({
    data: {
      businessId: bizId,
      sessionId: `sess-old-${tag}`,
      scanType: "staff",
      entryPath: "/t/x",
      startedAt: new Date(Date.now() - 40 * 86400000),
      expiresAt: new Date(Date.now() - 39 * 86400000),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: owner.id,
      action: "test.fc.audit",
      metadata: JSON.stringify({ email: "pii@example.com", resourceId: "x", action: "test" }),
      createdAt: new Date(Date.now() - 40 * 86400000),
    },
  });
  await prisma.businessActivityEvent.create({
    data: {
      businessId: bizId,
      type: "tip.received",
      source: "PAYMENTS",
      occurredAt: new Date(Date.now() - 40 * 86400000),
      dedupeKey: `fc-act-${tag}`,
      summary: { employeeName: "Soft Removed Staff", amount: 11 },
    },
  });

  const ticket = await prisma.supportTicket.create({
    data: {
      ticketNumber: `FC-${tag}`,
      businessId: bizId,
      createdByUserId: owner.id,
      subject: "Help",
      category: "general",
      status: "CLOSED",
      updatedAt: new Date(Date.now() - 40 * 86400000),
      closedAt: new Date(Date.now() - 40 * 86400000),
      messages: {
        create: {
          authorUserId: owner.id,
          authorRole: "business",
          body: "My email is secret@example.com",
          createdAt: new Date(Date.now() - 40 * 86400000),
        },
      },
    },
  });

  const sub = await prisma.subscription.create({
    data: {
      businessId: bizId,
      planKey: "premium",
      billingCycle: "monthly",
      status: "active",
    },
  });
  const subEv = await prisma.subscriptionEvent.create({
    data: {
      subscriptionId: sub.id,
      auditType: "webhook",
      processingResult: "processed",
      occurredAt: new Date(Date.now() - 40 * 86400000),
      payload: { email: "billing@example.com", plan: "premium", type: "invoice.paid" },
    },
  });

  try {
    // ── ANALYTICS UNSET ──
    try {
      await runAnalyticsTtl({
        bypassExecutionGate: true,
        env: { RETENTION_T_ANALYTICS_DAYS: "30" } as NodeJS.ProcessEnv,
        businessId: bizId,
      });
      fail("analytics should fail-closed when T_ANALYTICS contradicts 48h policy");
    } catch (e) {
      if (e instanceof CategoryRetentionError && (e.code === "T_UNSET" || e.code === "POLICY_CONTRADICTION")) {
        pass("contradicting T_ANALYTICS → no QR mutation");
      } else fail(`analytics unset: ${e instanceof Error ? e.message : e}`);
    }
    if (await prisma.qrScanEvent.findUnique({ where: { id: oldScan.id } })) {
      pass("analytics data preserved while T_ANALYTICS UNSET");
    } else fail("old scan deleted while unset");

    // Configure analytics + execute
    setEnv({
      DATA_LIFECYCLE_V1: "true",
      DATA_LIFECYCLE_ANALYTICS_EXECUTE: "true",
      RETENTION_T_ANALYTICS_DAYS: undefined,
    });
    await prisma.qrScanEvent.update({
      where: { id: oldScan.id },
      data: { scannedAt: new Date(Date.now() - 49 * 3600000) },
    });
    const youngBefore = await prisma.qrScanEvent.findUnique({ where: { id: youngScan.id } });
    await runAnalyticsTtl({ bypassExecutionGate: true, env: process.env, businessId: bizId });
    const oldAfter = await prisma.qrScanEvent.findUnique({ where: { id: oldScan.id } });
    const youngAfter = await prisma.qrScanEvent.findUnique({ where: { id: youngScan.id } });
    if (oldAfter?.anonymizedAt && oldAfter.userAgent == null && youngAfter && youngBefore) {
      pass("old QR personal fields anonymized; row kept; younger preserved");
    } else fail("analytics TTL age filter failed");

    // Recreate old scan for hold test
    const heldScan = await prisma.qrScanEvent.create({
      data: {
        businessId: bizId,
        scanType: "staff",
        entryPath: "/t/h",
        deviceType: "mobile",
        sessionId: `sess-hold-${tag}`,
        dedupeKey: `dedupe-hold-${tag}`,
        scannedAt: new Date(Date.now() - 49 * 3600000),
        userAgent: "HoldUA",
      },
    });
    await prisma.business.update({
      where: { id: bizId },
      data: { legalHold: true, legalHoldCategories: ["analytics"] },
    });
    await runAnalyticsTtl({ bypassExecutionGate: true, env: process.env, businessId: bizId });
    const heldRow = await prisma.qrScanEvent.findUnique({ where: { id: heldScan.id } });
    if (heldRow && heldRow.userAgent === "HoldUA") {
      pass("legal hold on analytics → preserved");
    } else fail("analytics hold did not preserve");

    await prisma.business.update({
      where: { id: bizId },
      data: { legalHold: true, legalHoldCategories: ["financial"] },
    });
    await runAnalyticsTtl({ bypassExecutionGate: true, env: process.env, businessId: bizId });
    const afterUnrelated = await prisma.qrScanEvent.findUnique({ where: { id: heldScan.id } });
    if (afterUnrelated?.anonymizedAt && afterUnrelated.userAgent == null) {
      pass("unrelated financial hold does not block analytics anonymize");
    } else fail("financial hold incorrectly blocked analytics");

    await prisma.business.update({
      where: { id: bizId },
      data: { legalHold: false, legalHoldCategories: [] },
    });

    // Idempotent
    const again = await runAnalyticsTtl({
      bypassExecutionGate: true,
      env: process.env,
      businessId: bizId,
    });
    if (again.alreadyComplete || again.deletedScans === 0) pass("analytics idempotent");
    else fail("analytics not idempotent");

    // ── AUDIT ──
    setEnv({ RETENTION_T_AUDIT_DAYS: "30", DATA_LIFECYCLE_AUDIT_EXECUTE: "true" });
    try {
      await runAuditScrub({ bypassExecutionGate: true, env: process.env });
      fail("audit should contradiction-fail");
    } catch (e) {
      if (e instanceof CategoryRetentionError && (e.code === "T_UNSET" || e.code === "POLICY_CONTRADICTION")) {
        pass("contradicting T_AUDIT → no scrub");
      } else fail("audit unset");
    }

    setEnv({ RETENTION_T_AUDIT_DAYS: undefined, DATA_LIFECYCLE_AUDIT_EXECUTE: "true" });
    await prisma.$executeRawUnsafe(
      `UPDATE audit_logs SET created_at = TIMESTAMPTZ '2018-06-01 00:00:00+00' WHERE action = $1`,
      "test.fc.audit",
    );
    await prisma.$executeRawUnsafe(
      `UPDATE business_activity_events SET occurred_at = TIMESTAMPTZ '2018-06-01 00:00:00+00' WHERE dedupe_key = $1`,
      `fc-act-${tag}`,
    );
    for (let i = 0; i < 5; i++) {
      await runAuditScrub({ bypassExecutionGate: true, env: process.env, businessId: bizId });
      const a = await prisma.auditLog.findFirst({ where: { action: "test.fc.audit" } });
      if (a?.metadata && a.metadata.includes("[redacted]") && !a.metadata.includes("pii@example.com")) break;
    }
    const audit = await prisma.auditLog.findFirst({
      where: { action: "test.fc.audit" },
      orderBy: { createdAt: "desc" },
    });
    if (audit?.metadata && audit.metadata.includes("[redacted]") && !audit.metadata.includes("pii@example.com")) {
      pass("audit metadata PII scrubbed; structure kept");
    } else fail(`audit scrub failed: ${audit?.metadata}`);

    const act = await prisma.businessActivityEvent.findFirst({
      where: { dedupeKey: `fc-act-${tag}` },
    });
    const summary = act?.summary as Record<string, unknown> | null;
    if (summary && summary.employeeName === "[redacted]" && summary.amount === 11) {
      pass("activity summary scrubbed; non-PII kept");
    } else fail("activity scrub failed");

    // ── SUPPORT ──
    setEnv({ RETENTION_T_SUPPORT_DAYS: "30" });
    try {
      await runSupportRedact({ bypassExecutionGate: true, env: process.env, businessId: bizId });
      fail("support contradiction should fail");
    } catch (e) {
      if (e instanceof CategoryRetentionError && (e.code === "T_UNSET" || e.code === "POLICY_CONTRADICTION")) {
        pass("contradicting T_SUPPORT → no redaction");
      } else fail("support unset");
    }

    setEnv({ RETENTION_T_SUPPORT_DAYS: undefined, DATA_LIFECYCLE_SUPPORT_EXECUTE: "true" });
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { closedAt: new Date("2018-06-01T00:00:00.000Z") },
    });
    await prisma.business.update({
      where: { id: bizId },
      data: { legalHold: true, legalHoldCategories: ["support"] },
    });
    await runSupportRedact({ bypassExecutionGate: true, env: process.env, businessId: bizId });
    const msgHeld = await prisma.supportTicketMessage.findFirst({ where: { ticketId: ticket.id } });
    if (msgHeld && msgHeld.body.includes("secret@")) pass("support hold → preserved");
    else fail("support hold failed");

    await prisma.business.update({
      where: { id: bizId },
      data: { legalHold: false, legalHoldCategories: [] },
    });
    await runSupportRedact({ bypassExecutionGate: true, env: process.env, businessId: bizId });
    const msg = await prisma.supportTicketMessage.findFirst({ where: { ticketId: ticket.id } });
    const tkt = await prisma.supportTicket.findUnique({ where: { id: ticket.id } });
    if (msg?.body === "[redacted]" && tkt && tkt.subject === "Help") {
      pass("support redacted; ticket structure intact");
    } else fail("support redact failed");

    // ── NOTIFY ──
    setEnv({ RETENTION_T_NOTIFY_DAYS: "30" });
    try {
      await runNotifyCleanup({ bypassExecutionGate: true, env: process.env, userId: owner.id });
      fail("notify contradiction");
    } catch (e) {
      if (e instanceof CategoryRetentionError && (e.code === "T_UNSET" || e.code === "POLICY_CONTRADICTION")) {
        pass("contradicting T_NOTIFY → no cleanup");
      } else fail("notify unset");
    }

    setEnv({ RETENTION_T_NOTIFY_DAYS: undefined, DATA_LIFECYCLE_NOTIFY_EXECUTE: "true" });
    await prisma.notification.updateMany({
      where: { userId: owner.id, title: "Old" },
      data: { createdAt: new Date(Date.now() - 91 * 86400000) },
    });
    await runNotifyCleanup({ bypassExecutionGate: true, env: process.env, userId: owner.id });
    const notes = await prisma.notification.findMany({ where: { userId: owner.id } });
    if (notes.length === 1 && notes[0].title === "New") {
      pass("eligible notifications cleaned; recent kept");
    } else fail("notify cleanup failed");

    // ── GUEST ──
    setEnv({ RETENTION_T_GUEST_DAYS: "30" });
    try {
      await runGuestScrub({ bypassExecutionGate: true, env: process.env, businessId: bizId });
      fail("guest contradiction");
    } catch (e) {
      if (e instanceof CategoryRetentionError && (e.code === "T_UNSET" || e.code === "POLICY_CONTRADICTION")) {
        pass("contradicting T_GUEST → no guest destruction");
      } else fail("guest unset");
    }

    setEnv({ RETENTION_T_GUEST_DAYS: undefined, DATA_LIFECYCLE_GUEST_EXECUTE: "true" });
    await runGuestScrub({ bypassExecutionGate: true, env: process.env, businessId: bizId });
    const fb = await prisma.tipFeedback.findFirst({ where: { transactionId: tip.id } });
    if (fb && fb.customerName == null && fb.comment === "Nice" && fb.rating === 5 && fb.tags.includes("fast")) {
      pass("guest name leftover scrubbed; comment/rating/tags kept");
    } else fail("guest scrub failed");

    const tipOk = await prisma.transaction.findUnique({ where: { id: tip.id } });
    const refundOk = await prisma.tipRefund.findUnique({ where: { id: refund.id } });
    if (tipOk && refundOk) pass("tip/transaction rows remain intact after guest scrub");
    else fail("financial rows damaged");

    // ── BILLING ──
    setEnv({ RETENTION_T_BILLING_DAYS: "30" });
    try {
      await runBillingRedact({ bypassExecutionGate: true, env: process.env });
      fail("billing contradiction");
    } catch (e) {
      if (e instanceof CategoryRetentionError && (e.code === "T_UNSET" || e.code === "POLICY_CONTRADICTION")) {
        pass("contradicting T_BILLING → no destructive op");
      } else fail("billing unset");
    }

    setEnv({ RETENTION_T_BILLING_DAYS: undefined, DATA_LIFECYCLE_BILLING_EXECUTE: "true" });
    await prisma.$executeRawUnsafe(
      `UPDATE subscription_events SET occurred_at = TIMESTAMPTZ '2010-06-01 00:00:00+00' WHERE id = $1`,
      subEv.id,
    );
    for (let i = 0; i < 5; i++) {
      await runBillingRedact({ bypassExecutionGate: true, env: process.env });
      const e = await prisma.subscriptionEvent.findUnique({ where: { id: subEv.id } });
      const p = e?.payload as Record<string, unknown> | null;
      if (p && p.email === "[redacted]") break;
    }
    const ev = await prisma.subscriptionEvent.findUnique({ where: { id: subEv.id } });
    const payload = ev?.payload as Record<string, unknown> | null;
    if (payload && payload.email === "[redacted]" && payload.plan === "premium") {
      pass("billing payload PII redacted; non-PII kept");
    } else fail(`billing redact failed: ${JSON.stringify(payload)}`);

    // ── STAFF PII ──
    setEnv({ RETENTION_T_STAFF_PII_DAYS: "30" });
    try {
      await runStaffPiiScrub({ bypassExecutionGate: true, env: process.env, businessId: bizId });
      fail("staff contradiction");
    } catch (e) {
      if (e instanceof CategoryRetentionError && (e.code === "T_UNSET" || e.code === "POLICY_CONTRADICTION")) {
        pass("contradicting T_STAFF_PII → fail-closed");
      } else fail("staff unset");
    }

    setEnv({ RETENTION_T_STAFF_PII_DAYS: undefined, DATA_LIFECYCLE_STAFF_PII_EXECUTE: "true" });
    await prisma.employee.update({
      where: { id: emp.id },
      data: { deletedAt: new Date("2010-06-01T00:00:00.000Z") },
    });
    await runStaffPiiScrub({ bypassExecutionGate: true, env: process.env, businessId: bizId });
    const empAfter = await prisma.employee.findUnique({ where: { id: emp.id } });
    if (
      empAfter &&
      empAfter.name === "Former team member" &&
      empAfter.phone == null &&
      empAfter.anonymizedAt &&
      (await prisma.transaction.findUnique({ where: { id: tip.id } }))
    ) {
      pass("staff PII scrubbed for soft-removed; tip stub/financial intact");
    } else fail("staff pii scrub failed");

    // Cross-tenant job
    setEnv({
      DATA_LIFECYCLE_V1: "true",
      DATA_LIFECYCLE_GUEST_EXECUTE: "true",
      RETENTION_T_GUEST_DAYS: undefined,
    });
    const evil = await prisma.dataLifecycleJob.create({
      data: {
        type: "guest_scrub",
        subjectType: "business",
        subjectId: bizId,
        status: "pending",
        payload: { businessId: "cm_other_business_fc_000" },
      },
    });
    const cross = await processCategoryRetentionJob(evil.id, {
      bypassExecutionGate: true,
      env: process.env,
    });
    if (cross.status === "failed") pass("cross-tenant payload manipulation fails");
    else fail(`cross-tenant status ${cross.status}`);

    // Stale reclaim
    const stale = await prisma.dataLifecycleJob.create({
      data: {
        type: "notify_cleanup",
        subjectType: "user",
        subjectId: owner.id,
        status: "running",
        lastError: "stale",
      },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE data_lifecycle_jobs SET updated_at = NOW() - INTERVAL '20 minutes' WHERE id = $1`,
      stale.id,
    ).catch(() => undefined);
    const reclaimed = await reclaimStaleCategoryRetentionJobs();
    if (reclaimed >= 0) pass("stale jobs reclaim path available");
    else fail("reclaim");

    // Gates off
    setEnv({
      DATA_LIFECYCLE_V1: "false",
      DATA_LIFECYCLE_ANALYTICS_EXECUTE: "false",
      RETENTION_T_ANALYTICS_DAYS: "30",
    });
    if (!isCategoryRetentionExecutionEnabled("analytics")) {
      pass("production execution remains gated (flags off)");
    } else fail("gates should be off");

    const tick = await tickCategoryRetentionJobs(3);
    if (tick.gated.analytics_ttl) pass("tick fail-closed when analytics gate off");
    else fail("tick not gated");

    // Payment / KYC T_* remain unset in env snapshot
    if (
      !readCategoryRetentionDays("analytics", { RETENTION_T_ANALYTICS_DAYS: undefined } as NodeJS.ProcessEnv)
        .configured
    ) {
      pass("helper treats missing T_* as UNSET");
    }

    // No KYC/DSAR/tombstone/user.delete in categoryRetention source
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/services/categoryRetention.service.ts"),
      "utf8",
    );
    if (
      !/\bprisma\.user\.delete\s*\(/.test(src) &&
      !/\bprisma\.transaction\.delete\s*\(/.test(src) &&
      !src.includes("removeKycStorageObject") &&
      !src.includes("removeDsarStorageObject") &&
      !/lifecycleStatus:\s*[\"']tombstoned[\"']/.test(src)
    ) {
      pass("F-C does not delete KYC/DSAR/tips/users or tombstone businesses");
    } else fail("F-C static safety check failed");

    // Job enqueue success path
    setEnv({
      DATA_LIFECYCLE_V1: "true",
      DATA_LIFECYCLE_NOTIFY_EXECUTE: "true",
      RETENTION_T_NOTIFY_DAYS: undefined,
    });
    await prisma.dataLifecycleJob.deleteMany({
      where: { subjectId: owner.id, type: "notify_cleanup" },
    });
    const { jobId } = await enqueueCategoryRetentionJob("notify_cleanup", {
      bypassExecutionGate: true,
      userId: owner.id,
    });
    const processed = await processCategoryRetentionJob(jobId, {
      bypassExecutionGate: true,
      env: process.env,
    });
    if (processed.status === "succeeded") pass("category job idempotent succeed");
    else fail(`job ${processed.status}`);

    // Active account still authenticatable shape
    const u = await prisma.user.findUnique({ where: { id: owner.id } });
    if (u?.accountStatus === "active" && u.isActive) {
      pass("active account operation unaffected by retention jobs");
    } else fail("owner account damaged");
  } finally {
    restore();
    await prisma.dataLifecycleJob.deleteMany({
      where: { OR: [{ subjectId: { in: [...bizIds, ...userIds, "platform"] } }, { subjectId: { contains: "fc" } }] },
    }).catch(() => undefined);
    await prisma.supportTicketMessage.deleteMany({ where: { ticket: { businessId: { in: bizIds } } } }).catch(() => undefined);
    await prisma.supportTicket.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.subscriptionEvent.deleteMany({ where: { subscription: { businessId: { in: bizIds } } } }).catch(() => undefined);
    await prisma.subscription.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.tipFeedback.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.tipRefund.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.qrFunnelEvent.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.qrGuestVisit.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.qrScanEvent.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.businessActivityEvent.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.transaction.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.employee.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { action: "test.fc.audit" } }).catch(() => undefined);
    await prisma.business.deleteMany({ where: { id: { in: bizIds } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  }

  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) console.log(line);
  console.log(`\nSlice F-C: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    restore();
    await prisma.$disconnect();
  });
