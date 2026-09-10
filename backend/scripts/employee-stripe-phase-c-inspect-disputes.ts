import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { getStripeClient } from "../src/services/stripe.service.js";

async function inspect(prefix: string) {
  const emp = await prisma.employee.findFirst({
    where: { name: { startsWith: prefix } },
    orderBy: { id: "desc" },
    select: { id: true, name: true },
  });
  const tx = emp
    ? await prisma.transaction.findFirst({
        where: { employeeId: emp.id },
        orderBy: { id: "desc" },
      })
    : null;
  const pay = tx
    ? await prisma.employeeTipPayable.findUnique({ where: { transactionId: tx.id } })
    : null;
  const stripe = getStripeClient();
  console.log(prefix, {
    emp: emp?.name,
    tx: tx?.status,
    pi: tx?.stripePaymentIntentId?.slice(-8),
    disputedOpen: pay?.disputedOpenCents,
    disputeId: pay?.stripeDisputeId,
    charge: pay?.stripeChargeId?.slice(-8),
  });
  if (!pay?.stripeChargeId) return;
  const ch = await stripe.charges.retrieve(pay.stripeChargeId);
  const list = await stripe.disputes.list({ charge: pay.stripeChargeId, limit: 5 });
  console.log(prefix, "stripe", {
    disputed: ch.disputed,
    disputeField: typeof ch.dispute === "string" ? ch.dispute.slice(-8) : ch.dispute,
    listCount: list.data.length,
    statuses: list.data.map((d) => `${d.status}:${d.amount}`),
  });
  const refunds = await prisma.tipRefund.findMany({
    where: { stripeChargeId: pay.stripeChargeId },
    select: { kind: true, status: true, stripeDisputeId: true },
  });
  console.log(prefix, "tipRefunds", refunds.map((r) => `${r.kind}:${r.status}:${r.stripeDisputeId ? "id" : "none"}`));
  const webhookRows = await prisma.stripeWebhookEvent.findMany({
    where: { eventType: { startsWith: "charge.dispute" } },
    orderBy: { processedAt: "desc" },
    take: 8,
    select: { eventType: true, processedAt: true },
  });
  console.log("recent_dispute_webhook_events", webhookRows.map((r) => `${r.eventType}@${r.processedAt.toISOString()}`));
}

async function main() {
  await inspect("Sandbox PhaseC Deploy d");
  await inspect("Sandbox PhaseC Deploy f");
}

void main().finally(() => prisma.$disconnect());
