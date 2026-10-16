/**
 * HTTP-level Stripe webhook claim behavior (isolated Postgres, signed payloads).
 *
 *   npm run test:tip-webhook-http-concurrency
 */
import Stripe from "stripe";
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

await completeIsolatedPostgresBootstrap();
process.env.DATABASE_ALLOW_LOCALHOST = "true";

const express = (await import("express")).default;
const { prisma } = await import("../src/prisma.js");
const stripeWebhookRoutes = (await import("../src/webhooks/stripe.webhook.js")).default;
const { acquireStripeWebhookProcessingClaim, finalizeStripeWebhookClaimProcessed } = await import(
  "../src/services/stripeWebhookProcessingClaim.service.js"
);

const WEBHOOK_SECRET = ["whsec", "phase1", "tip", "webhook", "test"].join("_");
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

const app = express();
app.use("/api/webhooks", express.raw({ type: "application/json" }), stripeWebhookRoutes);

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

function buildExpiredEvent(eventId: string, sessionId: string): Stripe.Event {
  return {
    id: eventId,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: "checkout.session.expired",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "unpaid",
        mode: "payment",
        currency: "eur",
        amount_total: 500,
        metadata: {},
      } as Stripe.Checkout.Session,
    },
  };
}

function postWebhook(event: Stripe.Event): Promise<{ status: number; body: string }> {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      fetch(`http://127.0.0.1:${port}/api/webhooks/stripe`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        body: payload,
      })
        .then(async (res) => {
          const body = await res.text();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

const inflightEventId = `evt_tip_http_inflight_${Date.now()}`;
const inflightSessionId = `cs_tip_http_inflight_${Date.now()}`;
const inflightEvent = buildExpiredEvent(inflightEventId, inflightSessionId);
const held = await acquireStripeWebhookProcessingClaim(inflightEventId, inflightEvent.type);
if (held.action !== "acquired") {
  throw new Error("expected to pre-hold processing claim for HTTP concurrency test");
}

const [whileHeldA, whileHeldB] = await Promise.all([
  postWebhook(inflightEvent),
  postWebhook(inflightEvent),
]);
if (whileHeldA.status !== 503 || whileHeldB.status !== 503) {
  throw new Error(
    `in-flight claim should yield retryable 503 for both deliveries, got ${whileHeldA.status}/${whileHeldB.status}`,
  );
}
pass("http-inflight-503", "Concurrent HTTP deliveries retry while processing claim is held");

await finalizeStripeWebhookClaimProcessed({
  stripeEventId: inflightEventId,
  claimToken: held.claimToken,
  eventType: inflightEvent.type,
});

const completedEventId = `evt_tip_http_done_${Date.now()}`;
const completedSessionId = `cs_tip_http_done_${Date.now()}`;
const completedEvent = buildExpiredEvent(completedEventId, completedSessionId);
const first = await postWebhook(completedEvent);
if (first.status !== 200) {
  throw new Error(`first delivery should succeed, got ${first.status}`);
}
const second = await postWebhook(completedEvent);
if (second.status !== 200 || !second.body.includes("duplicate")) {
  throw new Error(`duplicate delivery should be 200 duplicate, got ${second.status} ${second.body}`);
}
pass("http-redelivery-ack", "Processed event redelivery acknowledges duplicate without re-processing");

const row = await prisma.stripeWebhookEvent.findUnique({ where: { id: completedEventId } });
if (!row || row.processingResult !== "processed") {
  throw new Error(`expected processed claim row, got ${row?.processingResult ?? "missing"}`);
}
const processedRows = await prisma.stripeWebhookEvent.count({
  where: { id: { in: [inflightEventId, completedEventId] } },
});
if (processedRows !== 2) {
  throw new Error(`expected two processed event rows, got ${processedRows}`);
}
pass("http-single-claim-row", "Each Stripe event id has one durable claim row");

const badSig = await new Promise<{ status: number }>((resolve, reject) => {
  const payload = JSON.stringify(completedEvent);
  const server = app.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    fetch(`http://127.0.0.1:${port}/api/webhooks/stripe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=0,v1=invalid",
      },
      body: payload,
    })
      .then((res) => {
        server.close();
        resolve({ status: res.status });
      })
      .catch((err) => {
        server.close();
        reject(err);
      });
  });
});
if (badSig.status !== 400) {
  throw new Error(`invalid signature should be 400, got ${badSig.status}`);
}
pass("http-invalid-signature", "Invalid signature rejected before claim");

await prisma.stripeWebhookEvent.deleteMany({
  where: { id: { in: [inflightEventId, completedEventId] } },
}).catch(() => undefined);
await prisma.$disconnect();

console.log("\ntip-webhook-http-concurrency-runtime: OK");
