import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

const bizId = "cmulizt7g0007u7q4auzhlvbm";

const pendingObs = await prisma.stripeConnectPayout.findMany({
  where: { businessId: bizId, status: "pending" },
  select: {
    stripePayoutId: true,
    amountCents: true,
    stripeCreatedAt: true,
    lastStripeEventType: true,
    lastStripeEventCreated: true,
    createdAt: true,
    failureCode: true,
  },
});

const allLedger = await prisma.stripeConnectScheduledPayoutRequest.findMany({
  where: { businessId: bizId },
  orderBy: { createdAt: "desc" },
  select: {
    scheduleWindowKey: true,
    status: true,
    failureCode: true,
    amountCents: true,
    stripePayoutId: true,
    createdAt: true,
    updatedAt: true,
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
      pendingStripeConnectPayoutObservations: pendingObs.map((p) => ({
        stripePayoutId: mask(p.stripePayoutId),
        amountCents: p.amountCents,
        stripeCreatedAt: p.stripeCreatedAt.toISOString(),
        lastStripeEventType: p.lastStripeEventType,
        lastStripeEventCreated: p.lastStripeEventCreated,
        ingestedAt: p.createdAt.toISOString(),
        failureCode: p.failureCode,
      })),
      scheduledPayoutLedgerAll: allLedger.map((r) => ({
        scheduleWindowKey: r.scheduleWindowKey,
        status: r.status,
        failureCode: r.failureCode,
        amountCents: r.amountCents,
        stripePayoutId: mask(r.stripePayoutId),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
