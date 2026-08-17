/**
 * Category retention sweep / enqueue tests (isolated fixtures).
 * Run: npm run test:category-retention-sweep (from backend/)
 *
 * Does not enable production EXECUTE flags. Does not reset the database.
 * Enqueue-mode sweeps are restricted to fixture ids so production jobs are not created.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { categoryHoldDecision, shouldSkipForHold } from "../src/services/retentionPolicy.helpers.js";
import { sweepCategoryRetention } from "../src/services/categoryRetentionSweep.service.js";
import { sweepKycSecureDestroy } from "../src/services/kycDestroySweep.service.js";
import { sweepBusinessTombstone, tickBusinessTombstoneJobs } from "../src/services/businessTombstoneSweep.service.js";
import { processCategoryRetentionJob, tickCategoryRetentionJobs } from "../src/services/categoryRetention.service.js";
import { buildKycDiskStorageRef } from "../src/lib/kycStorageReference.js";

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
  "DATA_LIFECYCLE_DRY_RUN",
  "DATA_LIFECYCLE_ANALYTICS_EXECUTE",
  "DATA_LIFECYCLE_AUDIT_EXECUTE",
  "DATA_LIFECYCLE_SUPPORT_EXECUTE",
  "DATA_LIFECYCLE_NOTIFY_EXECUTE",
  "DATA_LIFECYCLE_GUEST_EXECUTE",
  "DATA_LIFECYCLE_BILLING_EXECUTE",
  "DATA_LIFECYCLE_STAFF_PII_EXECUTE",
  "DATA_LIFECYCLE_KYC_DESTROY_EXECUTE",
  "DATA_LIFECYCLE_TOMBSTONE_EXECUTE",
  "DATA_LIFECYCLE_ANONYMIZATION_EXECUTE",
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function countJobs() {
  return prisma.dataLifecycleJob.count();
}

async function main() {
  snap(ENV_KEYS);
  setEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])));

  const jobsAtStart = await countJobs();
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const userIds: string[] = [];
  const bizIds: string[] = [];
  const now = new Date("2026-08-17T12:00:00.000Z");

  const mkUser = async (label: string, extra?: { legalHold?: boolean; legalHoldCategories?: string[] }) => {
    const u = await prisma.user.create({
      data: {
        email: `sweep-${label}-${tag}@caretip-test.local`,
        passwordHash,
        role: "MANAGER",
        emailVerified: true,
        accountStatus: "active",
        legalHold: extra?.legalHold ?? false,
        legalHoldCategories: extra?.legalHoldCategories ?? [],
        business: {
          create: {
            name: `Sweep ${label}`,
            slug: `sweep-${label}-${tag}`,
            verificationStatus: "verified",
            subscriptionTier: "premium",
            legalHold: extra?.legalHold ?? false,
            legalHoldCategories: extra?.legalHoldCategories ?? [],
          },
        },
      },
      include: { business: true },
    });
    userIds.push(u.id);
    bizIds.push(u.business!.id);
    return { user: u, bizId: u.business!.id };
  };

  const a = await mkUser("a");
  const b = await mkUser("b");
  const heldEmpty = await mkUser("held-empty", { legalHold: true, legalHoldCategories: [] });
  const heldAnalytics = await mkUser("held-analytics", { legalHold: true, legalHoldCategories: ["analytics"] });

  const empA = await prisma.employee.create({
    data: {
      name: "Sweep Staff A",
      jobTitle: "Bar",
      businessId: a.bizId,
      isDeleted: true,
      isActive: false,
      deletedAt: new Date("2015-06-01T00:00:00.000Z"),
      activationStatus: "active",
    },
  });
  await prisma.employee.create({
    data: {
      name: "Sweep Staff Recent",
      jobTitle: "Bar",
      businessId: a.bizId,
      isDeleted: true,
      isActive: false,
      deletedAt: new Date("2016-06-01T00:00:00.000Z"),
      activationStatus: "active",
    },
  });

  const tip = await prisma.transaction.create({
    data: {
      amount: 12.5,
      status: "success",
      businessId: a.bizId,
      employeeId: empA.id,
      stripePaymentIntentId: `pi_sweep_${tag}`,
    },
  });
  const refund = await prisma.tipRefund.create({
    data: {
      businessId: a.bizId,
      tipId: tip.id,
      kind: "refund",
      status: "succeeded",
      amountEur: 1,
      occurredAt: now,
      stripeRefundId: `re_sweep_${tag}`,
    },
  });
  const financialSnap = {
    tipAmount: String(tip.amount),
    tipPi: tip.stripePaymentIntentId,
    refundId: refund.stripeRefundId,
    refundAmount: String(refund.amountEur),
  };

  await prisma.tipFeedback.create({
    data: {
      transactionId: tip.id,
      businessId: a.bizId,
      employeeId: empA.id,
      rating: 5,
      tags: ["fast"],
      customerName: "Sweep Guest",
    },
  });
  const tipB = await prisma.transaction.create({
    data: {
      amount: 3,
      status: "success",
      businessId: b.bizId,
      stripePaymentIntentId: `pi_sweep_b_${tag}`,
    },
  });
  await prisma.tipFeedback.create({
    data: {
      transactionId: tipB.id,
      businessId: b.bizId,
      rating: 4,
      tags: [],
      customerName: "Other Guest",
    },
  });

  const oldScanA = await prisma.qrScanEvent.create({
    data: {
      businessId: a.bizId,
      scanType: "staff",
      entryPath: "/t/a",
      deviceType: "mobile",
      sessionId: `sweep-old-a-${tag}`,
      dedupeKey: `sweep-old-a-${tag}`,
      scannedAt: new Date(now.getTime() - 49 * 3600000),
      userAgent: "SweepUA",
    },
  });
  await prisma.qrScanEvent.create({
    data: {
      businessId: a.bizId,
      scanType: "staff",
      entryPath: "/t/a-young",
      deviceType: "mobile",
      sessionId: `sweep-young-a-${tag}`,
      dedupeKey: `sweep-young-a-${tag}`,
      scannedAt: now,
    },
  });
  await prisma.qrScanEvent.create({
    data: {
      businessId: b.bizId,
      scanType: "staff",
      entryPath: "/t/b",
      deviceType: "mobile",
      sessionId: `sweep-old-b-${tag}`,
      dedupeKey: `sweep-old-b-${tag}`,
      scannedAt: new Date(now.getTime() - 49 * 3600000),
    },
  });
  await prisma.qrScanEvent.create({
    data: {
      businessId: heldEmpty.bizId,
      scanType: "staff",
      entryPath: "/t/h",
      deviceType: "mobile",
      sessionId: `sweep-held-empty-${tag}`,
      dedupeKey: `sweep-held-empty-${tag}`,
      scannedAt: new Date(now.getTime() - 49 * 3600000),
    },
  });
  await prisma.qrScanEvent.create({
    data: {
      businessId: heldAnalytics.bizId,
      scanType: "staff",
      entryPath: "/t/ha",
      deviceType: "mobile",
      sessionId: `sweep-held-an-${tag}`,
      dedupeKey: `sweep-held-an-${tag}`,
      scannedAt: new Date(now.getTime() - 49 * 3600000),
    },
  });

  await prisma.notification.create({
    data: {
      userId: a.user.id,
      title: "Old",
      message: "old",
      type: "system",
      createdAt: new Date(now.getTime() - 100 * 86400000),
    },
  });
  await prisma.notification.create({
    data: {
      userId: a.user.id,
      title: "New",
      message: "new",
      type: "system",
      createdAt: now,
    },
  });

  const kycBiz = await prisma.user.create({
    data: {
      email: `sweep-kyc-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      accountStatus: "active",
      business: {
        create: {
          name: "Sweep KYC",
          slug: `sweep-kyc-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
          lifecycleStatus: "soft_closed",
          deletedAt: new Date("2010-06-01T00:00:00.000Z"),
          taxId: "DE-SWEEP-TAX",
          stripeAccountId: `acct_sweep_${tag}`,
        },
      },
    },
    include: { business: true },
  });
  userIds.push(kycBiz.id);
  bizIds.push(kycBiz.business!.id);
  const kycDisk = buildKycDiskStorageRef(`uploads/kyc/${kycBiz.business!.id}/doc.pdf`);
  await prisma.business.update({
    where: { id: kycBiz.business!.id },
    data: { verificationDocumentPath: kycDisk },
  });

  const tombBiz = await prisma.user.create({
    data: {
      email: `sweep-tomb-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      accountStatus: "active",
      business: {
        create: {
          name: "Sweep Tomb",
          slug: `sweep-tomb-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
          lifecycleStatus: "soft_closed",
          deletedAt: new Date(now.getTime() - 40 * 86400000),
          logoPath: "/logo/x.png",
          welcomeMessage: "Hi",
        },
      },
    },
    include: { business: true },
  });
  userIds.push(tombBiz.id);
  bizIds.push(tombBiz.business!.id);

  const drainBiz = await mkUser("drain");
  const drainScans = Array.from({ length: 201 }, (_, i) => ({
    businessId: drainBiz.bizId,
    scanType: "staff",
    entryPath: "/t/d",
    deviceType: "mobile",
    sessionId: `sweep-drain-${tag}-${i}`,
    dedupeKey: `sweep-drain-${tag}-${i}`,
    scannedAt: new Date(now.getTime() - 49 * 3600000),
  }));
  await prisma.qrScanEvent.createMany({ data: drainScans });

  const fixtureBiz = [...bizIds];
  const fixtureUsers = [...userIds];
  const restrict = {
    restrictToBusinessIds: fixtureBiz,
    restrictToUserIds: fixtureUsers,
    now,
  };

  const srcSweep = readFileSync(
    path.join(__dirname, "../src/services/categoryRetentionSweep.service.ts"),
    "utf8",
  );
  const srcRoutes = readFileSync(path.join(__dirname, "../src/routes/internalJobs.routes.ts"), "utf8");

  try {
    if (
      !srcSweep.includes("runAnalyticsTtl") &&
      !srcSweep.includes("prisma.qrScanEvent.update") &&
      !srcSweep.includes("prisma.transaction.delete")
    ) {
      pass("sweep source does not mutate QR/financial rows or call runners");
    } else fail("sweep source must not call runners or delete financial rows");

    if (
      srcRoutes.includes("/category-retention-sweep") &&
      srcRoutes.includes("x-cron-secret") &&
      !/category-retention-sweep[\s\S]*Authorization/.test(
        srcRoutes.slice(srcRoutes.indexOf("category-retention-sweep")),
      )
    ) {
      pass("sweep route uses x-cron-secret (not Bearer)");
    } else fail("sweep route auth");

    if (categoryHoldDecision(null, "analytics") === "unknown" && shouldSkipForHold("unknown")) {
      pass("unknown/ambiguous hold fail-closed");
    } else fail("unknown hold helper");
    if (categoryHoldDecision({ legalHold: true, legalHoldCategories: [] }, "analytics") === "held") {
      pass("empty legalHoldCategories held for all categories");
    } else fail("empty-category hold");

    setEnv({
      DATA_LIFECYCLE_V1: "true",
      DATA_LIFECYCLE_DRY_RUN: "true",
      DATA_LIFECYCLE_ANALYTICS_EXECUTE: "true",
      DATA_LIFECYCLE_GUEST_EXECUTE: "true",
    });
    const jobsBeforeDry = await countJobs();
    const dry = await sweepCategoryRetention({
      ...restrict,
      env: process.env,
      bypassExecutionGate: true,
    });
    const jobsAfterDry = await countJobs();
    if (dry.mode === "dry_run" && dry.dryRun && jobsAfterDry === jobsBeforeDry) {
      pass("dry-run does not create DataLifecycleJob rows (even if EXECUTE is on)");
    } else fail(`dry-run created jobs: mode=${dry.mode} delta=${jobsAfterDry - jobsBeforeDry}`);

    const qrDry = dry.subjects.filter((s) => s.kind === "analytics_ttl" && s.subjectId === a.bizId);
    const guestDry = dry.subjects.filter((s) => s.kind === "guest_scrub" && s.subjectId === a.bizId);
    if (qrDry.length === 1 && qrDry[0].candidateCount >= 1 && qrDry[0].action === "WOULD_ENQUEUE") {
      pass("QR candidates discovered (WOULD_ENQUEUE, ids only)");
    } else fail(`QR dry discovery: ${JSON.stringify(qrDry)}`);
    if (guestDry.length === 1 && guestDry[0].candidateCount >= 1 && guestDry[0].action === "WOULD_ENQUEUE") {
      pass("guest leftover-name candidates discovered");
    } else fail(`guest dry discovery: ${JSON.stringify(guestDry)}`);

    const heldEmptySub = dry.subjects.find(
      (s) => s.kind === "analytics_ttl" && s.subjectId === heldEmpty.bizId,
    );
    if (heldEmptySub?.action === "skipped" && heldEmptySub.skipReason === "legal_hold") {
      pass("legal-held business with empty categories skipped");
    } else fail(`empty-hold skip: ${JSON.stringify(heldEmptySub)}`);
    const heldAn = dry.subjects.find(
      (s) => s.kind === "analytics_ttl" && s.subjectId === heldAnalytics.bizId,
    );
    if (heldAn?.action === "skipped" && heldAn.skipReason === "legal_hold") {
      pass("analytics-held business skipped for QR enqueue");
    } else fail(`analytics hold skip: ${JSON.stringify(heldAn)}`);

    const staffDry = dry.subjects.find((s) => s.kind === "staff_pii_scrub" && s.subjectId === a.bizId);
    if (staffDry && staffDry.candidateCount === 1) {
      pass("calendar-year staff: 2015 eligible, 2016 not yet eligible");
    } else fail(`staff calendar discovery count=${staffDry?.candidateCount}`);

    const scanA = await prisma.qrScanEvent.findUnique({ where: { id: oldScanA.id } });
    const guestA = await prisma.tipFeedback.findFirst({
      where: { businessId: a.bizId, customerName: { not: null } },
    });
    if (scanA?.userAgent === "SweepUA" && guestA?.customerName) {
      pass("execute-mode not used in dry-run — records not mutated");
    } else fail("dry-run mutated records");

    setEnv({
      DATA_LIFECYCLE_V1: "true",
      DATA_LIFECYCLE_DRY_RUN: undefined,
      DATA_LIFECYCLE_ANALYTICS_EXECUTE: undefined,
      DATA_LIFECYCLE_GUEST_EXECUTE: undefined,
    });
    const enq1 = await sweepCategoryRetention({ ...restrict, env: process.env });
    if (enq1.mode !== "enqueue") {
      fail(`expected enqueue mode, got ${enq1.mode}`);
    }
    const created = enq1.subjects.filter((s) => s.action === "enqueued");
    if (created.length > 0) pass(`enqueue-mode sweep created ${created.length} jobs (no runner calls)`);
    else fail("enqueue-mode created no jobs");

    const scanAfterEnq = await prisma.qrScanEvent.findUnique({ where: { id: oldScanA.id } });
    const guestAfterEnq = await prisma.tipFeedback.findFirst({
      where: { businessId: a.bizId, customerName: { not: null } },
    });
    const tipAfterEnq = await prisma.transaction.findUnique({ where: { id: tip.id } });
    const refundAfterEnq = await prisma.tipRefund.findUnique({ where: { id: refund.id } });
    if (
      scanAfterEnq?.userAgent === "SweepUA" &&
      guestAfterEnq?.customerName &&
      String(tipAfterEnq?.amount) === financialSnap.tipAmount &&
      tipAfterEnq?.stripePaymentIntentId === financialSnap.tipPi &&
      refundAfterEnq?.stripeRefundId === financialSnap.refundId
    ) {
      pass("execute-mode sweep only enqueues — never mutates QR/guest/financial rows");
    } else fail("enqueue sweep mutated production-like fixture rows");

    const jobA = await prisma.dataLifecycleJob.findFirst({
      where: { type: "analytics_ttl", subjectId: a.bizId, status: "pending" },
    });
    const jobB = await prisma.dataLifecycleJob.findFirst({
      where: { type: "analytics_ttl", subjectId: b.bizId, status: "pending" },
    });
    const payloadA = jobA?.payload as { businessId?: string } | null;
    const payloadB = jobB?.payload as { businessId?: string } | null;
    if (
      jobA &&
      jobB &&
      payloadA?.businessId === a.bizId &&
      payloadB?.businessId === b.bizId &&
      payloadA.businessId !== b.bizId
    ) {
      pass("tenant isolation: job subjectId/payload stay on the owning business");
    } else fail("tenant isolation job subjects");

    const enq2 = await sweepCategoryRetention({ ...restrict, env: process.env });
    const dupes = enq2.subjects.filter((s) => s.action === "enqueued");
    const exists = enq2.subjects.filter((s) => s.action === "exists");
    if (dupes.length === 0 && exists.length > 0) {
      pass("duplicate sweeps are idempotent (pending jobs reused)");
    } else fail(`idempotency enqueued=${dupes.length} exists=${exists.length}`);

    const tickGated = await tickCategoryRetentionJobs(20, { env: process.env });
    if (tickGated.gated.analytics_ttl && scanAfterEnq?.userAgent === "SweepUA") {
      pass("existing category tick remains gated without category EXECUTE");
    } else fail("tick should stay gated without EXECUTE");

    setEnv({
      DATA_LIFECYCLE_V1: "true",
      DATA_LIFECYCLE_ANALYTICS_EXECUTE: "true",
      DATA_LIFECYCLE_GUEST_EXECUTE: "true",
    });
    if (!jobA) {
      fail("missing analytics job for A");
    } else {
      const processed = await processCategoryRetentionJob(jobA.id, {
        bypassExecutionGate: true,
        env: process.env,
      });
      const scanProcessed = await prisma.qrScanEvent.findUnique({ where: { id: oldScanA.id } });
      const scanB = await prisma.qrScanEvent.findFirst({
        where: { businessId: b.bizId, sessionId: `sweep-old-b-${tag}` },
      });
      if (processed.status === "succeeded" && scanProcessed?.anonymizedAt && !scanB?.anonymizedAt) {
        pass("queued jobs still processed by existing workers; tenant B QR untouched");
      } else fail(`worker process: ${processed.status} B anonymized=${Boolean(scanB?.anonymizedAt)}`);
    }

    const drainJob1 = await prisma.dataLifecycleJob.findFirst({
      where: { type: "analytics_ttl", subjectId: drainBiz.bizId, status: { in: ["pending", "running"] } },
    });
    if (drainJob1) {
      await processCategoryRetentionJob(drainJob1.id, { bypassExecutionGate: true, env: process.env });
    }
    const afterFirstBatch = await prisma.qrScanEvent.count({
      where: { businessId: drainBiz.bizId, anonymizedAt: { not: null } },
    });
    const remaining = await prisma.qrScanEvent.count({
      where: { businessId: drainBiz.bizId, anonymizedAt: null, scannedAt: { lt: new Date(now.getTime() - 48 * 3600000) } },
    });
    if (afterFirstBatch === 200 && remaining === 1) {
      pass("first worker batch processes 200 of 201 QR rows");
    } else fail(`batch1 anonymized=${afterFirstBatch} remaining=${remaining}`);

    const drainSweep2 = await sweepCategoryRetention({
      restrictToBusinessIds: [drainBiz.bizId],
      now,
      env: process.env,
    });
    const drainRe = drainSweep2.subjects.find((s) => s.kind === "analytics_ttl" && s.subjectId === drainBiz.bizId);
    if (drainRe?.action === "enqueued") {
      pass("sweep re-enqueues remaining work after succeeded batch (resumable)");
    } else fail(`drain re-enqueue: ${JSON.stringify(drainRe)}`);
    const drainJob2 = await prisma.dataLifecycleJob.findFirst({
      where: {
        type: "analytics_ttl",
        subjectId: drainBiz.bizId,
        status: "pending",
      },
      orderBy: { createdAt: "desc" },
    });
    if (drainJob2) {
      await processCategoryRetentionJob(drainJob2.id, { bypassExecutionGate: true, env: process.env });
    }
    const afterDrain = await prisma.qrScanEvent.count({
      where: { businessId: drainBiz.bizId, anonymizedAt: { not: null } },
    });
    if (afterDrain === 201) pass("batches larger than 200 eventually drain via sweep+tick");
    else fail(`drain total anonymized=${afterDrain}`);

    const kycDry = await sweepKycSecureDestroy({
      restrictToBusinessIds: [kycBiz.business!.id],
      now,
      env: { ...process.env, DATA_LIFECYCLE_V1: "true", DATA_LIFECYCLE_DRY_RUN: "true" },
      bypassExecutionGate: true,
    });
    const kycJobsDry = await prisma.dataLifecycleJob.count({
      where: { type: "kyc_secure_destroy", subjectId: kycBiz.business!.id },
    });
    if (kycDry.dryRun && kycJobsDry === 0 && kycDry.wouldEnqueue + kycDry.skipped >= 1) {
      pass("KYC sweep dry-run does not create jobs and does not destroy");
    } else fail(`kyc dry: ${JSON.stringify({ mode: kycDry.mode, jobs: kycJobsDry, rows: kycDry.rows })}`);

    const kycPath = await prisma.business.findUnique({
      where: { id: kycBiz.business!.id },
      select: { verificationDocumentPath: true, taxId: true, stripeAccountId: true, lifecycleStatus: true },
    });
    if (
      kycPath?.verificationDocumentPath &&
      kycPath.taxId === "DE-SWEEP-TAX" &&
      kycPath.stripeAccountId &&
      kycPath.lifecycleStatus === "soft_closed"
    ) {
      pass("KYC sweep preserves taxId / Stripe mapping / refs (no secureDestroy)");
    } else fail("KYC fixture mutated during sweep");

    setEnv({ DATA_LIFECYCLE_V1: "true", DATA_LIFECYCLE_DRY_RUN: undefined });
    const kycEnq = await sweepKycSecureDestroy({
      restrictToBusinessIds: [kycBiz.business!.id],
      now,
      env: process.env,
    });
    const kycEnq2 = await sweepKycSecureDestroy({
      restrictToBusinessIds: [kycBiz.business!.id],
      now,
      env: process.env,
    });
    if (
      (kycEnq.enqueued === 1 || kycEnq.skipped >= 1) &&
      kycEnq2.enqueued === 0 &&
      (kycEnq2.exists === 1 || kycEnq2.skipped >= 1)
    ) {
      pass("KYC sweep enqueue is idempotent and never calls destroy");
    } else fail(`kyc enqueue ${JSON.stringify({ kycEnq, kycEnq2 })}`);

    setEnv({ DATA_LIFECYCLE_V1: "true", DATA_LIFECYCLE_DRY_RUN: "true" });
    const tombDry = await sweepBusinessTombstone({
      restrictToBusinessIds: [tombBiz.business!.id],
      now,
      env: process.env,
      bypassExecutionGate: true,
    });
    const tombJobsDry = await prisma.dataLifecycleJob.count({
      where: { type: "business_tombstone", subjectId: tombBiz.business!.id },
    });
    if (tombDry.dryRun && tombJobsDry === 0 && tombDry.wouldEnqueue === 1) {
      pass("tombstone sweep dry-run WOULD_ENQUEUE without creating jobs");
    } else fail(`tomb dry ${JSON.stringify(tombDry)}`);

    setEnv({ DATA_LIFECYCLE_V1: "true", DATA_LIFECYCLE_DRY_RUN: undefined, DATA_LIFECYCLE_TOMBSTONE_EXECUTE: undefined });
    const tombEnq = await sweepBusinessTombstone({
      restrictToBusinessIds: [tombBiz.business!.id],
      now,
      env: process.env,
    });
    const tickTomb = await tickBusinessTombstoneJobs(5, { env: process.env });
    const tombRow = await prisma.business.findUnique({
      where: { id: tombBiz.business!.id },
      select: { lifecycleStatus: true, logoPath: true, welcomeMessage: true },
    });
    if (
      tombEnq.enqueued === 1 &&
      tickTomb.gated &&
      tombRow?.lifecycleStatus === "soft_closed" &&
      tombRow.logoPath
    ) {
      pass("tombstone tick stays gated without EXECUTE; sweep did not strip assets");
    } else fail(`tomb enqueue/tick ${JSON.stringify({ tombEnq, tickTomb, tombRow })}`);

    const tipFinal = await prisma.transaction.findUnique({ where: { id: tip.id } });
    const refundFinal = await prisma.tipRefund.findUnique({ where: { id: refund.id } });
    if (
      tipFinal?.stripePaymentIntentId === financialSnap.tipPi &&
      refundFinal?.stripeRefundId === financialSnap.refundId
    ) {
      pass("financial rows were never modified");
    } else fail("financial rows changed");

    console.log("\nFixture sweep candidate counts (enqueue-mode, restricted):");
    for (const kind of Object.keys(enq1.kinds) as Array<keyof typeof enq1.kinds>) {
      const k = enq1.kinds[kind];
      console.log(
        `  ${kind}: records=${k.candidateRecords} subjects=${k.eligibleSubjects} enqueued=${k.enqueued} exists=${k.exists} hold=${k.skippedHold} unknown=${k.skippedUnknownHold}`,
      );
    }
  } finally {
    restore();
    await prisma.dataLifecycleJob
      .deleteMany({ where: { subjectId: { in: [...bizIds, ...userIds] } } })
      .catch(() => undefined);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.tipFeedback.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.tipRefund.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.qrScanEvent.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.qrGuestVisit.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.qrFunnelEvent.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.transaction.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.employee.deleteMany({ where: { businessId: { in: bizIds } } }).catch(() => undefined);
    await prisma.business.deleteMany({ where: { id: { in: bizIds } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  }

  setEnv({ DATA_LIFECYCLE_V1: "true", DATA_LIFECYCLE_DRY_RUN: "true" });
  const jobsBeforeProd = await countJobs();
  const prodDry = await sweepCategoryRetention({
    env: process.env,
    now: new Date(),
  });
  const jobsAfterProd = await countJobs();
  restore();
  if (jobsAfterProd === jobsBeforeProd && prodDry.dryRun) {
    pass("unrestricted production dry-run sweep created no jobs");
  } else fail(`production dry-run mutated jobs delta=${jobsAfterProd - jobsBeforeProd}`);

  console.log("\nUnrestricted dry-run discovery (IDs only, no PII):");
  for (const kind of Object.keys(prodDry.kinds) as Array<keyof typeof prodDry.kinds>) {
    const k = prodDry.kinds[kind];
    console.log(
      `  ${kind}: records=${k.candidateRecords} subjects=${k.eligibleSubjects} wouldEnqueue=${k.wouldEnqueue} hold=${k.skippedHold} unknown=${k.skippedUnknownHold}`,
    );
  }
  const qrRecords = prodDry.kinds.analytics_ttl.candidateRecords;
  const guestRecords = prodDry.kinds.guest_scrub.candidateRecords;
  console.log(`  QR-like records discovered=${qrRecords} guest records=${guestRecords}`);
  console.log(`  (latest production dry-run inventory was 395+5+101 QR and 55 guest)`);

  const jobsAtEnd = await countJobs();
  if (jobsAtEnd === jobsAtStart) pass("production DataLifecycleJob count unchanged after tests");
  else fail(`job count changed ${jobsAtStart} → ${jobsAtEnd}`);

  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) console.log(line);
  console.log(`\nCategory retention sweep: ${results.length - failed.length}/${results.length} passed`);
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
