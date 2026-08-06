/**
 * Phase B.0 — create-time subscription mirror synchronization checks.
 * Run: npm run test:subscription-b0
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { BusinessSubscriptionTier } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { registerBusiness } from "../src/services/auth.service.js";
import { getBusinessByUserId } from "../src/services/business.service.js";
import { updateBusinessSubscriptionTier } from "../src/services/platform.service.js";
import { buildNestedSubscriptionCreateData } from "../src/services/subscription.service.js";
import { SUBSCRIPTION_AUDIT_TYPES } from "../src/lib/subscription/subscriptionAuditTypes.js";
import { generateUniqueBusinessSlugForName } from "../src/services/business.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function assertMirror(
  businessId: string,
  expectedAuditType: string,
  label: string,
): Promise<boolean> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      subscriptionTier: true,
      subscription: {
        select: {
          id: true,
          planKey: true,
          status: true,
          events: {
            where: { auditType: expectedAuditType },
            orderBy: { occurredAt: "desc" },
            take: 1,
            select: { id: true, auditType: true, payload: true },
          },
        },
      },
    },
  });

  if (!business) {
    fail(`${label}: business not found`);
    return false;
  }
  if (!business.subscription) {
    fail(`${label}: subscription mirror missing`);
    return false;
  }
  if (business.subscription.planKey !== business.subscriptionTier) {
    fail(
      `${label}: planKey ${business.subscription.planKey} !== tier ${business.subscriptionTier}`,
    );
    return false;
  }
  if (business.subscription.status !== "active") {
    fail(`${label}: expected status active, got ${business.subscription.status}`);
    return false;
  }
  const event = business.subscription.events[0];
  if (!event) {
    fail(`${label}: expected audit event ${expectedAuditType}`);
    return false;
  }

  pass(`${label}: business + subscription + ${expectedAuditType} event`);
  return true;
}

async function testEmailSignup(): Promise<boolean> {
  const tag = `b0-email-${Date.now()}`;
  const result = await registerBusiness({
    email: `${tag}@caretip-test.local`,
    password: "TestPass1!",
  });
  const businessId = result.user.businessId;
  if (!businessId) {
    fail("email signup: no businessId on user");
    return false;
  }
  return assertMirror(businessId, SUBSCRIPTION_AUDIT_TYPES.created, "email signup");
}

async function testOAuthSignupNestedCreate(): Promise<boolean> {
  const tag = `b0-oauth-${Date.now()}`;
  const email = `${tag}@caretip-test.local`;
  const bizName = `${tag} venue`;
  const slug = await generateUniqueBusinessSlugForName(bizName);

  const created = await prisma.user.create({
    data: {
      email,
      passwordHash: null,
      role: "MANAGER",
      isPlatformAdmin: false,
      emailVerified: true,
      oauthAccounts: {
        create: {
          provider: "google",
          subject: `google-sub-${tag}`,
          emailAtLink: email,
        },
      },
      business: {
        create: {
          name: bizName,
          slug,
          businessType: null,
          location: null,
          subscriptionTier: BusinessSubscriptionTier.basic,
          subscription: {
            create: buildNestedSubscriptionCreateData({
              subscriptionTier: BusinessSubscriptionTier.basic,
              source: "oauth_signup",
            }),
          },
        },
      },
    },
    include: { business: true },
  });

  if (!created.business) {
    fail("oauth signup: business not created");
    return false;
  }

  const payload = await prisma.subscriptionEvent.findFirst({
    where: {
      subscription: { businessId: created.business.id },
      auditType: SUBSCRIPTION_AUDIT_TYPES.created,
    },
    select: { payload: true },
  });
  const source =
    payload?.payload && typeof payload.payload === "object" && payload.payload !== null
      ? (payload.payload as Record<string, unknown>).source
      : null;
  if (source !== "oauth_signup") {
    fail(`oauth signup: expected payload source oauth_signup, got ${String(source)}`);
    return false;
  }

  return assertMirror(created.business.id, SUBSCRIPTION_AUDIT_TYPES.created, "oauth signup");
}

async function testAutoHeal(): Promise<boolean> {
  const tag = `b0-heal-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
    },
  });

  const business = await getBusinessByUserId(user.id);
  if (!business) {
    fail("auto-heal: getBusinessByUserId returned null");
    return false;
  }

  const payload = await prisma.subscriptionEvent.findFirst({
    where: {
      subscription: { businessId: business.id },
      auditType: SUBSCRIPTION_AUDIT_TYPES.created,
    },
    select: { payload: true },
  });
  const source =
    payload?.payload && typeof payload.payload === "object" && payload.payload !== null
      ? (payload.payload as Record<string, unknown>).source
      : null;
  if (source !== "auto_heal") {
    fail(`auto-heal: expected payload source auto_heal, got ${String(source)}`);
    return false;
  }

  return assertMirror(business.id, SUBSCRIPTION_AUDIT_TYPES.created, "auto-heal");
}

async function testAdminTierChange(): Promise<boolean> {
  const tag = `b0-admin-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const admin = await prisma.user.create({
    data: {
      email: `${tag}-admin@caretip-test.local`,
      passwordHash,
      role: "SUPER_ADMIN",
      isPlatformAdmin: true,
      emailVerified: true,
    },
  });

  const manager = await prisma.user.create({
    data: {
      email: `${tag}-mgr@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: {
          name: `${tag} Venue`,
          slug: `${tag}-venue`,
          subscriptionTier: BusinessSubscriptionTier.basic,
          subscription: {
            create: buildNestedSubscriptionCreateData({
              subscriptionTier: BusinessSubscriptionTier.basic,
              source: "email_signup",
            }),
          },
        },
      },
    },
    include: { business: true },
  });

  if (!manager.business) {
    fail("admin tier change: setup business missing");
    return false;
  }

  await updateBusinessSubscriptionTier(manager.business.id, "premium", admin.id);

  const row = await prisma.business.findUnique({
    where: { id: manager.business.id },
    select: {
      subscriptionTier: true,
      subscription: {
        select: {
          planKey: true,
          events: {
            where: { auditType: SUBSCRIPTION_AUDIT_TYPES.planChanged },
            orderBy: { occurredAt: "desc" },
            take: 1,
            select: { payload: true },
          },
        },
      },
    },
  });

  if (!row?.subscription) {
    fail("admin tier change: subscription missing after update");
    return false;
  }
  if (row.subscriptionTier !== "premium" || row.subscription.planKey !== "premium") {
    fail(
      `admin tier change: tier/planKey mismatch (tier=${row.subscriptionTier}, planKey=${row.subscription.planKey})`,
    );
    return false;
  }

  const event = row.subscription.events[0];
  const payload =
    event?.payload && typeof event.payload === "object" && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : null;
  if (!payload || payload.previousTier !== "basic" || payload.newTier !== "premium") {
    fail("admin tier change: subscription_plan_changed payload incorrect");
    return false;
  }
  if (payload.actorUserId !== admin.id) {
    fail("admin tier change: actorUserId missing from event payload");
    return false;
  }

  pass("admin tier change: subscriptionTier + planKey + subscription_plan_changed event");
  return true;
}

async function main() {
  let ok = true;
  ok = (await testEmailSignup()) && ok;
  ok = (await testOAuthSignupNestedCreate()) && ok;
  ok = (await testAutoHeal()) && ok;
  ok = (await testAdminTierChange()) && ok;

  console.log("Phase B.0 subscription mirror runtime checks\n");
  for (const line of results) {
    console.log(line);
  }

  if (!ok) {
    process.exitCode = 1;
    console.log("\nRESULT: FAIL");
    return;
  }
  console.log("\nRESULT: PASS");
}

void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
