import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

export type CustomerFeedbackRow = {
  id: string;
  transactionId: string;
  employeeId: string | null;
  employeeName: string;
  rating: number | null;
  comment: string | null;
  tags: string[];
  customerName: string | null;
  createdAt: string;
};

export type CustomerFeedbackSummary = {
  averageRating: number | null;
  ratingCount: number;
  feedbackCount: number;
};

function roundRating(avg: number): number {
  return Math.round(avg * 10) / 10;
}

/** Per-employee average ratings for business roster stats. */
export async function queryEmployeeRatingAggregates(
  businessId: string,
): Promise<Map<string, { average: number; count: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ employee_id: string; average: number; count: number }>
  >(Prisma.sql`
    SELECT
      employee_id,
      AVG(rating)::float AS average,
      COUNT(*)::int AS count
    FROM tip_feedback
    WHERE business_id = ${businessId}
      AND rating IS NOT NULL
      AND employee_id IS NOT NULL
    GROUP BY employee_id
  `);
  const m = new Map<string, { average: number; count: number }>();
  for (const r of rows) {
    m.set(r.employee_id, {
      average: roundRating(Number(r.average)),
      count: Number(r.count),
    });
  }
  return m;
}

export async function getBusinessFeedbackSummary(
  businessId: string,
): Promise<CustomerFeedbackSummary> {
  const rows = await prisma.$queryRaw<
    Array<{ average: number | null; rating_count: number; feedback_count: number }>
  >(Prisma.sql`
    SELECT
      AVG(rating)::float AS average,
      COUNT(*) FILTER (WHERE rating IS NOT NULL)::int AS rating_count,
      COUNT(*)::int AS feedback_count
    FROM tip_feedback
    WHERE business_id = ${businessId}
  `);
  const row = rows[0];
  const avg = row?.average;
  return {
    averageRating:
      avg != null && Number.isFinite(Number(avg)) ? roundRating(Number(avg)) : null,
    ratingCount: Number(row?.rating_count ?? 0),
    feedbackCount: Number(row?.feedback_count ?? 0),
  };
}

async function assertEmployeeInBusiness(businessId: string, employeeId: string): Promise<boolean> {
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, businessId },
    select: { id: true },
  });
  return emp != null;
}

export async function listBusinessCustomerFeedback(opts: {
  businessId: string;
  take: number;
  skip: number;
  employeeId?: string;
}): Promise<{ total: number; items: CustomerFeedbackRow[]; summary: CustomerFeedbackSummary }> {
  if (opts.employeeId) {
    const ok = await assertEmployeeInBusiness(opts.businessId, opts.employeeId);
    if (!ok) {
      const summary = await getBusinessFeedbackSummary(opts.businessId);
      return { total: 0, items: [], summary };
    }
  }

  const where: Prisma.TipFeedbackWhereInput = {
    businessId: opts.businessId,
    ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
  };

  const [total, rows, summary] = await Promise.all([
    prisma.tipFeedback.count({ where }),
    prisma.tipFeedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.take,
      skip: opts.skip,
      select: {
        id: true,
        transactionId: true,
        employeeId: true,
        rating: true,
        comment: true,
        tags: true,
        customerName: true,
        createdAt: true,
      },
    }),
    getBusinessFeedbackSummary(opts.businessId),
  ]);

  const employeeIds = [...new Set(rows.map((r) => r.employeeId).filter((id): id is string => Boolean(id)))];
  const employees =
    employeeIds.length > 0
      ? await prisma.employee.findMany({
          where: { id: { in: employeeIds }, businessId: opts.businessId },
          select: { id: true, name: true },
        })
      : [];
  const nameById = new Map(employees.map((e) => [e.id, e.name ?? "Staff"]));

  return {
    total,
    summary,
    items: rows.map((r) => ({
      id: r.id,
      transactionId: r.transactionId,
      employeeId: r.employeeId,
      employeeName: r.employeeId ? (nameById.get(r.employeeId) ?? "Staff") : "Former staff",
      rating: r.rating,
      comment: r.comment,
      tags: r.tags,
      customerName: r.customerName,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
