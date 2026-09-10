/**
 * Apply CURRENT-repo success handler to recent sandbox tips that Stripe already paid
 * but Render webhook did not write EmployeeTipPayable (deploy lag check).
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { getStripeClient, handleSuccessfulTipPayment } from "../src/services/stripe.service.js";
import { prisma } from "../src/prisma.js";

async function main() {
  const tips = await prisma.transaction.findMany({
    where: {
      employee: { name: { startsWith: "Sandbox PhaseC" } },
      createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    },
    select: { id: true, status: true, amount: true, stripePaymentIntentId: true },
    take: 20,
  });
  const stripe = getStripeClient();
  for (const tip of tips) {
    const existing = await prisma.employeeTipPayable.findUnique({ where: { transactionId: tip.id } });
    console.log(
      `tip=${tip.id.slice(-8)} status=${tip.status} amount=${tip.amount} payable=${existing?.chargeModel ?? "MISSING"}`,
    );
    if (existing || !tip.stripePaymentIntentId) continue;
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: tip.stripePaymentIntentId,
      limit: 1,
    });
    const session = sessions.data[0];
    if (!session) {
      console.log("  no checkout session for PI");
      continue;
    }
    await handleSuccessfulTipPayment(session);
    const after = await prisma.employeeTipPayable.findUnique({ where: { transactionId: tip.id } });
    console.log(`  after_local_handler model=${after?.chargeModel ?? "STILL_MISSING"} status=${after?.status} payableCents=${after?.payableCents}`);
  }
}

void main().finally(() => prisma.$disconnect());
