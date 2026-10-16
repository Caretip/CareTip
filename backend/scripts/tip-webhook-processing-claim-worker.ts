/**
 * Child process: attempt one Stripe webhook processing claim (isolated Postgres only).
 */
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

const eventId = process.argv[2]?.trim();
const mode = process.argv[3]?.trim() ?? "acquire";

if (!eventId) {
  console.error("usage: tip-webhook-processing-claim-worker.ts <eventId> [acquire|finalize <token>]");
  process.exit(2);
}

await completeIsolatedPostgresBootstrap();
const { acquireStripeWebhookProcessingClaim, finalizeStripeWebhookClaimProcessed } = await import(
  "../src/services/stripeWebhookProcessingClaim.service.js"
);
const { StripeWebhookConcurrentDeliveryError } = await import(
  "../src/services/stripeWebhookIdempotency.service.js"
);

try {
  if (mode === "acquire") {
    const result = await acquireStripeWebhookProcessingClaim(eventId, "payment_intent.succeeded");
    console.log(JSON.stringify({ mode, action: result.action, claimToken: result.action === "acquired" ? result.claimToken : null }));
    process.exit(0);
  }

  if (mode === "finalize") {
    const token = process.argv[4]?.trim();
    if (!token) {
      console.error("finalize requires claim token");
      process.exit(2);
    }
    const applied = await finalizeStripeWebhookClaimProcessed({
      stripeEventId: eventId,
      claimToken: token,
      eventType: "payment_intent.succeeded",
    });
    console.log(JSON.stringify({ mode, applied }));
    process.exit(0);
  }

  console.error(`unknown mode: ${mode}`);
  process.exit(2);
} catch (err) {
  if (err instanceof StripeWebhookConcurrentDeliveryError) {
    console.log(JSON.stringify({ mode, concurrent: true }));
    process.exit(0);
  }
  throw err;
}
