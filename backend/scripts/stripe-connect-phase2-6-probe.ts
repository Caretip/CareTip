/**
 * Phase 2.6 — safe env/Connect probe. Never prints secrets or full acct ids.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { getStripeClient, isStripeConfigured } from "../src/services/stripe.service.js";

function keyMode(): "missing" | "test" | "live" | "unknown" {
  const k = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!k) return "missing";
  if (k.startsWith("sk_test_")) return "test";
  if (k.startsWith("sk_live_")) return "live";
  return "unknown";
}

function suffix(id: string | null | undefined): string {
  if (!id) return "(none)";
  return id.length <= 8 ? "(short)" : `…${id.slice(-8)}`;
}

async function main() {
  const mode = keyMode();
  console.log("STRIPE_SECRET_KEY mode:", mode);
  console.log("STRIPE_WEBHOOK_SECRET configured:", Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()));
  console.log("FRONTEND_URL configured:", Boolean(process.env.FRONTEND_URL?.trim()));
  console.log("FRONTEND_URL host only:", process.env.FRONTEND_URL?.trim() ? new URL(process.env.FRONTEND_URL).host : "(unset)");
  console.log("PORT:", process.env.PORT ?? "3001 (default)");
  console.log("isStripeConfigured:", isStripeConfigured());

  if (mode === "live") {
    console.log("E2E BLOCKED — LIVE STRIPE CREDENTIAL DETECTED.");
    process.exit(2);
  }
  if (mode !== "test") {
    console.log("E2E BLOCKED — no test-mode secret.");
    process.exit(2);
  }

  const stripe = getStripeClient();
  const accts = await stripe.accounts.list({ limit: 20 });
  console.log("connected_accounts_listed:", accts.data.length);
  const ready = accts.data.filter((a) => a.charges_enabled && a.payouts_enabled);
  for (const a of ready) {
    console.log("ready_acct:", {
      suffix: suffix(a.id),
      type: a.type,
      charges_enabled: a.charges_enabled,
      payouts_enabled: a.payouts_enabled,
      details_submitted: a.details_submitted,
      disabled_reason: a.requirements?.disabled_reason ?? null,
      currently_due: a.requirements?.currently_due?.length ?? 0,
    });
  }

  try {
    const hooks = await stripe.webhookEndpoints.list({ limit: 10 });
    console.log("webhook_endpoints:", hooks.data.length);
    for (const h of hooks.data) {
      console.log("webhook:", {
        suffix: suffix(h.id),
        url_host: (() => {
          try {
            return new URL(h.url).host;
          } catch {
            return "(invalid)";
          }
        })(),
        status: h.status,
        has_checkout_completed: h.enabled_events.includes("checkout.session.completed") || h.enabled_events.includes("*"),
      });
    }
  } catch (e) {
    console.log("webhook_endpoints_list_error:", e instanceof Error ? e.message.slice(0, 80) : "error");
  }

  const readyIds = ready.map((a) => a.id);
  const businesses = await prisma.business.findMany({
    where: { stripeAccountId: { in: readyIds } },
    select: {
      id: true,
      name: true,
      deletedAt: true,
      legalHold: true,
      operationalStatus: true,
      onboardingVerificationStatus: true,
      stripeAccountId: true,
      stripeConnectStatus: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      employees: {
        where: { isActive: true, isDeleted: false, activationStatus: "active" },
        take: 5,
        select: {
          id: true,
          user: { select: { emailVerified: true, isActive: true } },
        },
      },
    },
  });
  console.log("caretip_businesses_bound_to_ready_accts:", businesses.length);
  for (const b of businesses) {
    console.log("business:", {
      suffix: suffix(b.id),
      name: b.name.slice(0, 40),
      deletedAt: Boolean(b.deletedAt),
      legalHold: b.legalHold,
      operationalStatus: b.operationalStatus,
      onboarding: b.onboardingVerificationStatus,
      connect: b.stripeConnectStatus,
      charges: b.stripeChargesEnabled,
      payouts: b.stripePayoutsEnabled,
      acct: suffix(b.stripeAccountId),
      eligibleEmployees: b.employees.filter((e) => e.user?.emailVerified && e.user.isActive !== false).length,
    });
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
