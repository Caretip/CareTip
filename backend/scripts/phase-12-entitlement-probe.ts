/**
 * Phase 12 — subscription/entitlement assessment probes (no app changes).
 * Run: dotenv -e ../.env -e .env -- tsx scripts/phase-12-entitlement-probe.ts
 */
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import {
  BillingCycle,
  SubscriptionPlanKey,
  SubscriptionStatus,
  SponsoredAccessStatus,
} from "@prisma/client";
import { prisma } from "../src/prisma.js";
import {
  EMPTY_SUBSCRIPTION_ENTITLEMENTS,
  PLAN_CAPABILITY_REQUIRED_CODE,
  PLAN_LIMIT_EXCEEDED_CODE,
  SUBSCRIPTION_REQUIRED_CODE,
  featureAccessDeniedPayload,
  hasFeature,
  isEntitlementDeniedError,
  resolveSubscriptionEntitlements,
} from "../src/services/subscriptionEntitlement.service.js";
import { provisionInternalBasicSubscription } from "../src/services/subscription.service.js";
import { createLocationForBusinessUser } from "../src/services/locations.service.js";
import * as tablesService from "../src/services/tables.service.js";
import { isSubscriptionMirrorEntitled } from "../src/lib/subscription/subscriptionMirrorEntitlement.js";
import { checkoutSessionBoundToBusiness } from "../src/lib/subscription/checkoutSessionOwnership.js";
import { assertSelfServeCheckoutPlanKey, BillingCheckoutNotAllowedError } from "../src/lib/subscription/billingCheckoutPolicy.js";
import { findActiveSponsoredGrantForBusiness } from "../src/services/sponsoredAccess.service.js";
import { capabilitiesForTier, hasSubscriptionCapability } from "../src/config/subscriptionCapabilities.js";

const PW = "TestPass1!aA";
const tag = Date.now();
const results: { id: string; status: string; detail: string }[] = [];

function rec(id: string, status: "PASS" | "FAIL" | "INFO", detail: string) {
  results.push({ id, status, detail });
  console.log(`${status}: ${id} — ${detail}`);
}

async function makeBiz(suffix: string, opts: { tierLabel: "none" | "basic" | "premium" }) {
  const passwordHash = await bcrypt.hash(PW, 10);
  const user = await prisma.user.create({
    data: {
      email: `p12-${suffix}-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `P12 ${suffix} ${tag}`,
          slug: `p12-${suffix}-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: opts.tierLabel === "none" ? "premium" : opts.tierLabel,
        },
      },
    },
    include: { business: true },
  });
  const businessId = user.business!.id;
  if (opts.tierLabel === "basic") {
    await provisionInternalBasicSubscription(businessId);
  } else if (opts.tierLabel === "premium") {
    await prisma.subscription.create({
      data: {
        businessId,
        planKey: SubscriptionPlanKey.premium,
        status: SubscriptionStatus.active,
        billingCycle: BillingCycle.monthly,
      },
    });
  }
  return user;
}

async function setSubStatus(
  businessId: string,
  status: SubscriptionStatus,
  extra?: { cancelAtPeriodEnd?: boolean; currentPeriodEnd?: Date; canceledAt?: Date | null },
) {
  await prisma.subscription.update({
    where: { businessId },
    data: {
      status,
      cancelAtPeriodEnd: extra?.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: extra?.currentPeriodEnd ?? null,
      canceledAt: extra?.canceledAt ?? null,
      cancellationEffective: extra?.currentPeriodEnd ?? null,
    },
  });
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { contains: `${tag}@caretip-test.local` } },
    select: { id: true, business: { select: { id: true } } },
  });
  const bizIds = users.map((u) => u.business?.id).filter(Boolean) as string[];
  const userIds = users.map((u) => u.id);
  if (bizIds.length) {
    await prisma.sponsoredAccessGrant.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.table.deleteMany({ where: { location: { businessId: { in: bizIds } } } });
    await prisma.location.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.subscription.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.business.deleteMany({ where: { id: { in: bizIds } } });
  }
  if (userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

async function main() {
  try {
    const none = await makeBiz("none", { tierLabel: "none" });
    const basic = await makeBiz("basic", { tierLabel: "basic" });
    const pro = await makeBiz("pro", { tierLabel: "premium" });
    const noneId = none.business!.id;
    const basicId = basic.business!.id;
    const proId = pro.business!.id;

    const noneState = await resolveSubscriptionEntitlements(noneId);
    rec(
      "no-entitlement-ignores-tier-column",
      noneState.hasActiveEntitlements === false &&
        noneState.accessSource === "none" &&
        noneState.plan === null &&
        noneState.capabilities.length === 0
        ? "PASS"
        : "FAIL",
      `Business.subscriptionTier was premium but resolver=${JSON.stringify({
        has: noneState.hasActiveEntitlements,
        src: noneState.accessSource,
        plan: noneState.plan,
        caps: noneState.capabilities.length,
      })}`,
    );

    rec(
      "no-entitlement-pro-feature",
      (await hasFeature(noneId, "employeeGoals")) === false ? "PASS" : "FAIL",
      "hasFeature(employeeGoals) false without subscription",
    );

    const noneLocDenied = await (async () => {
      try {
        await createLocationForBusinessUser(none.id, `P12 none loc ${tag}`);
        return false;
      } catch (e) {
        return isEntitlementDeniedError(e) && e.payload.code === SUBSCRIPTION_REQUIRED_CODE;
      }
    })();
    rec(
      "no-entitlement-location",
      noneLocDenied ? "PASS" : "FAIL",
      "Location create without entitlement → SUBSCRIPTION_REQUIRED",
    );

    const basicState = await resolveSubscriptionEntitlements(basicId);
    rec(
      "basic-entitled",
      basicState.hasActiveEntitlements &&
        basicState.plan === "basic" &&
        basicState.accessSource === "subscription" &&
        basicState.capabilities.includes("tableQr") &&
        !basicState.capabilities.includes("employeeGoals")
        ? "PASS"
        : "FAIL",
      `plan=${basicState.plan} tableQr=${basicState.capabilities.includes("tableQr")} goals=${basicState.capabilities.includes("employeeGoals")}`,
    );

    rec(
      "basic-pro-capability",
      (await hasFeature(basicId, "employeeGoals")) === false &&
        (await hasFeature(basicId, "csvExport")) === false &&
        (await hasFeature(basicId, "advancedAnalytics")) === false
        ? "PASS"
        : "FAIL",
      "Basic denied Pro-only features",
    );

    rec(
      "basic-tableQr",
      (await hasFeature(basicId, "tableQr")) === true ? "PASS" : "FAIL",
      "tableQr entitled on Basic",
    );

    const loc1 = await createLocationForBusinessUser(basic.id, `P12 basic loc ${tag}`);
    rec("basic-first-location", loc1?.id ? "PASS" : "FAIL", "First Basic location created");

    const table1 = await tablesService.createTableForBusinessUser(basic.id, {
      name: `P12 t1 ${tag}`,
      locationId: loc1.id,
    });
    rec("basic-first-table", table1?.id ? "PASS" : "FAIL", "First Basic table created (tableQr)");

    const proState = await resolveSubscriptionEntitlements(proId);
    rec(
      "pro-entitled",
      proState.hasActiveEntitlements &&
        proState.plan === "premium" &&
        proState.capabilities.includes("employeeGoals")
        ? "PASS"
        : "FAIL",
      `plan=${proState.plan} goals=${proState.capabilities.includes("employeeGoals")}`,
    );

    const payloadNone = featureAccessDeniedPayload(EMPTY_SUBSCRIPTION_ENTITLEMENTS, "employeeGoals");
    const payloadBasic = featureAccessDeniedPayload(basicState, "employeeGoals");
    rec(
      "error-semantics",
      payloadNone.code === SUBSCRIPTION_REQUIRED_CODE &&
        payloadBasic.code === PLAN_CAPABILITY_REQUIRED_CODE
        ? "PASS"
        : "FAIL",
      `none=${payloadNone.code} basic-missing-cap=${payloadBasic.code}`,
    );

    rec(
      "checkout-session-fail-closed",
      checkoutSessionBoundToBusiness({ metadata: {} }, proId) === false &&
        checkoutSessionBoundToBusiness({ metadata: { caretipBusinessId: basicId } }, proId) === false &&
        checkoutSessionBoundToBusiness({ metadata: { caretipBusinessId: proId } }, proId) === true
        ? "PASS"
        : "FAIL",
      "Checkout bind: missing/mismatch fail closed; match ok",
    );

    rec(
      "client-plan-checkout-policy",
      (() => {
        try {
          assertSelfServeCheckoutPlanKey("basic");
          return false;
        } catch (e) {
          return e instanceof BillingCheckoutNotAllowedError && e.code === "basic_included";
        }
      })() &&
        (() => {
          try {
            assertSelfServeCheckoutPlanKey("enterprise");
            return false;
          } catch (e) {
            return e instanceof BillingCheckoutNotAllowedError;
          }
        })()
        ? "PASS"
        : "FAIL",
      "Self-serve checkout rejects basic and enterprise planKeys",
    );

    rec(
      "mirror-incomplete-unpaid",
      isSubscriptionMirrorEntitled({
        status: SubscriptionStatus.incomplete,
        cancelAtPeriodEnd: false,
        cancellationEffective: null,
        currentPeriodEnd: null,
        canceledAt: null,
      }) === false &&
        isSubscriptionMirrorEntitled({
          status: SubscriptionStatus.unpaid,
          cancelAtPeriodEnd: false,
          cancellationEffective: null,
          currentPeriodEnd: null,
          canceledAt: null,
        }) === false
        ? "PASS"
        : "FAIL",
      "incomplete and unpaid are not entitled",
    );

    rec(
      "mirror-past-due",
      isSubscriptionMirrorEntitled({
        status: SubscriptionStatus.past_due,
        cancelAtPeriodEnd: false,
        cancellationEffective: null,
        currentPeriodEnd: null,
        canceledAt: null,
      }) === true
        ? "PASS"
        : "FAIL",
      "past_due remains entitled (explicit mirror policy)",
    );

    await setSubStatus(proId, SubscriptionStatus.incomplete);
    const afterIncomplete = await resolveSubscriptionEntitlements(proId);
    rec(
      "status-incomplete-resolver",
      afterIncomplete.hasActiveEntitlements === false ? "PASS" : "FAIL",
      `incomplete → hasActive=${afterIncomplete.hasActiveEntitlements}`,
    );

    await setSubStatus(proId, SubscriptionStatus.canceled, {
      canceledAt: new Date(Date.now() - 86400000),
      currentPeriodEnd: new Date(Date.now() - 3600000),
    });
    const afterCanceled = await resolveSubscriptionEntitlements(proId);
    rec(
      "status-canceled-ended",
      afterCanceled.hasActiveEntitlements === false ? "PASS" : "FAIL",
      `ended canceled → hasActive=${afterCanceled.hasActiveEntitlements}`,
    );

    await setSubStatus(proId, SubscriptionStatus.canceled, {
      canceledAt: new Date(),
      currentPeriodEnd: new Date(Date.now() + 86400000 * 10),
    });
    const cancelGrace = await resolveSubscriptionEntitlements(proId);
    rec(
      "status-canceled-grace",
      cancelGrace.hasActiveEntitlements === true && cancelGrace.plan === "premium" ? "PASS" : "FAIL",
      `canceled with future periodEnd still entitled plan=${cancelGrace.plan}`,
    );

    await setSubStatus(proId, SubscriptionStatus.active);

    rec(
      "cross-tenant-checkout-bind",
      checkoutSessionBoundToBusiness({ metadata: { caretipBusinessId: proId } }, basicId) === false
        ? "PASS"
        : "FAIL",
      "A cannot bind B checkout session",
    );

    rec(
      "fe-be-basic-caps",
      capabilitiesForTier("basic").includes("tableQr") &&
        !capabilitiesForTier("basic").includes("employeeGoals")
        ? "PASS"
        : "FAIL",
      "Backend Basic matrix: tableQr yes, employeeGoals no (frontend file reviewed statically — same lists)",
    );

    rec(
      "fe-be-pro-caps",
      capabilitiesForTier("premium").includes("employeeGoals") &&
        capabilitiesForTier("enterprise").includes("employeeGoals")
        ? "PASS"
        : "FAIL",
      "Backend Pro/Enterprise share Pro capabilities",
    );

    rec(
      "fe-be-tableQr-basic",
      hasSubscriptionCapability("basic", "tableQr") ? "PASS" : "FAIL",
      "tableQr entitled on Basic (backend)",
    );

    const grant = await prisma.sponsoredAccessGrant.create({
      data: {
        businessId: noneId,
        programmeKey: "freelancer_support",
        status: SponsoredAccessStatus.active,
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const sponsored = await resolveSubscriptionEntitlements(noneId);
    rec(
      "sponsored-grant-pro",
      sponsored.accessSource === "sponsored" &&
        sponsored.hasActiveEntitlements &&
        sponsored.capabilities.includes("employeeGoals")
        ? "PASS"
        : "FAIL",
      `src=${sponsored.accessSource} goals=${sponsored.capabilities.includes("employeeGoals")}`,
    );

    await prisma.sponsoredAccessGrant.update({
      where: { id: grant.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expiredGrant = await findActiveSponsoredGrantForBusiness(noneId);
    const afterExpire = await resolveSubscriptionEntitlements(noneId);
    rec(
      "sponsored-expired",
      expiredGrant == null && afterExpire.hasActiveEntitlements === false ? "PASS" : "FAIL",
      `activeGrant=${Boolean(expiredGrant)} hasActive=${afterExpire.hasActiveEntitlements}`,
    );

    const unknownGrant = await prisma.sponsoredAccessGrant.create({
      data: {
        businessId: noneId,
        programmeKey: "not_a_real_programme",
        status: SponsoredAccessStatus.active,
        approvedAt: new Date(),
      },
    });
    const skipUnknown = await findActiveSponsoredGrantForBusiness(noneId);
    rec(
      "sponsored-unknown-programme",
      skipUnknown == null ? "PASS" : "FAIL",
      "Unregistered programmeKey skipped",
    );
    await prisma.sponsoredAccessGrant.delete({ where: { id: unknownGrant.id } }).catch(() => undefined);

    const subWins = await resolveSubscriptionEntitlements(basicId);
    await prisma.sponsoredAccessGrant.create({
      data: {
        businessId: basicId,
        programmeKey: "freelancer_support",
        status: SponsoredAccessStatus.active,
        approvedAt: new Date(),
      },
    });
    const withBoth = await resolveSubscriptionEntitlements(basicId);
    rec(
      "subscription-precedes-sponsored",
      subWins.plan === "basic" && withBoth.plan === "basic" && withBoth.accessSource === "subscription"
        ? "PASS"
        : "FAIL",
      `entitled Basic + Pro grant → still plan=${withBoth.plan} src=${withBoth.accessSource} (subscription wins)`,
    );

    rec(
      "unique-subscription-per-business",
      "INFO",
      "schema Subscription.businessId @unique — duplicate active rows cannot coexist",
    );

    rec(
      "quota-codes",
      PLAN_LIMIT_EXCEEDED_CODE === "PLAN_LIMIT_EXCEEDED" ? "PASS" : "FAIL",
      "Quota error code unchanged",
    );
  } finally {
    try {
      await cleanup();
    } catch (e) {
      console.error("cleanup failed", e);
    }
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`\n--- Phase 12 entitlement probe ---`);
  console.log(`${results.filter((r) => r.status === "PASS").length} passed, ${failed.length} failed`);
  if (failed.length) process.exitCode = 1;
}

await main();
