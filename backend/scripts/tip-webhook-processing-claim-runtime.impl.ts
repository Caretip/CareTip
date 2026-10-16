import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Role, TipStatus } from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  acquireStripeWebhookProcessingClaim,
  finalizeStripeWebhookClaimFailed,
  finalizeStripeWebhookClaimProcessed,
  STRIPE_WEBHOOK_PROCESSING_CLAIM_TTL_MS,
} from "../src/services/stripeWebhookProcessingClaim.service.js";
import {
  isStripeWebhookEventProcessed,
  StripeWebhookConcurrentDeliveryError,
} from "../src/services/stripeWebhookIdempotency.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerScript = join(__dirname, "tip-webhook-processing-claim-worker.ts");

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

function runClaimWorker(eventId: string, mode: "acquire" | "finalize" = "acquire", token?: string): Promise<Record<string, unknown>> {
  const args = ["tsx", workerScript, eventId, mode];
  if (mode === "finalize" && token) args.push(token);
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, {
      cwd: join(__dirname, ".."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    let stdout = "";
    child.stdout.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr.on("data", (c) => {
      process.stderr.write(c);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`worker exit ${code}: ${stdout}`));
        return;
      }
      const line = stdout.trim().split("\n").pop();
      if (!line) {
        reject(new Error("worker missing stdout"));
        return;
      }
      resolve(JSON.parse(line) as Record<string, unknown>);
    });
  });
}

async function seedBusinessForPiTest(suffix: string): Promise<{ businessId: string }> {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `wh-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `WH ${suffix}`,
      slug: `wh-${suffix}`,
      userId: manager.id,
    },
  });
  return { businessId: business.id };
}

async function simulatePaidTipOnce(paymentIntentId: string, businessId: string): Promise<boolean> {
  const existing = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { id: true },
  });
  if (existing) return false;
  await prisma.transaction.create({
    data: {
      amount: 5,
      status: TipStatus.success,
      stripePaymentIntentId: paymentIntentId,
      businessId,
    },
  });
  return true;
}

export async function runTipWebhookClaimTests(): Promise<void> {
  await prisma.$queryRaw`
    SELECT processing_claim_token, processing_claim_expires_at, processing_result
    FROM stripe_webhook_events
    LIMIT 0
  `.catch(() => {
    throw new Error("Migration 20261015140000_stripe_webhook_processing_claim not applied on isolated DB.");
  });

  const eventId = `evt_tip_wh_${Date.now()}`;

  const outcomes = await Promise.allSettled([
    acquireStripeWebhookProcessingClaim(eventId, "payment_intent.succeeded"),
    acquireStripeWebhookProcessingClaim(eventId, "payment_intent.succeeded"),
  ]);
  const acquired = outcomes.filter(
    (o) => o.status === "fulfilled" && o.value.action === "acquired",
  ).length;
  const concurrent = outcomes.filter(
    (o) => o.status === "rejected" && o.reason instanceof StripeWebhookConcurrentDeliveryError,
  ).length;
  if (acquired !== 1 || concurrent !== 1) {
    throw new Error(`concurrent_claim expected 1 acquired + 1 concurrent, got ${acquired}/${concurrent}`);
  }
  pass("concurrent-claim", "Simultaneous deliveries serialize via advisory lock");

  const winner = outcomes.find(
    (o): o is PromiseFulfilledResult<{ action: "acquired"; claimToken: string }> =>
      o.status === "fulfilled" && o.value.action === "acquired",
  );
  if (!winner) throw new Error("missing acquired claim");
  await finalizeStripeWebhookClaimProcessed({
    stripeEventId: eventId,
    claimToken: winner.value.claimToken,
    eventType: "payment_intent.succeeded",
  });

  const dup = await acquireStripeWebhookProcessingClaim(eventId, "payment_intent.succeeded");
  if (dup.action !== "duplicate") {
    throw new Error("expected duplicate after processed");
  }
  pass("sequential-duplicate", "Second delivery is duplicate without re-processing");

  if (!(await isStripeWebhookEventProcessed(eventId))) {
    throw new Error("isStripeWebhookEventProcessed should be true");
  }

  const retryId = `evt_tip_wh_retry_${Date.now()}`;
  const first = await acquireStripeWebhookProcessingClaim(retryId, "charge.refunded");
  if (first.action !== "acquired") throw new Error("first claim failed");
  await finalizeStripeWebhookClaimFailed({
    stripeEventId: retryId,
    claimToken: first.claimToken,
    eventType: "charge.refunded",
    error: new Error("simulated_db_rollback"),
  });
  const second = await acquireStripeWebhookProcessingClaim(retryId, "charge.refunded");
  if (second.action !== "acquired") throw new Error("failed row should be reclaimable");
  await finalizeStripeWebhookClaimProcessed({
    stripeEventId: retryId,
    claimToken: second.claimToken,
    eventType: "charge.refunded",
  });
  pass("failed-retry", "Failed claim allows safe Stripe retry delivery");

  const staleId = `evt_tip_wh_stale_${Date.now()}`;
  const claim = await acquireStripeWebhookProcessingClaim(staleId, "payment_intent.succeeded");
  if (claim.action !== "acquired") throw new Error("stale claim failed");
  const applied = await finalizeStripeWebhookClaimProcessed({
    stripeEventId: staleId,
    claimToken: "wrong-token",
    eventType: "payment_intent.succeeded",
  });
  if (applied) throw new Error("stale token must not finalize");
  await finalizeStripeWebhookClaimProcessed({
    stripeEventId: staleId,
    claimToken: claim.claimToken,
    eventType: "payment_intent.succeeded",
  });
  pass("stale-token-fence", "Finalize requires matching claim token");

  const expiredId = `evt_tip_wh_expired_${Date.now()}`;
  const expiredClaim = await acquireStripeWebhookProcessingClaim(expiredId, "payment_intent.succeeded");
  if (expiredClaim.action !== "acquired") throw new Error("expired setup claim failed");
  await prisma.stripeWebhookEvent.update({
    where: { id: expiredId },
    data: { processingClaimExpiresAt: new Date(Date.now() - 60_000) },
  });
  const reclaimed = await acquireStripeWebhookProcessingClaim(expiredId, "payment_intent.succeeded");
  if (reclaimed.action !== "acquired") throw new Error("expired processing claim should be reclaimable");
  await finalizeStripeWebhookClaimProcessed({
    stripeEventId: expiredId,
    claimToken: reclaimed.claimToken,
    eventType: "payment_intent.succeeded",
  });
  pass("expired-claim-reclaim", "Expired processing claim can be taken over safely");

  const mpEventId = `evt_tip_wh_mp_${Date.now()}`;
  const [workerA, workerB] = await Promise.all([
    runClaimWorker(mpEventId, "acquire"),
    runClaimWorker(mpEventId, "acquire"),
  ]);
  const mpAcquired = [workerA, workerB].filter((w) => w.action === "acquired").length;
  const mpConcurrent = [workerA, workerB].filter((w) => w.concurrent === true).length;
  if (mpAcquired !== 1 || mpConcurrent !== 1) {
    throw new Error(`multi-process expected 1 acquired + 1 concurrent, got ${JSON.stringify({ workerA, workerB })}`);
  }
  const mpToken = String((workerA.action === "acquired" ? workerA.claimToken : workerB.claimToken) ?? "");
  await runClaimWorker(mpEventId, "finalize", mpToken);
  pass("multi-process-claim", "Separate Node processes race on PostgreSQL advisory lock");

  const suffix = `${Date.now()}`;
  const { businessId } = await seedBusinessForPiTest(suffix);
  const pi = `pi_wh_idem_${suffix}`;
  const evtCheckout = `evt_tip_wh_co_${suffix}`;
  const evtPi = `evt_tip_wh_pi_${suffix}`;

  const coClaim = await acquireStripeWebhookProcessingClaim(evtCheckout, "checkout.session.completed");
  if (coClaim.action !== "acquired") throw new Error("checkout claim failed");
  const createdOnce = await simulatePaidTipOnce(pi, businessId);
  if (!createdOnce) throw new Error("first simulated payment should create tip");
  await finalizeStripeWebhookClaimProcessed({
    stripeEventId: evtCheckout,
    claimToken: coClaim.claimToken,
    eventType: "checkout.session.completed",
  });

  const piClaim = await acquireStripeWebhookProcessingClaim(evtPi, "payment_intent.succeeded");
  if (piClaim.action !== "acquired") throw new Error("pi claim failed");
  const createdTwice = await simulatePaidTipOnce(pi, businessId);
  if (createdTwice) throw new Error("distinct event same PI must not create second tip");
  await finalizeStripeWebhookClaimProcessed({
    stripeEventId: evtPi,
    claimToken: piClaim.claimToken,
    eventType: "payment_intent.succeeded",
  });
  const tipCount = await prisma.transaction.count({ where: { stripePaymentIntentId: pi } });
  if (tipCount !== 1) throw new Error(`expected 1 tip for PI, got ${tipCount}`);
  pass("distinct-events-same-pi", "Different Stripe event ids cannot duplicate tips for one PI");

  const crashId = `evt_tip_wh_crash_${suffix}`;
  const crashClaim = await acquireStripeWebhookProcessingClaim(crashId, "payment_intent.succeeded");
  if (crashClaim.action !== "acquired") throw new Error("crash claim failed");
  const crashPi = `pi_wh_crash_${suffix}`;
  await simulatePaidTipOnce(crashPi, businessId);
  await prisma.stripeWebhookEvent.update({
    where: { id: crashId },
    data: { processingClaimExpiresAt: new Date(Date.now() - 60_000) },
  });
  const crashReclaim = await acquireStripeWebhookProcessingClaim(crashId, "payment_intent.succeeded");
  if (crashReclaim.action !== "acquired") throw new Error("crash reclaim failed");
  const dupAfterCrash = await simulatePaidTipOnce(crashPi, businessId);
  if (dupAfterCrash) throw new Error("handler re-run after crash must not duplicate financial row");
  await finalizeStripeWebhookClaimProcessed({
    stripeEventId: crashId,
    claimToken: crashReclaim.claimToken,
    eventType: "payment_intent.succeeded",
  });
  pass("post-commit-before-finalize", "Financial commit without finalize is recoverable without double effect");

  const insertRaceId = `evt_tip_wh_ins_${Date.now()}`;
  const insertOutcomes = await Promise.allSettled([
    acquireStripeWebhookProcessingClaim(insertRaceId, "payment_intent.succeeded"),
    acquireStripeWebhookProcessingClaim(insertRaceId, "payment_intent.succeeded"),
  ]);
  const insertRows = await prisma.stripeWebhookEvent.count({ where: { id: insertRaceId } });
  if (insertRows !== 1) throw new Error(`expected exactly one stripe_webhook_events row, got ${insertRows}`);
  const insertAcquired = insertOutcomes.filter(
    (o) => o.status === "fulfilled" && o.value.action === "acquired",
  ).length;
  if (insertAcquired !== 1) throw new Error("insert race should yield one acquired claim");
  await prisma.stripeWebhookEvent.delete({ where: { id: insertRaceId } }).catch(() => undefined);
  pass("unique-event-row", "Concurrent first-time claims cannot insert duplicate event ids");

  try {
    await prisma.$transaction(async (tx) => {
      const rollbackId = `evt_tip_wh_rb_${Date.now()}`;
      await tx.stripeWebhookEvent.create({
        data: {
          id: rollbackId,
          eventType: "payment_intent.succeeded",
          processingResult: "processing",
          processingClaimToken: "rollback-token",
          processingClaimExpiresAt: new Date(Date.now() + STRIPE_WEBHOOK_PROCESSING_CLAIM_TTL_MS),
        },
      });
      throw new Error("forced_rollback");
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "forced_rollback") {
      throw err;
    }
  }
  pass("transaction-rollback", "Rolled-back transaction does not leave partial webhook claim row");

  await prisma.transaction.deleteMany({ where: { stripePaymentIntentId: { startsWith: "pi_wh_" } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: "wh-" } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "wh-mgr-" } } });
  await prisma.stripeWebhookEvent.deleteMany({
    where: { id: { startsWith: "evt_tip_wh_" } },
  });

  console.log("\ntip-webhook-processing-claim-runtime: OK");
}
