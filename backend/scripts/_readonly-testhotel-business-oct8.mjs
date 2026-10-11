import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

const bizId = "cmqexplaj0021n83qbet06d89";

const ledger = await prisma.stripeConnectScheduledPayoutRequest.findMany({
  where: { businessId: bizId },
  orderBy: { createdAt: "asc" },
});

const payouts = await prisma.stripeConnectPayout.findMany({
  where: {
    businessId: bizId,
    stripeCreatedAt: {
      gte: new Date("2026-10-05T00:00:00.000Z"),
      lte: new Date("2026-10-12T00:00:00.000Z"),
    },
  },
  orderBy: { stripeCreatedAt: "asc" },
});

function mask(id) {
  if (!id) return null;
  return `${String(id).slice(0, 6)}…${String(id).slice(-4)}`;
}

console.log(
  JSON.stringify(
    {
      businessId: bizId,
      scheduledLedger: ledger.map((r) => ({
        window: r.scheduleWindowKey,
        status: r.status,
        failureCode: r.failureCode,
        amountCents: r.amountCents,
        payout: mask(r.stripePayoutId),
        createdAt: r.createdAt.toISOString(),
      })),
      connectPayoutsOct5to11: payouts.map((p) => ({
        payout: mask(p.stripePayoutId),
        status: p.status,
        amountCents: p.amountCents,
        stripeCreatedAt: p.stripeCreatedAt.toISOString(),
        lastEvent: p.lastStripeEventType,
      })),
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
