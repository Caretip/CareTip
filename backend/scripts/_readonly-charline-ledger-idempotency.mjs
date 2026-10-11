import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

const row = await prisma.employeeStripeScheduledPayoutRequest.findUnique({
  where: {
    employeeId_scheduleWindowKey: {
      employeeId: "cmtlevnof003rjl47ncojnt7h",
      scheduleWindowKey: "2026-10-08T07:00:00.000Z",
    },
  },
  select: {
    id: true,
    idempotencyKey: true,
    failureCode: true,
    status: true,
    amountCents: true,
    currency: true,
    createdAt: true,
    updatedAt: true,
  },
});

console.log(JSON.stringify({ ledger: row }, null, 2));
await prisma.$disconnect();
