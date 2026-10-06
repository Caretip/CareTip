import {
  PlatformProductFeedbackAdminStatus,
  Prisma,
  Role,
  type PlatformProductFeedback,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import { getBusinessByUserId } from "./business.service.js";
import { writeAuditLog } from "./audit.service.js";
import {
  computeAverageRating,
  computeRatingDistribution,
  type ParsedPlatformProductFeedbackPayload,
  type PlatformProductFeedbackAdminStatusParsed,
} from "../lib/platformProductFeedbackValidation.js";

export type PlatformProductFeedbackDto = {
  id: string;
  rating: number;
  comment: string | null;
  submitterRole: Role;
  businessId: string | null;
  employeeId: string | null;
  adminStatus: PlatformProductFeedbackAdminStatus;
  createdAt: string;
  updatedAt: string;
};

export type PlatformProductFeedbackAdminListItem = PlatformProductFeedbackDto & {
  businessName: string | null;
  employeeName: string | null;
  userEmail: string | null;
  commentExcerpt: string | null;
};

export type PlatformProductFeedbackAdminDetail = PlatformProductFeedbackAdminListItem;

export type PlatformProductFeedbackSummary = {
  totalCount: number;
  averageRating: number | null;
  ratingDistribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  countBySubmitterRole: { MANAGER: number; EMPLOYEE: number };
  /** Submissions in the last 30 days (UTC), all admin statuses included. */
  recentCount30d: number;
};

const COMMENT_EXCERPT_LEN = 160;

function toDto(row: PlatformProductFeedback): PlatformProductFeedbackDto {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    submitterRole: row.submitterRole,
    businessId: row.businessId,
    employeeId: row.employeeId,
    adminStatus: row.adminStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function excerpt(comment: string | null): string | null {
  if (!comment) return null;
  if (comment.length <= COMMENT_EXCERPT_LEN) return comment;
  return `${comment.slice(0, COMMENT_EXCERPT_LEN - 1)}…`;
}

export class PlatformProductFeedbackError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "FORBIDDEN" | "PRECONDITION" = "PRECONDITION",
  ) {
    super(message);
    this.name = "PlatformProductFeedbackError";
  }
}

async function resolveSubmitterContext(
  userId: string,
  role: Role,
): Promise<{
  submitterRole: Role;
  businessId: string | null;
  employeeId: string | null;
}> {
  if (role === Role.MANAGER) {
    const business = await getBusinessByUserId(userId);
    if (!business) {
      throw new PlatformProductFeedbackError("Business account not found.", "PRECONDITION");
    }
    return {
      submitterRole: Role.MANAGER,
      businessId: business.id,
      employeeId: null,
    };
  }
  if (role === Role.EMPLOYEE) {
    const employee = await prisma.employee.findFirst({
      where: { userId, isDeleted: false },
      select: { id: true, businessId: true },
    });
    if (!employee) {
      throw new PlatformProductFeedbackError("Employee profile not found.", "PRECONDITION");
    }
    return {
      submitterRole: Role.EMPLOYEE,
      businessId: employee.businessId,
      employeeId: employee.id,
    };
  }
  throw new PlatformProductFeedbackError("Insufficient permissions.", "FORBIDDEN");
}

export type MyPlatformProductFeedbackOverview = {
  latest: PlatformProductFeedbackDto | null;
};

export async function getMyPlatformProductFeedbackOverview(
  userId: string,
): Promise<MyPlatformProductFeedbackOverview> {
  const row = await prisma.platformProductFeedback.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return { latest: row ? toDto(row) : null };
}

/** Creates a new submission; never updates or replaces prior feedback for the user. */
export async function createMyPlatformProductFeedback(input: {
  userId: string;
  role: Role;
  payload: ParsedPlatformProductFeedbackPayload;
}): Promise<{ feedback: PlatformProductFeedbackDto }> {
  const ctx = await resolveSubmitterContext(input.userId, input.role);

  const row = await prisma.platformProductFeedback.create({
    data: {
      userId: input.userId,
      submitterRole: ctx.submitterRole,
      businessId: ctx.businessId,
      employeeId: ctx.employeeId,
      rating: input.payload.rating,
      comment: input.payload.comment,
      adminStatus: PlatformProductFeedbackAdminStatus.new,
    },
  });

  return { feedback: toDto(row) };
}

export type AdminListPlatformProductFeedbackOpts = {
  take: number;
  skip: number;
  rating?: number;
  submitterRole?: Role;
  adminStatus?: PlatformProductFeedbackAdminStatus;
  createdFrom?: Date;
  createdTo?: Date;
};

export async function listPlatformProductFeedbackAdmin(
  opts: AdminListPlatformProductFeedbackOpts,
): Promise<{ total: number; items: PlatformProductFeedbackAdminListItem[] }> {
  const where: Prisma.PlatformProductFeedbackWhereInput = {
    ...(opts.rating != null ? { rating: opts.rating } : {}),
    ...(opts.submitterRole ? { submitterRole: opts.submitterRole } : {}),
    ...(opts.adminStatus ? { adminStatus: opts.adminStatus } : {}),
    ...(opts.createdFrom || opts.createdTo
      ? {
          createdAt: {
            ...(opts.createdFrom ? { gte: opts.createdFrom } : {}),
            ...(opts.createdTo ? { lte: opts.createdTo } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.platformProductFeedback.count({ where }),
    prisma.platformProductFeedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.take,
      skip: opts.skip,
      include: {
        business: { select: { name: true } },
        employee: { select: { name: true } },
        user: { select: { email: true } },
      },
    }),
  ]);

  return {
    total,
    items: rows.map((row) => ({
      ...toDto(row),
      businessName: row.business?.name ?? null,
      employeeName: row.employee?.name ?? null,
      userEmail: row.user?.email ?? null,
      commentExcerpt: excerpt(row.comment),
    })),
  };
}

export async function getPlatformProductFeedbackAdminById(
  id: string,
): Promise<PlatformProductFeedbackAdminDetail | null> {
  const row = await prisma.platformProductFeedback.findUnique({
    where: { id },
    include: {
      business: { select: { name: true } },
      employee: { select: { name: true } },
      user: { select: { email: true } },
    },
  });
  if (!row) return null;
  return {
    ...toDto(row),
    businessName: row.business?.name ?? null,
    employeeName: row.employee?.name ?? null,
    userEmail: row.user?.email ?? null,
    commentExcerpt: excerpt(row.comment),
  };
}

export async function updatePlatformProductFeedbackAdminStatus(input: {
  adminUserId: string;
  feedbackId: string;
  adminStatus: PlatformProductFeedbackAdminStatusParsed;
}): Promise<PlatformProductFeedbackAdminDetail> {
  const existing = await prisma.platformProductFeedback.findUnique({
    where: { id: input.feedbackId },
    select: { id: true, adminStatus: true },
  });
  if (!existing) {
    throw new PlatformProductFeedbackError("Product feedback not found.", "NOT_FOUND");
  }

  const nextStatus = input.adminStatus as PlatformProductFeedbackAdminStatus;
  await prisma.platformProductFeedback.update({
    where: { id: input.feedbackId },
    data: { adminStatus: nextStatus },
  });

  void writeAuditLog({
    userId: input.adminUserId,
    action: "platform_product_feedback.admin_status_changed",
    metadata: JSON.stringify({
      feedbackId: input.feedbackId,
      from: existing.adminStatus,
      to: nextStatus,
    }),
  });

  const detail = await getPlatformProductFeedbackAdminById(input.feedbackId);
  if (!detail) {
    throw new PlatformProductFeedbackError("Product feedback not found.", "NOT_FOUND");
  }
  return detail;
}

/** All rows included regardless of adminStatus (archived rows still count toward product health). */
export async function getPlatformProductFeedbackSummary(): Promise<PlatformProductFeedbackSummary> {
  const rows = await prisma.platformProductFeedback.findMany({
    select: { rating: true, submitterRole: true, createdAt: true },
  });

  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  let manager = 0;
  let employee = 0;
  let recentCount30d = 0;
  for (const row of rows) {
    if (row.submitterRole === Role.MANAGER) manager += 1;
    else if (row.submitterRole === Role.EMPLOYEE) employee += 1;
    if (now - row.createdAt.getTime() <= thirtyDaysMs) recentCount30d += 1;
  }

  return {
    totalCount: rows.length,
    averageRating: computeAverageRating(rows),
    ratingDistribution: computeRatingDistribution(rows),
    countBySubmitterRole: { MANAGER: manager, EMPLOYEE: employee },
    recentCount30d,
  };
}
