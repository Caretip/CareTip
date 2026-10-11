import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

const now = new Date();

const totalEmployeeStripe = await prisma.employeeStripeAccount.count();
const dueEmployeeStripe = await prisma.employeeStripeAccount.count({
  where: {
    bankPayoutSchedule: "every_3_days",
    bankPayoutNextScheduledAt: { lte: now },
    stripePayoutsEnabled: true,
    employee: {
      isDeleted: false,
      isActive: true,
      activationStatus: "active",
      user: { isActive: true, legalHold: false },
      business: { deletedAt: null, legalHold: false },
    },
  },
});

const sample = await prisma.employeeStripeAccount.findMany({
  take: 15,
  orderBy: { bankPayoutNextScheduledAt: "asc" },
  select: {
    employeeId: true,
    bankPayoutSchedule: true,
    bankPayoutNextScheduledAt: true,
    stripePayoutsEnabled: true,
    employee: {
      select: {
        businessId: true,
        isDeleted: true,
        isActive: true,
        activationStatus: true,
      },
    },
  },
});

function mask(id) {
  if (!id) return null;
  return `${String(id).slice(0, 8)}…`;
}

console.log(
  JSON.stringify(
    {
      diagnosticAtUtc: now.toISOString(),
      totalEmployeeStripeAccountRows: totalEmployeeStripe,
      cronEligibleEmployeeCount: dueEmployeeStripe,
      earliestScheduledSamples: sample.map((r) => ({
        employeeIdMasked: mask(r.employeeId),
        businessIdMasked: mask(r.employee.businessId),
        schedule: r.bankPayoutSchedule,
        nextAt: r.bankPayoutNextScheduledAt?.toISOString() ?? null,
        payoutsEnabled: r.stripePayoutsEnabled,
        empActive: r.employee.isActive && !r.employee.isDeleted,
        activation: r.employee.activationStatus,
      })),
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
