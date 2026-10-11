/**
 * Read-only Stripe payouts.list for Charline employee account (no creates).
 */
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { getStripeClient, isStripeConfigured } from "../src/services/stripe.service.js";

const employeeId = "cmtlevnof003rjl47ncojnt7h";

if (!isStripeConfigured()) {
  console.log(JSON.stringify({ ok: false, reason: "stripe_not_configured" }));
  process.exit(0);
}

const esa = await prisma.employeeStripeAccount.findUnique({
  where: { employeeId },
  select: { stripeAccountId: true },
});
if (!esa?.stripeAccountId) {
  console.log(JSON.stringify({ ok: false, reason: "no_stripe_account" }));
  process.exit(0);
}

const stripeAccountId = esa.stripeAccountId.trim();
const stripe = getStripeClient();

function mask(id) {
  return `${String(id).slice(0, 6)}…${String(id).slice(-4)}`;
}

const pending = await stripe.payouts.list(
  { status: "pending", limit: 10 },
  { stripeAccount: stripeAccountId },
);

const aroundOct8 = await stripe.payouts.list(
  {
    limit: 20,
    created: {
      gte: Math.floor(Date.parse("2026-10-07T00:00:00.000Z") / 1000),
      lte: Math.floor(Date.parse("2026-10-09T23:59:59.000Z") / 1000),
    },
  },
  { stripeAccount: stripeAccountId },
);

console.log(
  JSON.stringify(
    {
      ok: true,
      stripeAccountIdMasked: mask(stripeAccountId),
      pendingCount: pending.data.length,
      pending: pending.data.map((p) => ({
        id: mask(p.id),
        status: p.status,
        amount: p.amount,
        currency: p.currency,
        created: p.created,
        failure_code: p.failure_code ?? null,
        failure_message: p.failure_message ? "(redacted)" : null,
      })),
      payoutsOct7to9Utc: aroundOct8.data.map((p) => ({
        id: mask(p.id),
        status: p.status,
        amount: p.amount,
        currency: p.currency,
        created: p.created,
        arrival_date: p.arrival_date,
        failure_code: p.failure_code ?? null,
      })),
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
