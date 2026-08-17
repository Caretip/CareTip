/**
 * Production GDPR retention DRY-RUN audit.
 * Existing workers run with DATA_LIFECYCLE_V1 + DATA_LIFECYCLE_DRY_RUN only.
 * Never sets EXECUTE. Never calls KYC destroy or anonymizeUser.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/prisma.js";
import {
  runAnalyticsTtl,
  runAuditScrub,
  runBillingRedact,
  runGuestScrub,
  runNotifyCleanup,
  runStaffPiiScrub,
  runSupportRedact,
} from "../src/services/categoryRetention.service.js";
import {
  categoryHoldDecision,
  redactBillingPayload,
  resolveRetentionJobMode,
  RETENTION_EXEC_GATES,
  scrubPiiKeysInJson,
  scrubPiiKeysInMetadataString,
} from "../src/services/retentionPolicy.helpers.js";
import {
  addUtcDays,
  calendarYearRetentionEligibleAt,
  daysCutoff,
  hoursCutoff,
} from "../src/services/retentionCalendar.js";
import {
  ACCOUNT_ERASURE_GRACE_DAYS,
  AUDIT_RETENTION_YEARS,
  BILLING_RETENTION_YEARS,
  DELETION_CANCELLATION_DAYS,
  EMPLOYEE_HISTORICAL_RETENTION_YEARS,
  FINANCIAL_RETENTION_YEARS,
  NOTIFICATION_RETENTION_DAYS,
  QR_PERSONAL_ANONYMIZATION_HOURS,
  SUPPORT_RETENTION_YEARS,
} from "../src/services/retentionPolicy.constants.js";
import { evaluateKycDestroyDryRunScan } from "../src/services/kycSecureDestroy.service.js";
import { tombstoneBusinessNonEssential } from "../src/services/businessTombstone.service.js";
import { deriveErasureLifecycleState } from "../src/services/lifecycleStatus.helpers.js";
import { backfillMissingErasureClocks } from "../src/services/erasureClockBackfill.service.js";
import { evaluateErasurePendingAnonymizeDryRun } from "../src/services/anonymization.service.js";
import { evaluateDsarCleanupDryRun } from "../src/services/dsarExport.service.js";
import { auditLegalHeldBusinesses, auditLegalHeldUsers } from "../src/services/legalHold.service.js";

const EXEC_FLAG_NAMES = [
  ...Object.values(RETENTION_EXEC_GATES),
  "DATA_LIFECYCLE_ANONYMIZATION_EXECUTE",
  "DATA_LIFECYCLE_KYC_DESTROY_EXECUTE",
  "DATA_LIFECYCLE_TOMBSTONE_EXECUTE",
];

function dbHost(): string {
  const raw = process.env.DATABASE_URL ?? "";
  try {
    return new URL(raw.replace(/^postgres(ql)?:/i, "http:")).host;
  } catch {
    return "(unparseable — credentials not logged)";
  }
}

function abort(msg: string): never {
  console.error(`GDPR_DRY_RUN_BLOCKED: ${msg}`);
  process.exit(1);
}

function assertNoExecuteFlags(env: NodeJS.ProcessEnv) {
  for (const name of EXEC_FLAG_NAMES) {
    const v = env[name]?.trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes" || v === "on") {
      abort(`${name} is enabled — refusing dry-run audit`);
    }
  }
}

async function snapshot() {
  return {
    business: await prisma.business.count(),
    user: await prisma.user.count(),
    employee: await prisma.employee.count(),
    transaction: await prisma.transaction.count(),
    tipRefund: await prisma.tipRefund.count(),
    stripeConnectPayout: await prisma.stripeConnectPayout.count(),
    stripeConnectPayoutBalanceLine: await prisma.stripeConnectPayoutBalanceLine.count(),
    supportTicket: await prisma.supportTicket.count(),
    notification: await prisma.notification.count(),
    auditLog: await prisma.auditLog.count(),
    qrScan: await prisma.qrScanEvent.count(),
    qrVisit: await prisma.qrGuestVisit.count(),
    qrFunnel: await prisma.qrFunnelEvent.count(),
    featureUtilizationDaily: await prisma.featureUtilizationDaily.count(),
    tipFeedback: await prisma.tipFeedback.count(),
    guestNamesPresent: await prisma.tipFeedback.count({ where: { customerName: { not: null } } }),
    tombstoned: await prisma.business.count({ where: { tombstonedAt: { not: null } } }),
    kycPaths: await prisma.business.count({ where: { verificationDocumentPath: { not: null } } }),
  };
}

type HoldRow = { legalHold: boolean; legalHoldCategories: string[] };

async function main() {
  const started = new Date();
  const fileEnvFlags: Record<string, string | null> = {};
  for (const name of ["DATA_LIFECYCLE_V1", "DATA_LIFECYCLE_DRY_RUN", ...EXEC_FLAG_NAMES, "RETENTION_T_KYC_DAYS"]) {
    fileEnvFlags[name] = process.env[name] ?? null;
  }
  assertNoExecuteFlags(process.env);
  const before = await snapshot();

  process.env.DATA_LIFECYCLE_V1 = "true";
  process.env.DATA_LIFECYCLE_DRY_RUN = "true";
  for (const name of EXEC_FLAG_NAMES) delete process.env[name];
  assertNoExecuteFlags(process.env);
  const dryEnv = { ...process.env } as NodeJS.ProcessEnv;

  const modes: Record<string, string> = {};
  for (const cat of ["analytics", "audit", "support", "notify", "guest", "billing", "staff_pii"] as const) {
    modes[cat] = resolveRetentionJobMode(cat, dryEnv);
    if (modes[cat] !== "dry_run") abort(`${cat} mode is ${modes[cat]} — expected dry_run`);
  }

  const workerOpts = { env: dryEnv };
  const analytics = await runAnalyticsTtl(workerOpts);
  const audit = await runAuditScrub(workerOpts);
  const support = await runSupportRedact(workerOpts);
  const notify = await runNotifyCleanup(workerOpts);
  const guest = await runGuestScrub(workerOpts);
  const billing = await runBillingRedact(workerOpts);
  const staff = await runStaffPiiScrub(workerOpts);
  for (const [name, r] of Object.entries({ analytics, audit, support, notify, guest, billing, staff })) {
    if (!(r as { dryRun: boolean }).dryRun) abort(`${name} worker returned dryRun=false`);
  }

  const now = new Date();
  const qrCutoff = hoursCutoff(QR_PERSONAL_ANONYMIZATION_HOURS, now);
  const notifyCutoff = daysCutoff(NOTIFICATION_RETENTION_DAYS, now);
  const securityCutoff = daysCutoff(30, now);

  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      timezone: true,
      legalHold: true,
      legalHoldCategories: true,
      lifecycleStatus: true,
      deletedAt: true,
      kycRetainUntil: true,
      verificationDocumentPath: true,
      kycDocuments: true,
      tombstonedAt: true,
      logoPath: true,
      welcomeMessage: true,
      stripeAccountId: true,
      taxId: true,
      name: true,
    },
  });
  const bizById = new Map(businesses.map((b) => [b.id, b]));
  function bizHold(id: string, cat: "analytics" | "guest" | "staff_pii" | "support" | "audit" | "billing" | "kyc"): "held" | "clear" | "unknown" {
    const b = bizById.get(id);
    if (!b) return "unknown";
    return categoryHoldDecision(b, cat);
  }
  function bizTz(id: string): string {
    return bizById.get(id)?.timezone?.trim() || "UTC";
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      accountStatus: true,
      anonymizedAt: true,
      legalHold: true,
      legalHoldCategories: true,
      deletionRequestedAt: true,
      deletionCancelUntil: true,
      anonymizeEligibleAt: true,
    },
  });
  const userById = new Map(users.map((u) => [u.id, u]));
  function userHold(id: string, cat: "notify" | "audit" | "staff_pii" | "profile"): "held" | "clear" | "unknown" {
    const u = userById.get(id);
    if (!u) return "unknown";
    return categoryHoldDecision(u, cat);
  }

  const qrScanIds: string[] = [];
  let qrScansEligible = 0;
  let qrScansHold = 0;
  let qrScansUnknown = 0;
  const qrScans = await prisma.qrScanEvent.findMany({
    where: { scannedAt: { lt: qrCutoff }, anonymizedAt: null },
    select: { id: true, businessId: true },
  });
  for (const s of qrScans) {
    const d = bizHold(s.businessId, "analytics");
    if (d === "held") qrScansHold += 1;
    else if (d === "unknown") qrScansUnknown += 1;
    else {
      qrScansEligible += 1;
      qrScanIds.push(s.id);
    }
  }

  let qrVisitsEligible = 0;
  let qrVisitsHold = 0;
  const qrVisits = await prisma.qrGuestVisit.findMany({
    where: { startedAt: { lt: qrCutoff }, anonymizedAt: null },
    select: { id: true, businessId: true },
  });
  for (const s of qrVisits) {
    const d = bizHold(s.businessId, "analytics");
    if (d !== "clear") qrVisitsHold += 1;
    else qrVisitsEligible += 1;
  }

  let qrFunnelEligible = 0;
  let qrFunnelHold = 0;
  const qrFunnels = await prisma.qrFunnelEvent.findMany({
    where: { createdAt: { lt: qrCutoff }, anonymizedAt: null },
    select: { id: true, businessId: true },
  });
  for (const s of qrFunnels) {
    const d = bizHold(s.businessId, "analytics");
    if (d !== "clear") qrFunnelHold += 1;
    else qrFunnelEligible += 1;
  }

  const notifyIds: string[] = [];
  let notifyWouldDelete = 0;
  let notifyHold = 0;
  let notifyUnknown = 0;
  const oldNotes = await prisma.notification.findMany({
    where: { createdAt: { lt: notifyCutoff } },
    select: { id: true, userId: true },
  });
  for (const n of oldNotes) {
    const d = userHold(n.userId, "notify");
    if (d === "held") notifyHold += 1;
    else if (d === "unknown") notifyUnknown += 1;
    else {
      notifyWouldDelete += 1;
      notifyIds.push(n.id);
    }
  }

  const guestIds: string[] = [];
  let guestWouldAnonymize = 0;
  let guestHold = 0;
  const leftover = await prisma.tipFeedback.findMany({
    where: { customerName: { not: null } },
    select: { id: true, businessId: true },
  });
  for (const g of leftover) {
    const d = bizHold(g.businessId, "guest");
    if (d !== "clear") guestHold += 1;
    else {
      guestWouldAnonymize += 1;
      guestIds.push(g.id);
    }
  }

  const staffIds: string[] = [];
  let staffWouldAnonymize = 0;
  let staffHold = 0;
  let staffNotElapsed = 0;
  const staffRows = await prisma.employee.findMany({
    where: { isDeleted: true, anonymizedAt: null, deletedAt: { not: null } },
    select: { id: true, businessId: true, userId: true, deletedAt: true },
  });
  for (const emp of staffRows) {
    if (!emp.deletedAt) continue;
    const tz = bizTz(emp.businessId);
    const cal = calendarYearRetentionEligibleAt(emp.deletedAt, EMPLOYEE_HISTORICAL_RETENTION_YEARS, tz);
    if (!cal.ok) {
      staffHold += 1;
      continue;
    }
    if (now.getTime() < cal.eligibleAt.getTime()) {
      staffNotElapsed += 1;
      continue;
    }
    const bizD = bizHold(emp.businessId, "staff_pii");
    const userD = emp.userId ? userHold(emp.userId, "staff_pii") : "clear";
    if (bizD !== "clear" || userD !== "clear") staffHold += 1;
    else {
      staffWouldAnonymize += 1;
      staffIds.push(emp.id);
    }
  }

  const supportIds: string[] = [];
  let supportWouldRedact = 0;
  let supportHold = 0;
  let supportClosedNotElapsed = 0;
  const tickets = await prisma.supportTicket.findMany({
    select: { id: true, businessId: true, closedAt: true },
  });
  const supportOpen = tickets.filter((t) => !t.closedAt).length;
  for (const t of tickets) {
    if (!t.closedAt) continue;
    const tz = bizTz(t.businessId);
    const cal = calendarYearRetentionEligibleAt(t.closedAt, SUPPORT_RETENTION_YEARS, tz);
    if (!cal.ok) {
      supportHold += 1;
      continue;
    }
    if (now.getTime() < cal.eligibleAt.getTime()) {
      supportClosedNotElapsed += 1;
      continue;
    }
    if (bizHold(t.businessId, "support") !== "clear") supportHold += 1;
    else {
      supportWouldRedact += 1;
      supportIds.push(t.id);
    }
  }

  const auditIds: string[] = [];
  let auditWouldRedact = 0;
  let auditHold = 0;
  let auditNotElapsed = 0;
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      retentionClass: "admin_audit",
      OR: [
        { metadata: { contains: '"email"' } },
        { metadata: { contains: '"phone"' } },
        { metadata: { contains: '"customerName"' } },
        { metadata: { contains: '"inviteeEmail"' } },
        { metadata: { contains: "@" } },
      ],
    },
    select: { id: true, userId: true, metadata: true, createdAt: true },
  });
  for (const log of auditLogs) {
    const cal = calendarYearRetentionEligibleAt(log.createdAt, AUDIT_RETENTION_YEARS, "UTC");
    if (!cal.ok || now.getTime() < cal.eligibleAt.getTime()) {
      auditNotElapsed += 1;
      continue;
    }
    if (log.userId && userHold(log.userId, "audit") !== "clear") {
      auditHold += 1;
      continue;
    }
    if (!scrubPiiKeysInMetadataString(log.metadata).changed) continue;
    auditWouldRedact += 1;
    auditIds.push(log.id);
  }

  let activityWouldRedact = 0;
  const acts = await prisma.businessActivityEvent.findMany({
    select: { id: true, businessId: true, summary: true, occurredAt: true },
  });
  for (const ev of acts) {
    const tz = bizTz(ev.businessId);
    const cal = calendarYearRetentionEligibleAt(ev.occurredAt, AUDIT_RETENTION_YEARS, tz);
    if (!cal.ok || now.getTime() < cal.eligibleAt.getTime()) continue;
    if (bizHold(ev.businessId, "audit") !== "clear") continue;
    if (scrubPiiKeysInJson(ev.summary).changed) activityWouldRedact += 1;
  }

  const billingIds: string[] = [];
  let billingWouldRedact = 0;
  let billingHold = 0;
  const subs = await prisma.subscription.findMany({ select: { id: true, businessId: true } });
  const subBiz = new Map(subs.map((s) => [s.id, s.businessId]));
  const subEvents = await prisma.subscriptionEvent.findMany({
    select: { id: true, payload: true, subscriptionId: true, occurredAt: true },
  });
  for (const ev of subEvents) {
    if (ev.payload == null) continue;
    let tz = "UTC";
    let hold: "held" | "clear" | "unknown" = "clear";
    if (ev.subscriptionId) {
      const bid = subBiz.get(ev.subscriptionId);
      if (bid) {
        hold = bizHold(bid, "billing");
        tz = bizTz(bid);
      }
    }
    const cal = calendarYearRetentionEligibleAt(ev.occurredAt, BILLING_RETENTION_YEARS, tz);
    if (!cal.ok || now.getTime() < cal.eligibleAt.getTime()) continue;
    if (hold !== "clear") {
      billingHold += 1;
      continue;
    }
    if (!redactBillingPayload(ev.payload).changed) continue;
    billingWouldRedact += 1;
    billingIds.push(ev.id);
  }

  let financialTxEligibleCalendar = 0;
  const txs = await prisma.transaction.findMany({ select: { id: true, createdAt: true, businessId: true } });
  for (const t of txs) {
    const cal = calendarYearRetentionEligibleAt(t.createdAt, FINANCIAL_RETENTION_YEARS, bizTz(t.businessId));
    if (cal.ok && now.getTime() >= cal.eligibleAt.getTime()) financialTxEligibleCalendar += 1;
  }

  const kycScan = await evaluateKycDestroyDryRunScan({ now, env: dryEnv });
  const kycCandidates = kycScan.rows.map((r) => ({
    id: r.businessId,
    eligibleAt: r.earliestDestroyAt,
    code: r.code,
    eligible: r.eligible,
    action: r.action,
    hasKycRefs: r.hasKycRefs,
    kycRefCount: r.kycRefCount,
  }));
  const kycEligible = kycScan.wouldDestroy;
  const kycHold = kycScan.rows.filter((r) => r.action === "WOULD_SKIP_LEGAL_HOLD").length;
  const kycNotElapsed = kycScan.rows.filter((r) => r.code === "RETENTION_NOT_ELAPSED").length;
  const kycIneligibleLifecycle = kycScan.rows.filter((r) => r.code === "LIFECYCLE_INELIGIBLE").length;
  const kycContradiction = kycScan.rows.filter(
    (r) => r.code === "POLICY_CONTRADICTION" || r.code === "T_KYC_UNSET",
  ).length;
  const contradictions: string[] = kycScan.rows
    .filter((r) => r.code === "POLICY_CONTRADICTION" || r.code === "T_KYC_UNSET")
    .map((r) => `KYC business ${r.businessId}: ${r.code}`);

  const tombstoneIds: string[] = [];
  const tombstoneHoldIds: string[] = [];
  let tombstoneWould = 0;
  let tombstoneHold = 0;
  let tombstoneGrace = 0;
  let tombstoneWrongLifecycle = 0;
  for (const b of businesses) {
    if (b.lifecycleStatus === "tombstoned" && b.tombstonedAt) continue;
    if (b.lifecycleStatus !== "soft_closed" && b.lifecycleStatus !== "data_restricted") {
      tombstoneWrongLifecycle += 1;
      continue;
    }
    if (b.legalHold) {
      tombstoneHold += 1;
      tombstoneHoldIds.push(b.id);
      continue;
    }
    if (!b.deletedAt) {
      tombstoneGrace += 1;
      continue;
    }
    const eligibleAt = addUtcDays(b.deletedAt, ACCOUNT_ERASURE_GRACE_DAYS);
    if (now.getTime() < eligibleAt.getTime()) {
      tombstoneGrace += 1;
      continue;
    }
    const r = await tombstoneBusinessNonEssential(b.id, { now });
    if (r.dryRun !== true) abort("tombstone returned dryRun=false");
    if (!r.alreadyComplete) {
      tombstoneWould += 1;
      tombstoneIds.push(b.id);
    }
  }

  const erasureClockBackfill = await backfillMissingErasureClocks({ dryRun: true });
  if (!erasureClockBackfill.dryRun || erasureClockBackfill.applied !== 0) {
    abort("erasure clock backfill applied during production dry-run");
  }

  const userAnonymizeEval = await evaluateErasurePendingAnonymizeDryRun({ now });
  const dsarEval = await evaluateDsarCleanupDryRun(now);
  const legalHeldBusinesses = await auditLegalHeldBusinesses();
  const legalHeldUsers = await auditLegalHeldUsers();

  const erasure: Record<string, number> = {
    ACTIVE: 0,
    DEACTIVATED: 0,
    ERASURE_CANCELLATION_WINDOW: 0,
    ERASURE_REQUESTED: 0,
    ERASURE_ELIGIBLE: 0,
    LEGAL_HOLD: 0,
    ANONYMIZED: 0,
  };
  const pendingErasure: Array<{
    userId: string;
    state: string;
    deletionCancelUntil: string | null;
    anonymizeEligibleAt: string | null;
  }> = [];
  for (const u of users) {
    const state = deriveErasureLifecycleState(u, now);
    erasure[state] = (erasure[state] ?? 0) + 1;
    if (u.accountStatus === "erasure_pending") {
      pendingErasure.push({
        userId: u.id,
        state,
        deletionCancelUntil: u.deletionCancelUntil?.toISOString() ?? null,
        anonymizeEligibleAt: u.anonymizeEligibleAt?.toISOString() ?? null,
      });
    }
  }

  const finExample = calendarYearRetentionEligibleAt(new Date("2026-08-15T12:00:00.000Z"), 10, "UTC");

  const complete = {
    qrScansEligible,
    qrScansHold,
    qrScansUnknown,
    qrVisitsEligible,
    qrVisitsHold,
    qrFunnelEligible,
    qrFunnelHold,
    qrAlreadyAnon: {
      scans: await prisma.qrScanEvent.count({ where: { anonymizedAt: { not: null } } }),
      visits: await prisma.qrGuestVisit.count({ where: { anonymizedAt: { not: null } } }),
      funnel: await prisma.qrFunnelEvent.count({ where: { anonymizedAt: { not: null } } }),
    },
    featureUtilizationDaily: before.featureUtilizationDaily,
    notifyWouldDelete,
    notifyHold,
    notifyUnknown,
    guestWouldAnonymize,
    guestHold,
    staffWouldAnonymize,
    staffHold,
    staffNotElapsed,
    supportWouldRedact,
    supportHold,
    supportOpen,
    supportClosedNotElapsed,
    auditWouldRedact,
    auditHold,
    auditNotElapsed,
    activityWouldRedact,
    billingWouldRedact,
    billingHold,
    kycEligible,
    kycHold,
    kycNotElapsed,
    kycIneligibleLifecycle,
    kycContradiction,
    tombstoneWould,
    tombstoneHold,
    tombstoneGrace,
    tombstoneWrongLifecycle,
    financialTx: before.transaction,
    financialRefunds: before.tipRefund,
    financialPayouts: before.stripeConnectPayout,
    financialPayoutLines: before.stripeConnectPayoutBalanceLine,
    financialTxEligibleCalendar,
    erasure,
    pendingErasure,
    erasureClockBackfill: {
      dryRun: erasureClockBackfill.dryRun,
      applied: erasureClockBackfill.applied,
      candidateCount: erasureClockBackfill.candidates.length,
      candidates: erasureClockBackfill.candidates,
    },
    userAnonymizeEval: userAnonymizeEval.results.map((r) => ({
      userId: r.userId,
      action: r.action,
      reason: r.reason,
      state: r.state,
      deletionCancelUntil: r.deletionCancelUntil,
      anonymizeEligibleAt: r.anonymizeEligibleAt,
      legalHold: r.legalHold,
    })),
    dsarCleanupEval: {
      wouldDeleteArtifacts: dsarEval.wouldDeleteArtifacts,
      expiredSucceededJobs: dsarEval.expiredSucceededJobs,
      failedOrCancelledWithArtifact: dsarEval.failedOrCancelledWithArtifact,
      localOrphans: dsarEval.localOrphans,
    },
    legalHeldBusinesses,
    legalHeldUsers,
    securityWebhookOlderThan30d: await prisma.stripeWebhookEvent.count({
      where: { processedAt: { lt: securityCutoff } },
    }),
    legalHoldUsers: users.filter((u) => u.legalHold).length,
    legalHoldBusinesses: businesses.filter((b) => b.legalHold).length,
    employeeActive: await prisma.employee.count({ where: { isDeleted: false } }),
    employeeSoftRemoved: await prisma.employee.count({ where: { isDeleted: true } }),
  };

  const notRun = [
    "anonymizeUser mutate path — NOT RUN. Read-only evaluateAnonymizeUser / evaluateErasurePendingAnonymizeDryRun used instead.",
    "secureDestroyBusinessKyc mutate path — NOT RUN. Read-only evaluateKycDestroyDryRunScan used instead.",
    "expireDsarExportArtifact / cleanupOrphanLocalDsarArtifacts / tickDsarExportJobs — NOT RUN. Read-only evaluateDsarCleanupDryRun used instead.",
    "erasure clock backfill apply — NOT RUN (dryRun default; no confirm token / subjectIds).",
    "financial_ledger_delete — NOT RUN (no worker; ledger preserved).",
    "stripe_object_delete — NOT RUN (not implemented / not permitted).",
    "security_webhook_event_purge — NOT RUN as dry-run (opportunistic 1% delete on webhook mark; counted SOURCE_VERIFIED only).",
  ];

  const after = await snapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    abort(`counts changed during dry-run before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }

  const userAnonymizeWould = userAnonymizeEval.results.filter((r) => r.action === "WOULD_ANONYMIZE").length;
  const userAnonymizeHold = userAnonymizeEval.results.filter((r) => r.action === "WOULD_SKIP_LEGAL_HOLD").length;
  const wouldAnonymize =
    qrScansEligible + qrVisitsEligible + qrFunnelEligible + guestWouldAnonymize + staffWouldAnonymize + userAnonymizeWould;
  const wouldDelete = notifyWouldDelete;
  const wouldRedact = auditWouldRedact + activityWouldRedact + supportWouldRedact + billingWouldRedact;
  const protectedHold =
    qrScansHold +
    qrScansUnknown +
    qrVisitsHold +
    qrFunnelHold +
    notifyHold +
    notifyUnknown +
    guestHold +
    staffHold +
    supportHold +
    auditHold +
    billingHold +
    kycHold +
    tombstoneHold +
    erasure.LEGAL_HOLD +
    userAnonymizeHold;

  const report = {
    executionDate: started.toISOString(),
    finishedAt: new Date().toISOString(),
    environment: {
      dbHost: dbHost(),
      nodeEnv: process.env.NODE_ENV ?? null,
      fileEnvFlags,
      processModes: modes,
      clocks: {
        DELETION_CANCELLATION_DAYS,
        ACCOUNT_ERASURE_GRACE_DAYS,
        exampleFinancialEligibleAt: finExample.ok ? finExample.eligibleAt.toISOString() : finExample.reason,
      },
    },
    safety: {
      DATABASE_MODIFIED: "NO",
      DATA_DELETED: "NO",
      DATA_ANONYMIZED: "NO",
      DATA_REDACTED: "NO",
      KYC_DESTROYED: "NO",
      BUSINESS_TOMBSTONED: "NO",
      STRIPE_MODIFIED: "NO",
      FINANCIAL_DATA_MODIFIED: "NO",
      countsBefore: before,
      countsAfter: after,
    },
    workerRealDryRun: {
      analytics: {
        dryRun: analytics.dryRun,
        anonymizedScans: analytics.anonymizedScans,
        anonymizedVisits: analytics.anonymizedVisits,
        anonymizedFunnel: analytics.anonymizedFunnel,
        skippedHeld: analytics.skippedHeldBusinesses,
        skippedUnknown: analytics.skippedUnknownHold,
        batchRecords: analytics.dryRunRecords.length,
      },
      audit: { dryRun: audit.dryRun, scrubbedAuditLogs: audit.scrubbedAuditLogs, scrubbedActivityEvents: audit.scrubbedActivityEvents, skipped: audit.skipped },
      support: { dryRun: support.dryRun, redactedMessages: support.redactedMessages, skippedTickets: support.skippedTickets },
      notify: { dryRun: notify.dryRun, deleted: notify.deleted },
      guest: { dryRun: guest.dryRun, scrubbed: guest.scrubbed, skipped: guest.skipped },
      billing: { dryRun: billing.dryRun, redacted: billing.redacted },
      staff: { dryRun: staff.dryRun, scrubbed: staff.scrubbed, skipped: staff.skipped },
    },
    complete,
    ids: {
      qrScansWouldAnonymize: qrScanIds,
      notifyWouldDelete: notifyIds,
      guestWouldAnonymize: guestIds,
      staffWouldAnonymize: staffIds,
      supportWouldRedact: supportIds,
      auditWouldRedact: auditIds,
      billingWouldRedact: billingIds,
      tombstoneWould: tombstoneIds,
      tombstoneHold: tombstoneHoldIds,
      erasureClockWouldBackfill: erasureClockBackfill.candidates.map((c) => c.userId),
      userAnonymizeWould: userAnonymizeEval.results.filter((r) => r.action === "WOULD_ANONYMIZE").map((r) => r.userId),
      kycWouldDestroy: kycScan.rows.filter((r) => r.action === "WOULD_DELETE").map((r) => r.businessId),
      dsarWouldDeleteJobs: [
        ...dsarEval.expiredSucceededJobs.map((j) => j.jobId),
        ...dsarEval.failedOrCancelledWithArtifact.map((j) => j.jobId),
      ],
      dsarLocalOrphans: dsarEval.localOrphans,
      legalHeldBusinessIds: legalHeldBusinesses.map((b) => b.businessId),
    },
    kycCandidates,
    notRun,
    contradictions,
    totals: {
      WOULD_ANONYMIZE: wouldAnonymize,
      WOULD_DELETE: wouldDelete,
      WOULD_REDACT: wouldRedact,
      WOULD_TOMBSTONE: tombstoneWould,
      WOULD_BACKFILL: erasureClockBackfill.candidates.length,
      WOULD_DELETE_KYC: kycEligible,
      WOULD_DELETE_DSAR_ARTIFACT: dsarEval.wouldDeleteArtifacts,
      PROTECTED_BY_LEGAL_HOLD: protectedHold,
      FINANCIAL_PRESERVED: complete.financialTx + complete.financialRefunds + complete.financialPayouts,
    },
  };

  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");
  writeFileSync(path.join(outDir, "_gdpr_dry_run_raw.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("GDPR_DRY_RUN_JSON_WRITTEN");
  console.log("GDPR_DRY_RUN = PASS");
  console.log(JSON.stringify({ totals: report.totals, erasure, worker: report.workerRealDryRun, completeBrief: {
    qrScansEligible, notifyWouldDelete, guestWouldAnonymize, staffWouldAnonymize,
    supportWouldRedact, auditWouldRedact, billingWouldRedact, kycEligible, tombstoneWould,
    erasureClockWouldBackfill: erasureClockBackfill.candidates.length,
    userAnonymizeWould,
    dsarWouldDelete: dsarEval.wouldDeleteArtifacts,
    legalHeldBusinesses: legalHeldBusinesses.length,
  } }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
