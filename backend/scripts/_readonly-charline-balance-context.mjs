import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

const employeeId = "cmtlevnof003rjl47ncojnt7h";
const bizId = "cmqexplaj0021n83qbet06d89";

const payables = await prisma.employeeTipPayable.count({
  where: { employeeId, createdAt: { lte: new Date("2026-10-08T08:00:00.000Z") } },
});

const recentPayables = await prisma.employeeTipPayable.findMany({
  where: { employeeId },
  orderBy: { createdAt: "desc" },
  take: 5,
  select: {
    status: true,
    payableCents: true,
    createdAt: true,
    stripeTransferId: true,
  },
});

const instant = await prisma.employeeInstantPayoutRequest.findMany({
  where: { employeeId },
  orderBy: { createdAt: "desc" },
  take: 5,
  select: { status: true, amountCents: true, createdAt: true, failureCode: true },
});

console.log(
  JSON.stringify(
    {
      employeeId,
      payablesCountBeforeOct8Cron: payables,
      recentPayables,
      instantPayoutRequests: instant,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
