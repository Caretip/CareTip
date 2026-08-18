/**
 * Read-only Marie Testerin identity + financial-row counts.
 * Never creates accounts, never refunds, never resets the database.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import Stripe from "stripe";
import { prisma } from "../src/prisma.js";

function suffix(id: string | null | undefined): string {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 8 ? "(short)" : `…${s.slice(-8)}`;
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key.startsWith("sk_test_")) {
    console.log("ABORT: STRIPE_SECRET_KEY is not TEST mode");
    process.exit(1);
  }
  const stripe = new Stripe(key);

  const [
    businessCount,
    txCount,
    payoutCount,
    payoutLineCount,
    webhookCount,
    tipRefundCount,
  ] = await Promise.all([
    prisma.business.count(),
    prisma.transaction.count(),
    prisma.stripeConnectPayout.count(),
    prisma.stripeConnectPayoutBalanceLine.count(),
    prisma.stripeWebhookEvent.count(),
    prisma.tipRefund.count(),
  ]);

  const mapped = await prisma.business.findMany({
    where: { name: { contains: "Phase26", mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      stripeAccountId: true,
      stripeConnectStatus: true,
      user: { select: { email: true } },
    },
  });

  console.log("=== CARETIP DB COUNTS ===");
  console.log(`businesses: ${businessCount}`);
  console.log(`transactions: ${txCount}`);
  console.log(`stripeConnectPayouts: ${payoutCount}`);
  console.log(`stripeConnectPayoutBalanceLines: ${payoutLineCount}`);
  console.log(`stripeWebhookEvents: ${webhookCount}`);
  console.log(`tipRefunds: ${tipRefundCount}`);

  console.log("\n=== MARIE MAPPED BUSINESS ===");
  for (const b of mapped) {
    console.log(`business suffix=${suffix(b.id)} name=${b.name} status=${b.stripeConnectStatus}`);
    console.log(`business.stripeAccountId suffix=${suffix(b.stripeAccountId)}`);
    console.log(`manager_email_present=${Boolean(b.user?.email)}`);
  }

  const v2 = (await stripe.rawRequest(
    "GET",
    "/v2/core/accounts?limit=20",
    null,
    { apiVersion: "2026-07-29.dahlia" },
  )) as { data?: Array<{ id?: string; display_name?: string; applied_configurations?: string[] }> };

  const marieV2 = (v2.data ?? []).find((row) => {
    const name = (row.display_name ?? "").toLowerCase();
    const configs = (row.applied_configurations ?? []).slice().sort().join(",");
    return name.includes("marie") || name.includes("testerin") || configs === "customer,merchant";
  });
  console.log("\n=== STRIPE V2 MARIE ===");
  if (!marieV2?.id) {
    console.log("NOT_FOUND");
  } else {
    console.log(`stripeAccountId suffix=${suffix(marieV2.id)}`);
    console.log(`display_name=${marieV2.display_name ?? "(none)"}`);
    console.log(`applied_configurations=${(marieV2.applied_configurations ?? []).join(",") || "(none)"}`);
    const match = mapped.filter((b) => b.stripeAccountId === marieV2.id);
    console.log(`mapped_business_count=${match.length}`);
    console.log(`mapping_match=${match.length === 1 && match[0]?.stripeAccountId === marieV2.id}`);
  }
}

void main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
