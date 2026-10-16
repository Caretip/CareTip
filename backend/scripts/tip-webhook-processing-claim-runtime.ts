/**
 * Tip / general Stripe webhook processing claim (stripe_webhook_events).
 *
 *   npm run test:tip-webhook-processing-claim
 * Requires CARETIP_ISOLATED_POSTGRES_URL + migrations (see isolatedPostgresTestGate).
 */
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

await completeIsolatedPostgresBootstrap();
process.env.DATABASE_ALLOW_LOCALHOST = "true";

const { runTipWebhookClaimTests } = await import("./tip-webhook-processing-claim-runtime.impl.js");
const { prisma } = await import("../src/prisma.js");

try {
  await runTipWebhookClaimTests();
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
