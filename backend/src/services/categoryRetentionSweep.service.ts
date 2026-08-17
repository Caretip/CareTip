/**
 * Production-safe category retention SWEEP / ENQUEUE.
 *
 * Discovers eligible subjects and creates DataLifecycleJob rows.
 * Does NOT run category workers, anonymize, redact, or delete records.
 *
 * Architecture:
 *   sweep → DataLifecycleJob queue → category-retention-tick → existing runner
 *         → legal-hold check → DRY_RUN / EXECUTE → mutation only when authorized
 *
 * DRY_RUN (DATA_LIFECYCLE_V1 + DATA_LIFECYCLE_DRY_RUN) never creates jobs,
 * even if a category EXECUTE flag is on.
 *
 * Enqueue mode (V1 on, DRY_RUN off) writes jobs only. Tick still gates mutation.
 */

import { Prisma, type DataLifecycleJobType } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  categoryHoldDecision,
  isDataLifecycleDryRunEnabled,
  isDataLifecycleV1Enabled,
  resolveApprovedCategoryPolicy,
  scrubPiiKeysInJson,
  scrubPiiKeysInMetadataString,
  type RetentionCategory,
} from "./retentionPolicy.helpers.js";
import { calendarYearRetentionEligibleAt, daysCutoff, hoursCutoff } from "./retentionCalendar.js";
import { logDryRunRecord } from "./retentionDryRun.js";
import type { CategoryJobKind } from "./categoryRetention.runners.js";

export const CATEGORY_SWEEP_SUBJECT_CAP = 500;
export const CATEGORY_SWEEP_SAMPLE_IDS = 25;

const JOB_TO_CATEGORY: Record<CategoryJobKind, Exclude<RetentionCategory, "kyc" | "financial" | "payment">> = {
  analytics_ttl: "analytics",
  audit_scrub: "audit",
  support_redact: "support",
  notify_cleanup: "notify",
  guest_scrub: "guest",
  billing_redact: "billing",
  staff_pii_scrub: "staff_pii",
};

const ALL_KINDS = Object.keys(JOB_TO_CATEGORY) as CategoryJobKind[];

export type CategorySweepMode = "off" | "dry_run" | "enqueue";

export type CategorySweepSkipReason =
  | "legal_hold"
  | "hold_unknown"
  | "existing_job"
  | "policy_contradiction"
  | "not_eligible";

export type CategorySweepSubjectResult = {
  kind: CategoryJobKind;
  subjectType: "business" | "user";
  subjectId: string;
  action: "WOULD_ENQUEUE" | "enqueued" | "exists" | "skipped";
  jobId?: string;
  skipReason?: CategorySweepSkipReason;
  candidateRecordIds: string[];
  candidateCount: number;
};

export type CategorySweepKindSummary = {
  kind: CategoryJobKind;
  candidateRecords: number;
  eligibleSubjects: number;
  wouldEnqueue: number;
  enqueued: number;
  exists: number;
  skippedHold: number;
  skippedUnknownHold: number;
  skippedExisting: number;
  sampleRecordIds: string[];
};

export type CategorySweepResult = {
  mode: CategorySweepMode;
  gated: boolean;
  dryRun: boolean;
  now: string;
  kinds: Record<CategoryJobKind, CategorySweepKindSummary>;
  subjects: CategorySweepSubjectResult[];
};

export type CategorySweepOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** Tests only: enqueue even when V1 is off. DRY_RUN still wins. */
  bypassExecutionGate?: boolean;
  /** Tests only: never enqueue production tenants. */
  restrictToBusinessIds?: string[];
  restrictToUserIds?: string[];
  subjectCap?: number;
};

export function resolveCategorySweepMode(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { bypassExecutionGate?: boolean },
): CategorySweepMode {
  if (opts?.bypassExecutionGate) {
    return isDataLifecycleDryRunEnabled(env) ? "dry_run" : "enqueue";
  }
  if (!isDataLifecycleV1Enabled(env)) return "off";
  if (isDataLifecycleDryRunEnabled(env)) return "dry_run";
  return "enqueue";
}

function emptyKind(kind: CategoryJobKind): CategorySweepKindSummary {
  return {
    kind,
    candidateRecords: 0,
    eligibleSubjects: 0,
    wouldEnqueue: 0,
    enqueued: 0,
    exists: 0,
    skippedHold: 0,
    skippedUnknownHold: 0,
    skippedExisting: 0,
    sampleRecordIds: [],
  };
}

function emptyResult(mode: CategorySweepMode, now: Date): CategorySweepResult {
  const kinds = {} as Record<CategoryJobKind, CategorySweepKindSummary>;
  for (const k of ALL_KINDS) kinds[k] = emptyKind(k);
  return {
    mode,
    gated: mode === "off",
    dryRun: mode === "dry_run",
    now: now.toISOString(),
    kinds,
    subjects: [],
  };
}

function calendarPrefilter(now: Date, years: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear() - years + 1, 0, 1));
}

class HoldLookup {
  private businesses = new Map<string, { legalHold: boolean; legalHoldCategories: string[] } | null>();
  private users = new Map<string, { legalHold: boolean; legalHoldCategories: string[] } | null>();

  async business(id: string) {
    if (!this.businesses.has(id)) {
      const row = await prisma.business.findUnique({
        where: { id },
        select: { legalHold: true, legalHoldCategories: true },
      });
      this.businesses.set(id, row);
    }
    return this.businesses.get(id) ?? null;
  }

  async user(id: string) {
    if (!this.users.has(id)) {
      const row = await prisma.user.findUnique({
        where: { id },
        select: { legalHold: true, legalHoldCategories: true },
      });
      this.users.set(id, row);
    }
    return this.users.get(id) ?? null;
  }

  async businessDecision(id: string, category: RetentionCategory) {
    return categoryHoldDecision(await this.business(id), category);
  }

  async userDecision(id: string, category: RetentionCategory) {
    return categoryHoldDecision(await this.user(id), category);
  }
}

async function existingOpenJob(
  kind: CategoryJobKind,
  subjectType: string,
  subjectId: string,
): Promise<string | null> {
  const row = await prisma.dataLifecycleJob.findFirst({
    where: {
      type: kind,
      subjectType,
      subjectId,
      status: { in: ["pending", "running"] },
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function createJob(
  kind: CategoryJobKind,
  subjectType: "business" | "user",
  subjectId: string,
): Promise<string> {
  const job = await prisma.dataLifecycleJob.create({
    data: {
      type: kind as DataLifecycleJobType,
      subjectType,
      subjectId,
      status: "pending",
      notBefore: new Date(),
      payload: {
        ...(subjectType === "business" ? { businessId: subjectId } : {}),
        ...(subjectType === "user" ? { userId: subjectId } : {}),
        source: "category_retention_sweep",
      } as Prisma.InputJsonValue,
    },
  });
  return job.id;
}

type Acc = {
  recordIds: string[];
  count: number;
};

function addRecord(acc: Map<string, Acc>, subjectId: string, recordId: string) {
  const cur = acc.get(subjectId) ?? { recordIds: [], count: 0 };
  cur.count += 1;
  if (cur.recordIds.length < CATEGORY_SWEEP_SAMPLE_IDS) cur.recordIds.push(recordId);
  acc.set(subjectId, cur);
}

async function decideEnqueue(args: {
  kind: CategoryJobKind;
  subjectType: "business" | "user";
  subjectId: string;
  mode: CategorySweepMode;
  candidateRecordIds: string[];
  candidateCount: number;
  hold: "held" | "clear" | "unknown";
}): Promise<CategorySweepSubjectResult> {
  const base = {
    kind: args.kind,
    subjectType: args.subjectType,
    subjectId: args.subjectId,
    candidateRecordIds: args.candidateRecordIds,
    candidateCount: args.candidateCount,
  };

  if (args.hold === "held") {
    logDryRunRecord({
      action: "WOULD_SKIP_LEGAL_HOLD",
      category: args.kind,
      record: args.subjectId,
      reason: "legal_hold",
      retentionExpiry: null,
      legalHold: true,
      financialPreservation: "n/a",
    });
    return { ...base, action: "skipped", skipReason: "legal_hold" };
  }
  if (args.hold !== "clear") {
    logDryRunRecord({
      action: "WOULD_SKIP_UNKNOWN_HOLD",
      category: args.kind,
      record: args.subjectId,
      reason: "hold_unknown_fail_closed",
      retentionExpiry: null,
      legalHold: "unknown",
      financialPreservation: "n/a",
    });
    return { ...base, action: "skipped", skipReason: "hold_unknown" };
  }

  const existing = await existingOpenJob(args.kind, args.subjectType, args.subjectId);
  if (existing) {
    return { ...base, action: "exists", jobId: existing, skipReason: "existing_job" };
  }

  if (args.mode === "dry_run") {
    logDryRunRecord({
      action: "WOULD_ENQUEUE",
      category: args.kind,
      record: args.subjectId,
      reason: "category_retention_sweep",
      retentionExpiry: null,
      legalHold: false,
      financialPreservation: "n/a",
    });
    return { ...base, action: "WOULD_ENQUEUE" };
  }

  const jobId = await createJob(args.kind, args.subjectType, args.subjectId);
  return { ...base, action: "enqueued", jobId };
}

function applySubject(
  result: CategorySweepResult,
  subject: CategorySweepSubjectResult,
) {
  const k = result.kinds[subject.kind];
  k.candidateRecords += subject.candidateCount;
  k.eligibleSubjects += 1;
  for (const id of subject.candidateRecordIds) {
    if (k.sampleRecordIds.length < CATEGORY_SWEEP_SAMPLE_IDS) k.sampleRecordIds.push(id);
  }
  if (subject.action === "WOULD_ENQUEUE") k.wouldEnqueue += 1;
  else if (subject.action === "enqueued") k.enqueued += 1;
  else if (subject.action === "exists") {
    k.exists += 1;
    k.skippedExisting += 1;
  } else if (subject.skipReason === "legal_hold") k.skippedHold += 1;
  else if (subject.skipReason === "hold_unknown") k.skippedUnknownHold += 1;
  result.subjects.push(subject);
}

async function sweepAnalytics(
  opts: CategorySweepOptions,
  mode: CategorySweepMode,
  holds: HoldLookup,
  result: CategorySweepResult,
) {
  const env = opts.env ?? process.env;
  const policy = resolveApprovedCategoryPolicy("analytics", env);
  if (!policy.ok || policy.kind !== "hours") return;
  const now = opts.now ?? new Date();
  const cutoff = hoursCutoff(policy.hours, now);
  const cap = opts.subjectCap ?? CATEGORY_SWEEP_SUBJECT_CAP;
  const bizFilter = opts.restrictToBusinessIds ? { businessId: { in: opts.restrictToBusinessIds } } : {};

  const acc = new Map<string, Acc>();
  const scans = await prisma.qrScanEvent.findMany({
    where: { scannedAt: { lt: cutoff }, anonymizedAt: null, ...bizFilter },
    select: { id: true, businessId: true },
    take: cap * 4,
  });
  const visits = await prisma.qrGuestVisit.findMany({
    where: { startedAt: { lt: cutoff }, anonymizedAt: null, ...bizFilter },
    select: { id: true, businessId: true },
    take: cap * 4,
  });
  const funnels = await prisma.qrFunnelEvent.findMany({
    where: { createdAt: { lt: cutoff }, anonymizedAt: null, ...bizFilter },
    select: { id: true, businessId: true },
    take: cap * 4,
  });
  for (const r of scans) addRecord(acc, r.businessId, r.id);
  for (const r of visits) addRecord(acc, r.businessId, r.id);
  for (const r of funnels) addRecord(acc, r.businessId, r.id);

  let n = 0;
  for (const [businessId, rec] of acc) {
    if (n >= cap) break;
    n += 1;
    const hold = await holds.businessDecision(businessId, "analytics");
    applySubject(
      result,
      await decideEnqueue({
        kind: "analytics_ttl",
        subjectType: "business",
        subjectId: businessId,
        mode,
        candidateRecordIds: rec.recordIds,
        candidateCount: rec.count,
        hold,
      }),
    );
  }
}

async function sweepGuest(
  opts: CategorySweepOptions,
  mode: CategorySweepMode,
  holds: HoldLookup,
  result: CategorySweepResult,
) {
  const env = opts.env ?? process.env;
  const policy = resolveApprovedCategoryPolicy("guest", env);
  if (!policy.ok) return;
  const cap = opts.subjectCap ?? CATEGORY_SWEEP_SUBJECT_CAP;
  const bizFilter = opts.restrictToBusinessIds ? { businessId: { in: opts.restrictToBusinessIds } } : {};

  const rows = await prisma.tipFeedback.findMany({
    where: { customerName: { not: null }, ...bizFilter },
    select: { id: true, businessId: true },
    take: cap * 4,
  });
  const acc = new Map<string, Acc>();
  for (const r of rows) addRecord(acc, r.businessId, r.id);

  let n = 0;
  for (const [businessId, rec] of acc) {
    if (n >= cap) break;
    n += 1;
    const hold = await holds.businessDecision(businessId, "guest");
    applySubject(
      result,
      await decideEnqueue({
        kind: "guest_scrub",
        subjectType: "business",
        subjectId: businessId,
        mode,
        candidateRecordIds: rec.recordIds,
        candidateCount: rec.count,
        hold,
      }),
    );
  }
}

async function sweepNotify(
  opts: CategorySweepOptions,
  mode: CategorySweepMode,
  holds: HoldLookup,
  result: CategorySweepResult,
) {
  const env = opts.env ?? process.env;
  const policy = resolveApprovedCategoryPolicy("notify", env);
  if (!policy.ok || policy.kind !== "days") return;
  const now = opts.now ?? new Date();
  const cutoff = daysCutoff(policy.days, now);
  const cap = opts.subjectCap ?? CATEGORY_SWEEP_SUBJECT_CAP;
  const userFilter = opts.restrictToUserIds ? { userId: { in: opts.restrictToUserIds } } : {};

  const rows = await prisma.notification.findMany({
    where: { createdAt: { lt: cutoff }, ...userFilter },
    select: { id: true, userId: true },
    take: cap * 4,
  });
  const acc = new Map<string, Acc>();
  for (const r of rows) addRecord(acc, r.userId, r.id);

  let n = 0;
  for (const [userId, rec] of acc) {
    if (n >= cap) break;
    n += 1;
    const hold = await holds.userDecision(userId, "notify");
    applySubject(
      result,
      await decideEnqueue({
        kind: "notify_cleanup",
        subjectType: "user",
        subjectId: userId,
        mode,
        candidateRecordIds: rec.recordIds,
        candidateCount: rec.count,
        hold,
      }),
    );
  }
}

async function sweepSupport(
  opts: CategorySweepOptions,
  mode: CategorySweepMode,
  holds: HoldLookup,
  result: CategorySweepResult,
) {
  const env = opts.env ?? process.env;
  const policy = resolveApprovedCategoryPolicy("support", env);
  if (!policy.ok || policy.kind !== "calendar_years") return;
  const now = opts.now ?? new Date();
  const cap = opts.subjectCap ?? CATEGORY_SWEEP_SUBJECT_CAP;
  const bizFilter = opts.restrictToBusinessIds ? { businessId: { in: opts.restrictToBusinessIds } } : {};
  const prefilter = calendarPrefilter(now, policy.years);

  const tickets = await prisma.supportTicket.findMany({
    where: {
      closedAt: { not: null, lt: prefilter },
      ...bizFilter,
    },
    select: { id: true, businessId: true, closedAt: true, business: { select: { timezone: true } } },
    take: cap * 4,
  });
  const acc = new Map<string, Acc>();
  for (const t of tickets) {
    if (!t.closedAt) continue;
    const cal = calendarYearRetentionEligibleAt(t.closedAt, policy.years, t.business.timezone ?? "UTC");
    if (!cal.ok || now.getTime() < cal.eligibleAt.getTime()) continue;
    addRecord(acc, t.businessId, t.id);
  }

  let n = 0;
  for (const [businessId, rec] of acc) {
    if (n >= cap) break;
    n += 1;
    const hold = await holds.businessDecision(businessId, "support");
    applySubject(
      result,
      await decideEnqueue({
        kind: "support_redact",
        subjectType: "business",
        subjectId: businessId,
        mode,
        candidateRecordIds: rec.recordIds,
        candidateCount: rec.count,
        hold,
      }),
    );
  }
}

async function sweepStaff(
  opts: CategorySweepOptions,
  mode: CategorySweepMode,
  holds: HoldLookup,
  result: CategorySweepResult,
) {
  const env = opts.env ?? process.env;
  const policy = resolveApprovedCategoryPolicy("staff_pii", env);
  if (!policy.ok || policy.kind !== "calendar_years") return;
  const now = opts.now ?? new Date();
  const cap = opts.subjectCap ?? CATEGORY_SWEEP_SUBJECT_CAP;
  const bizFilter = opts.restrictToBusinessIds ? { businessId: { in: opts.restrictToBusinessIds } } : {};
  const prefilter = calendarPrefilter(now, policy.years);

  const employees = await prisma.employee.findMany({
    where: {
      isDeleted: true,
      anonymizedAt: null,
      deletedAt: { not: null, lt: prefilter },
      ...bizFilter,
    },
    select: {
      id: true,
      businessId: true,
      userId: true,
      deletedAt: true,
      business: { select: { timezone: true } },
    },
    take: cap * 4,
  });
  const acc = new Map<string, Acc>();
  const staffUserHold = new Map<string, "held" | "clear" | "unknown">();

  for (const emp of employees) {
    if (!emp.deletedAt) continue;
    const cal = calendarYearRetentionEligibleAt(emp.deletedAt, policy.years, emp.business.timezone ?? "UTC");
    if (!cal.ok || now.getTime() < cal.eligibleAt.getTime()) continue;
    if (emp.userId) {
      if (!staffUserHold.has(emp.userId)) {
        staffUserHold.set(emp.userId, await holds.userDecision(emp.userId, "staff_pii"));
      }
      if (staffUserHold.get(emp.userId) !== "clear") continue;
    }
    addRecord(acc, emp.businessId, emp.id);
  }

  let n = 0;
  for (const [businessId, rec] of acc) {
    if (n >= cap) break;
    n += 1;
    const hold = await holds.businessDecision(businessId, "staff_pii");
    applySubject(
      result,
      await decideEnqueue({
        kind: "staff_pii_scrub",
        subjectType: "business",
        subjectId: businessId,
        mode,
        candidateRecordIds: rec.recordIds,
        candidateCount: rec.count,
        hold,
      }),
    );
  }
}

async function sweepBilling(
  opts: CategorySweepOptions,
  mode: CategorySweepMode,
  holds: HoldLookup,
  result: CategorySweepResult,
) {
  const env = opts.env ?? process.env;
  const policy = resolveApprovedCategoryPolicy("billing", env);
  if (!policy.ok || policy.kind !== "calendar_years") return;
  const now = opts.now ?? new Date();
  const cap = opts.subjectCap ?? CATEGORY_SWEEP_SUBJECT_CAP;
  const prefilter = calendarPrefilter(now, policy.years);

  const events = await prisma.subscriptionEvent.findMany({
    where: {
      occurredAt: { lt: prefilter },
      ...(opts.restrictToBusinessIds
        ? { subscription: { businessId: { in: opts.restrictToBusinessIds } } }
        : {}),
    },
    select: {
      id: true,
      payload: true,
      occurredAt: true,
      subscription: { select: { businessId: true, business: { select: { timezone: true } } } },
    },
    take: cap * 4,
  });

  const acc = new Map<string, Acc>();
  for (const ev of events) {
    const businessId = ev.subscription?.businessId;
    if (!businessId) continue;
    const tz = ev.subscription?.business.timezone ?? "UTC";
    const cal = calendarYearRetentionEligibleAt(ev.occurredAt, policy.years, tz);
    if (!cal.ok || now.getTime() < cal.eligibleAt.getTime()) continue;
    const { changed } = scrubPiiKeysInJson(ev.payload);
    if (!changed) continue;
    addRecord(acc, businessId, ev.id);
  }

  let n = 0;
  for (const [businessId, rec] of acc) {
    if (n >= cap) break;
    n += 1;
    const hold = await holds.businessDecision(businessId, "billing");
    applySubject(
      result,
      await decideEnqueue({
        kind: "billing_redact",
        subjectType: "business",
        subjectId: businessId,
        mode,
        candidateRecordIds: rec.recordIds,
        candidateCount: rec.count,
        hold,
      }),
    );
  }
}

async function sweepAudit(
  opts: CategorySweepOptions,
  mode: CategorySweepMode,
  holds: HoldLookup,
  result: CategorySweepResult,
) {
  const env = opts.env ?? process.env;
  const policy = resolveApprovedCategoryPolicy("audit", env);
  if (!policy.ok || policy.kind !== "calendar_years") return;
  const now = opts.now ?? new Date();
  const cap = opts.subjectCap ?? CATEGORY_SWEEP_SUBJECT_CAP;
  const prefilter = calendarPrefilter(now, policy.years);

  const events = await prisma.businessActivityEvent.findMany({
    where: {
      occurredAt: { lt: prefilter },
      ...(opts.restrictToBusinessIds ? { businessId: { in: opts.restrictToBusinessIds } } : {}),
    },
    select: {
      id: true,
      businessId: true,
      summary: true,
      occurredAt: true,
      business: { select: { timezone: true } },
    },
    take: cap * 4,
  });
  const bizAcc = new Map<string, Acc>();
  for (const ev of events) {
    const cal = calendarYearRetentionEligibleAt(ev.occurredAt, policy.years, ev.business.timezone ?? "UTC");
    if (!cal.ok || now.getTime() < cal.eligibleAt.getTime()) continue;
    const { changed } = scrubPiiKeysInJson(ev.summary);
    if (!changed) continue;
    addRecord(bizAcc, ev.businessId, ev.id);
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      retentionClass: "admin_audit",
      createdAt: { lt: prefilter },
      ...(opts.restrictToUserIds ? { userId: { in: opts.restrictToUserIds } } : {}),
      OR: [
        { metadata: { contains: '"email"' } },
        { metadata: { contains: '"phone"' } },
        { metadata: { contains: '"customerName"' } },
        { metadata: { contains: '"inviteeEmail"' } },
        { metadata: { contains: "@" } },
      ],
    },
    select: { id: true, userId: true, metadata: true, createdAt: true },
    take: cap * 4,
  });
  const userAcc = new Map<string, Acc>();
  for (const log of logs) {
    const cal = calendarYearRetentionEligibleAt(log.createdAt, policy.years, "UTC");
    if (!cal.ok || now.getTime() < cal.eligibleAt.getTime()) continue;
    const { changed } = scrubPiiKeysInMetadataString(log.metadata);
    if (!changed) continue;
    if (!log.userId) continue;
    addRecord(userAcc, log.userId, log.id);
  }

  let n = 0;
  for (const [businessId, rec] of bizAcc) {
    if (n >= cap) break;
    n += 1;
    const hold = await holds.businessDecision(businessId, "audit");
    applySubject(
      result,
      await decideEnqueue({
        kind: "audit_scrub",
        subjectType: "business",
        subjectId: businessId,
        mode,
        candidateRecordIds: rec.recordIds,
        candidateCount: rec.count,
        hold,
      }),
    );
  }
  for (const [userId, rec] of userAcc) {
    if (n >= cap) break;
    n += 1;
    const hold = await holds.userDecision(userId, "audit");
    applySubject(
      result,
      await decideEnqueue({
        kind: "audit_scrub",
        subjectType: "user",
        subjectId: userId,
        mode,
        candidateRecordIds: rec.recordIds,
        candidateCount: rec.count,
        hold,
      }),
    );
  }
}

/**
 * Discover eligible category-retention work and enqueue DataLifecycleJob rows.
 * Never calls category runners. Never mutates QR/guest/notify/audit/support/billing/staff/financial rows.
 */
export async function sweepCategoryRetention(opts?: CategorySweepOptions): Promise<CategorySweepResult> {
  const env = opts?.env ?? process.env;
  const now = opts?.now ?? new Date();
  const mode = resolveCategorySweepMode(env, opts);
  const result = emptyResult(mode, now);
  if (mode === "off") return result;

  const holds = new HoldLookup();
  await sweepAnalytics(opts ?? {}, mode, holds, result);
  await sweepGuest(opts ?? {}, mode, holds, result);
  await sweepNotify(opts ?? {}, mode, holds, result);
  await sweepSupport(opts ?? {}, mode, holds, result);
  await sweepStaff(opts ?? {}, mode, holds, result);
  await sweepBilling(opts ?? {}, mode, holds, result);
  await sweepAudit(opts ?? {}, mode, holds, result);
  return result;
}
