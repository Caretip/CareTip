import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

const bizId = "cmulizt7g0007u7q4auzhlvbm";

const emps = await prisma.employee.findMany({
  where: { businessId: bizId },
  select: {
    id: true,
    isDeleted: true,
    isActive: true,
    activationStatus: true,
    user: { select: { isActive: true, legalHold: true } },
  },
  take: 20,
});

const stripeAccts = await prisma.employeeStripeAccount.findMany({
  where: { employeeId: { in: emps.map((e) => e.id) } },
  select: {
    employeeId: true,
    bankPayoutSchedule: true,
    bankPayoutNextScheduledAt: true,
    stripePayoutsEnabled: true,
    stripeAccountId: true,
  },
});

const bizPayouts = await prisma.stripeConnectPayout.findMany({
  where: { businessId: bizId },
  orderBy: { createdAt: "desc" },
  take: 8,
  select: {
    stripePayoutId: true,
    status: true,
    amountCents: true,
    createdAt: true,
    arrivalDate: true,
  },
});

function mask(id) {
  if (!id) return null;
  return `${String(id).slice(0, 6)}…${String(id).slice(-4)}`;
}

console.log(
  JSON.stringify(
    {
      businessId: bizId,
      employeeCount: emps.length,
      employees: emps,
      employeeStripeAccountCount: stripeAccts.length,
      employeeStripeAccounts: stripeAccts.map((a) => ({
        ...a,
        stripeAccountId: mask(a.stripeAccountId),
        bankPayoutNextScheduledAt: a.bankPayoutNextScheduledAt?.toISOString() ?? null,
      })),
      stripeConnectPayoutObservations: bizPayouts.map((p) => ({
        stripePayoutId: mask(p.stripePayoutId),
        status: p.status,
        amountCents: p.amountCents,
        createdAt: p.createdAt.toISOString(),
        arrivalDate: p.arrivalDate?.toISOString() ?? null,
      })),
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
