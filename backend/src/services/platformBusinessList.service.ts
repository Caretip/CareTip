import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { sanitizeLikeContainsSearch } from "../utils/likeSearch.js";
import { parseBoundedSkip } from "../utils/paginationLimits.js";
import { parseKycDocuments, type KycDocuments } from "./kyc.service.js";
import {
  isKycSlaBreached,
  kycHoursPending,
  type KycReviewHistoryEntry,
} from "./platform.service.js";

export type PlatformBusinessStatusFilter =
  | "all"
  | "verified"
  | "pending_review"
  | "awaiting_upload"
  | "sla_breach"
  | "rejected"
  | "suspended"
  | "inactive"
  | "draft"
  | "submitted"
  | "approved"
  | "not_started";

export type PlatformBusinessDatePreset =
  | "all"
  | "today"
  | "last_7"
  | "last_30"
  | "this_month"
  | "last_month"
  | "custom";

export type PlatformBusinessTipsFilter =
  | "all"
  | "zero"
  | "1_500"
  | "501_5000"
  | "5001_plus"
  | "highest"
  | "lowest";

export type PlatformBusinessSort =
  | "newest"
  | "oldest"
  | "tips_high"
  | "tips_low"
  | "name_asc"
  | "name_desc";

export type ListPlatformBusinessesParams = {
  q?: string;
  status?: PlatformBusinessStatusFilter;
  /** When set, status filters apply to onboarding or KYC columns respectively. */
  workflow?: "onboarding" | "kyc";
  datePreset?: PlatformBusinessDatePreset;
  dateFrom?: string;
  dateTo?: string;
  tips?: PlatformBusinessTipsFilter;
  sort?: PlatformBusinessSort;
  take: number;
  skip: number;
};

type PlatformBusinessActivityRow = {
  id: string;
  name: string;
  slug: string;
  verification_status: string;
  onboarding_verification_status: string;
  kyc_verification_status: string;
  legal_contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  registered_address: string | null;
  logo_path: string | null;
  verification_document_path: string | null;
  kyc_documents: unknown;
  kyc_submitted_at: Date | null;
  kyc_review_notes: string | null;
  kyc_review_history: unknown;
  owner_user_id: string;
  owner_email: string;
  owner_created_at: Date;
  owner_is_active: boolean;
  operational_status: string;
  staff_count: number;
  location_count: number;
  total_tips_eur: number;
  success_tip_count: number;
  subscription_tier: string;
  subscription_status: string | null;
  cancel_at_period_end: boolean | null;
  has_completed_onboarding: boolean;
};

function parseKycReviewHistory(raw: unknown): KycReviewHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is KycReviewHistoryEntry => {
      if (!x || typeof x !== "object") return false;
      const o = x as Record<string, unknown>;
      return (
        (o.status === "pending" || o.status === "verified" || o.status === "rejected") &&
        typeof o.at === "string"
      );
    })
    .map((x) => ({
      status: x.status,
      at: x.at,
      note: typeof x.note === "string" ? x.note : null,
    }));
}

function mapBusinessRow(b: PlatformBusinessActivityRow) {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    verificationStatus: b.verification_status,
    onboardingVerificationStatus: b.onboarding_verification_status,
    kycVerificationStatus: b.kyc_verification_status,
    legalContactName: b.legal_contact_name,
    contactEmail: b.contact_email,
    contactPhone: b.contact_phone,
    website: b.website,
    registeredAddress: b.registered_address,
    ownerUserId: b.owner_user_id,
    ownerEmail: b.owner_email,
    registeredAt: b.owner_created_at.toISOString(),
    ownerIsActive: Boolean(b.owner_is_active),
    operationalStatus: b.operational_status as "active" | "suspended" | "inactive",
    staffCount: Number(b.staff_count ?? 0),
    locationCount: Number(b.location_count ?? 0),
    logoPath: b.logo_path,
    verificationDocumentPath: b.verification_document_path,
    kycDocuments: parseKycDocuments(b.kyc_documents) as KycDocuments,
    kycSubmittedAt: b.kyc_submitted_at?.toISOString() ?? null,
    kycReviewNotes: b.kyc_review_notes,
    kycReviewHistory: parseKycReviewHistory(b.kyc_review_history),
    kycHoursPending: kycHoursPending(b.kyc_submitted_at),
    kycSlaBreached: isKycSlaBreached(b.kyc_submitted_at, b.kyc_verification_status),
    totalTipsEur: Number(b.total_tips_eur ?? 0),
    successTipCount: Number(b.success_tip_count ?? 0),
    subscriptionTier: b.subscription_tier as "basic" | "premium" | "enterprise",
    subscriptionStatus: b.subscription_status,
    cancelAtPeriodEnd: Boolean(b.cancel_at_period_end),
    hasCompletedOnboarding: Boolean(b.has_completed_onboarding),
  };
}

const BUSINESS_LIST_FROM = Prisma.sql`
  FROM businesses b
  INNER JOIN "User" u ON u.id = b.user_id
  LEFT JOIN subscriptions s ON s.business_id = b.id
  LEFT JOIN (
    SELECT
      business_id,
      SUM(amount)::float AS total_tips_eur,
      COUNT(*)::int AS success_tip_count
    FROM tips
    WHERE status = 'success'
    GROUP BY business_id
  ) ts ON ts.business_id = b.id
  LEFT JOIN (
    SELECT business_id, COUNT(*)::int AS staff_count
    FROM employees
    WHERE is_deleted = false
    GROUP BY business_id
  ) sc ON sc.business_id = b.id
  LEFT JOIN (
    SELECT business_id, COUNT(*)::int AS location_count
    FROM locations
    GROUP BY business_id
  ) lc ON lc.business_id = b.id
`;

const BUSINESS_LIST_SELECT = Prisma.sql`
  SELECT
    b.id,
    b.name,
    b.slug,
    b.verification_status,
    b.onboarding_verification_status,
    b.kyc_verification_status,
    b.legal_contact_name,
    b.contact_email,
    b.contact_phone,
    b.website,
    b.registered_address,
    b.logo_path,
    b.verification_document_path,
    b.kyc_documents,
    b.kyc_submitted_at,
    b.kyc_review_notes,
    b.kyc_review_history,
    u.id AS owner_user_id,
    u.email AS owner_email,
    u.created_at AS owner_created_at,
    u.is_active AS owner_is_active,
    b.operational_status,
    COALESCE(sc.staff_count, 0)::int AS staff_count,
    COALESCE(lc.location_count, 0)::int AS location_count,
    COALESCE(ts.total_tips_eur, 0)::float AS total_tips_eur,
    COALESCE(ts.success_tip_count, 0)::int AS success_tip_count,
    b.subscription_tier,
    s.status AS subscription_status,
    s.cancel_at_period_end,
    u.has_completed_onboarding
`;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function resolveDateRange(
  preset: PlatformBusinessDatePreset,
  dateFrom?: string,
  dateTo?: string,
): { start?: Date; endExclusive?: Date } {
  const now = new Date();
  if (preset === "all") return {};
  if (preset === "today") {
    const start = startOfUtcDay(now);
    const endExclusive = new Date(start);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    return { start, endExclusive };
  }
  if (preset === "last_7") {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 7);
    return { start, endExclusive: now };
  }
  if (preset === "last_30") {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 30);
    return { start, endExclusive: now };
  }
  if (preset === "this_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start, endExclusive: now };
  }
  if (preset === "last_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start, endExclusive };
  }
  if (preset === "custom") {
    const fromParsed = dateFrom ? new Date(dateFrom) : undefined;
    const toParsed = dateTo ? new Date(dateTo) : undefined;
    if (fromParsed && !Number.isNaN(fromParsed.getTime())) {
      const start = startOfUtcDay(fromParsed);
      let endExclusive: Date | undefined;
      if (toParsed && !Number.isNaN(toParsed.getTime())) {
        endExclusive = startOfUtcDay(toParsed);
        endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      }
      return { start, endExclusive };
    }
  }
  return {};
}

function buildWhereClause(params: ListPlatformBusinessesParams): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`b.deleted_at IS NULL`];

  const q = sanitizeLikeContainsSearch(params.q);
  if (q) {
    const pattern = `%${q}%`;
    parts.push(Prisma.sql`(
      b.name ILIKE ${pattern} ESCAPE '\\'
      OR b.slug ILIKE ${pattern} ESCAPE '\\'
      OR u.email ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(b.contact_email, '') ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(b.contact_phone, '') ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(b.legal_contact_name, '') ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(b.registered_address, '') ILIKE ${pattern} ESCAPE '\\'
    )`);
  }

  const status = params.status ?? "all";
  const workflow = params.workflow ?? "kyc";

  if (workflow === "onboarding") {
    if (status === "draft") {
      parts.push(Prisma.sql`b.onboarding_verification_status = 'draft'`);
    } else if (status === "submitted") {
      parts.push(Prisma.sql`b.onboarding_verification_status = 'submitted'`);
    } else if (status === "approved") {
      parts.push(Prisma.sql`b.onboarding_verification_status = 'approved'`);
    } else if (status === "rejected") {
      parts.push(Prisma.sql`b.onboarding_verification_status = 'rejected'`);
    } else if (status === "suspended") {
      parts.push(Prisma.sql`b.operational_status = 'suspended'`);
    } else if (status === "inactive") {
      parts.push(Prisma.sql`b.operational_status = 'inactive'`);
    }
  } else if (status === "verified") {
    parts.push(Prisma.sql`b.kyc_verification_status = 'verified'`);
  } else if (status === "rejected") {
    parts.push(Prisma.sql`b.kyc_verification_status = 'rejected'`);
  } else if (status === "pending_review") {
    parts.push(Prisma.sql`b.kyc_verification_status = 'pending_review'`);
  } else if (status === "awaiting_upload") {
    parts.push(Prisma.sql`b.kyc_verification_status = 'awaiting_upload'`);
  } else if (status === "not_started") {
    parts.push(Prisma.sql`b.kyc_verification_status = 'not_started'`);
  } else if (status === "sla_breach") {
    parts.push(Prisma.sql`
      b.kyc_verification_status = 'pending_review'
      AND b.kyc_submitted_at IS NOT NULL
      AND b.kyc_submitted_at < NOW() - (48::int * INTERVAL '1 hour')
    `);
  } else if (status === "suspended") {
    parts.push(Prisma.sql`b.operational_status = 'suspended'`);
  } else if (status === "inactive") {
    parts.push(Prisma.sql`b.operational_status = 'inactive'`);
  }

  const datePreset = params.datePreset ?? "all";
  const { start, endExclusive } = resolveDateRange(datePreset, params.dateFrom, params.dateTo);
  if (start) {
    parts.push(Prisma.sql`u.created_at >= ${start}`);
  }
  if (endExclusive) {
    parts.push(Prisma.sql`u.created_at < ${endExclusive}`);
  }

  const tips = params.tips ?? "all";
  if (tips === "zero") {
    parts.push(Prisma.sql`COALESCE(ts.total_tips_eur, 0) = 0`);
  } else if (tips === "1_500") {
    parts.push(Prisma.sql`COALESCE(ts.total_tips_eur, 0) >= 1 AND COALESCE(ts.total_tips_eur, 0) <= 500`);
  } else if (tips === "501_5000") {
    parts.push(Prisma.sql`COALESCE(ts.total_tips_eur, 0) >= 501 AND COALESCE(ts.total_tips_eur, 0) <= 5000`);
  } else if (tips === "5001_plus") {
    parts.push(Prisma.sql`COALESCE(ts.total_tips_eur, 0) >= 5001`);
  }

  if (parts.length === 0) {
    return Prisma.sql`WHERE 1=1`;
  }
  return Prisma.sql`WHERE ${Prisma.join(parts, " AND ")}`;
}

function resolveSort(params: ListPlatformBusinessesParams): PlatformBusinessSort {
  const tips = params.tips ?? "all";
  if (tips === "highest") return "tips_high";
  if (tips === "lowest") return "tips_low";
  return params.sort ?? "newest";
}

function buildOrderBy(sort: PlatformBusinessSort): Prisma.Sql {
  switch (sort) {
    case "oldest":
      return Prisma.sql`u.created_at ASC, b.name ASC`;
    case "tips_high":
      return Prisma.sql`COALESCE(ts.total_tips_eur, 0) DESC, b.name ASC`;
    case "tips_low":
      return Prisma.sql`COALESCE(ts.total_tips_eur, 0) ASC, b.name ASC`;
    case "name_asc":
      return Prisma.sql`b.name ASC`;
    case "name_desc":
      return Prisma.sql`b.name DESC`;
    case "newest":
    default:
      return Prisma.sql`u.created_at DESC, b.name ASC`;
  }
}

export function hasBusinessListQueryParams(query: Record<string, unknown>): boolean {
  const keys = ["q", "status", "workflow", "date", "dateFrom", "dateTo", "tips", "sort", "take", "skip", "page"];
  return keys.some((k) => {
    const v = query[k];
    return typeof v === "string" && v.trim() !== "";
  });
}

export function parseBusinessListQuery(query: Record<string, unknown>): ListPlatformBusinessesParams {
  const statusRaw = typeof query.status === "string" ? query.status : "all";
  const allowedStatus = new Set<PlatformBusinessStatusFilter>([
    "all",
    "verified",
    "pending_review",
    "awaiting_upload",
    "sla_breach",
    "rejected",
    "suspended",
    "inactive",
    "draft",
    "submitted",
    "approved",
    "not_started",
  ]);
  const status = allowedStatus.has(statusRaw as PlatformBusinessStatusFilter)
    ? (statusRaw as PlatformBusinessStatusFilter)
    : "all";

  const workflowRaw = typeof query.workflow === "string" ? query.workflow : "kyc";
  const workflow = workflowRaw === "onboarding" ? "onboarding" : "kyc";

  const dateRaw = typeof query.date === "string" ? query.date : "all";
  const allowedDate = new Set<PlatformBusinessDatePreset>([
    "all",
    "today",
    "last_7",
    "last_30",
    "this_month",
    "last_month",
    "custom",
  ]);
  const datePreset = allowedDate.has(dateRaw as PlatformBusinessDatePreset)
    ? (dateRaw as PlatformBusinessDatePreset)
    : "all";

  const tipsRaw = typeof query.tips === "string" ? query.tips : "all";
  const allowedTips = new Set<PlatformBusinessTipsFilter>([
    "all",
    "zero",
    "1_500",
    "501_5000",
    "5001_plus",
    "highest",
    "lowest",
  ]);
  const tips = allowedTips.has(tipsRaw as PlatformBusinessTipsFilter)
    ? (tipsRaw as PlatformBusinessTipsFilter)
    : "all";

  const sortRaw = typeof query.sort === "string" ? query.sort : "newest";
  const allowedSort = new Set<PlatformBusinessSort>([
    "newest",
    "oldest",
    "tips_high",
    "tips_low",
    "name_asc",
    "name_desc",
  ]);
  const sort = allowedSort.has(sortRaw as PlatformBusinessSort)
    ? (sortRaw as PlatformBusinessSort)
    : "newest";

  const take = Math.min(Math.max(Number(query.take) || 25, 1), 100);
  const page = Math.max(Number(query.page) || 0, 0);
  const skip =
    query.skip != null && query.skip !== ""
      ? parseBoundedSkip(query.skip)
      : parseBoundedSkip(page * take);

  return {
    q: typeof query.q === "string" ? query.q : undefined,
    status,
    workflow,
    datePreset,
    dateFrom: typeof query.dateFrom === "string" ? query.dateFrom : undefined,
    dateTo: typeof query.dateTo === "string" ? query.dateTo : undefined,
    tips,
    sort,
    take,
    skip,
  };
}

export async function listPlatformBusinesses(
  params: ListPlatformBusinessesParams,
): Promise<{ items: ReturnType<typeof mapBusinessRow>[]; total: number }> {
  const where = buildWhereClause(params);
  const orderBy = buildOrderBy(resolveSort(params));

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<PlatformBusinessActivityRow[]>(Prisma.sql`
      ${BUSINESS_LIST_SELECT}
      ${BUSINESS_LIST_FROM}
      ${where}
      ORDER BY ${orderBy}
      LIMIT ${params.take} OFFSET ${params.skip}
    `),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      ${BUSINESS_LIST_FROM}
      ${where}
    `),
  ]);

  return {
    items: rows.map(mapBusinessRow),
    total: Number(countRows[0]?.count ?? 0),
  };
}

export type OnboardingQueueMetrics = {
  draft: number;
  submitted: number;
  approved: number;
  rejected: number;
};

const ONBOARDING_KPI_STATUSES: Array<{
  status: PlatformBusinessStatusFilter;
  key: keyof OnboardingQueueMetrics;
}> = [
  { status: "draft", key: "draft" },
  { status: "submitted", key: "submitted" },
  { status: "approved", key: "approved" },
  { status: "rejected", key: "rejected" },
];

/**
 * Onboarding KPI counts — uses the same FROM/WHERE clauses as {@link listPlatformBusinesses}
 * so summary cards always match status-filtered table totals.
 */
export async function getOnboardingQueueMetrics(): Promise<OnboardingQueueMetrics> {
  const counts: OnboardingQueueMetrics = {
    draft: 0,
    submitted: 0,
    approved: 0,
    rejected: 0,
  };

  await Promise.all(
    ONBOARDING_KPI_STATUSES.map(async ({ status, key }) => {
      const where = buildWhereClause({
        workflow: "onboarding",
        status,
        take: 1,
        skip: 0,
      });
      const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        ${BUSINESS_LIST_FROM}
        ${where}
      `);
      counts[key] = Number(countRows[0]?.count ?? 0);
    }),
  );

  return counts;
}

export type KycQueueMetrics = {
  pendingReview: number;
  awaitingUpload: number;
  slaBreached: number;
  verified: number;
  slaHours: number;
};

const KYC_SLA_HOURS = 48;

const KYC_KPI_STATUSES: Array<{
  status: PlatformBusinessStatusFilter;
  key: keyof Omit<KycQueueMetrics, "slaHours">;
}> = [
  { status: "pending_review", key: "pendingReview" },
  { status: "awaiting_upload", key: "awaitingUpload" },
  { status: "sla_breach", key: "slaBreached" },
  { status: "verified", key: "verified" },
];

/**
 * KYC KPI counts — uses the same FROM/WHERE clauses as {@link listPlatformBusinesses}.
 */
export async function getKycQueueMetrics(): Promise<KycQueueMetrics> {
  const counts: Omit<KycQueueMetrics, "slaHours"> = {
    pendingReview: 0,
    awaitingUpload: 0,
    slaBreached: 0,
    verified: 0,
  };

  await Promise.all(
    KYC_KPI_STATUSES.map(async ({ status, key }) => {
      const where = buildWhereClause({
        workflow: "kyc",
        status,
        take: 1,
        skip: 0,
      });
      const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        ${BUSINESS_LIST_FROM}
        ${where}
      `);
      counts[key] = Number(countRows[0]?.count ?? 0);
    }),
  );

  return { ...counts, slaHours: KYC_SLA_HOURS };
}

/** Businesses with onboarding approved and KYC verified (fully operational). */
export async function getFullyVerifiedBusinessCount(): Promise<number> {
  const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    ${BUSINESS_LIST_FROM}
    WHERE b.deleted_at IS NULL
      AND b.onboarding_verification_status = 'approved'
      AND b.kyc_verification_status = 'verified'
  `);
  return Number(countRows[0]?.count ?? 0);
}
