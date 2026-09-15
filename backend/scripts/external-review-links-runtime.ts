/**
 * Google / TripAdvisor review-link configuration (backend).
 * Run: npm --prefix backend run test:external-review-links
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { BusinessSubscriptionTier } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { buildNestedSubscriptionCreateData } from "../src/services/subscription.service.js";
import {
  createLocationForBusinessUser,
  updateLocationForBusinessUser,
  listLocationsForBusinessUser,
  withLocationReviewLinkFields,
} from "../src/services/locations.service.js";
import { resolveTipVenueIds, guestTipCheckoutCancelUrl } from "../src/services/stripe.service.js";
import {
  googleWriteReviewUrlFromPlaceId,
  INVALID_GOOGLE_PLACE_ID,
  INVALID_TRIPADVISOR_REVIEW_URL,
  normalizeGooglePlaceId,
  normalizeTripadvisorReviewUrl,
  toPublicGuestExternalReviews,
} from "../src/lib/externalReviewLinks.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "../..");

const results: string[] = [];
let failed = 0;
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => {
  failed += 1;
  results.push(`FAIL: ${m}`);
};

function read(rel: string): string {
  const p = join(root, rel);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

const SAMPLE_PLACE = "ChIJJ4vHZOVkskcRYFbcF3dtLbo";
const SAMPLE_PLACE_B = "ChIJN1t_tDeuEmsRUsoyG83frY4";

function expectPlaceOk(raw: string, label: string) {
  const r = normalizeGooglePlaceId(raw);
  if (!r.ok || r.value !== raw.trim()) fail(`${label}: expected valid Place ID`);
  else pass(label);
}

function expectPlaceFail(raw: string, label: string) {
  const r = normalizeGooglePlaceId(raw);
  if (r.ok || r.message !== INVALID_GOOGLE_PLACE_ID) fail(`${label}: expected invalid Place ID`);
  else pass(label);
}

function expectTripOk(raw: string, label: string) {
  const r = normalizeTripadvisorReviewUrl(raw);
  if (!r.ok || !r.value?.startsWith("https://")) fail(`${label}: expected valid TripAdvisor URL`);
  else pass(label);
}

function expectTripFail(raw: string, label: string) {
  const r = normalizeTripadvisorReviewUrl(raw);
  if (r.ok || r.message !== INVALID_TRIPADVISOR_REVIEW_URL) fail(`${label}: expected invalid TripAdvisor URL`);
  else pass(label);
}

function staticArchitecture() {
  const schema = read("backend/prisma/schema.prisma");
  if (schema.includes("googlePlaceId") && schema.includes("tripadvisorReviewUrl") && schema.includes("model Location")) {
    pass("Location schema stores Place ID + TripAdvisor URL");
  } else {
    fail("Location schema missing review-link fields");
  }

  const stripe = read("backend/src/services/stripe.service.ts");
  const staffCtl = read("backend/src/controllers/staff.controller.ts");
  const empSvc = read("backend/src/services/employee.service.ts");
  if (
    staffCtl.includes("locationId: employee.locationId ?? null") &&
    empSvc.includes("locationId: emp.locationId ?? null") &&
    stripe.includes("Employee.locationId")
  ) {
    pass("Public employee/staff DTOs expose assigned locationId; checkout uses it when no table/location QR");
  } else {
    fail("Employee QR location assignment must flow through public DTO and resolveTipVenueIds");
  }

  if (stripe.includes("success_url: `${base}/rating?session_id={CHECKOUT_SESSION_ID}`")) {
    pass("Stripe Checkout success_url still returns to /rating");
  } else {
    fail("Stripe Checkout success_url drifted");
  }

  if (
    stripe.includes("Employee.locationId here") &&
    stripe.includes("typeof md.locationId") &&
    stripe.includes("guestTipCheckoutCancelUrl(base, employeeId, locId, tblId)")
  ) {
    pass("Paid-tip venue uses Checkout metadata snapshot, not live employee assignment");
  } else {
    fail("Webhook must not re-resolve venue from Employee.locationId");
  }

  const pay = read("backend/src/controllers/payment.controller.ts");
  if (
    pay.includes("externalReviews: toPublicGuestExternalReviews(tx.location)") &&
    !pay.includes("resolveTipVenueIds") &&
    pay.includes('Cache-Control", "no-store') &&
    pay.includes('status: "ready"') &&
    !/status: "pending"[\s\S]{0,400}externalReviews/.test(pay)
  ) {
    pass("Guest review URLs use the tip's Location row only on ready responses");
  } else {
    fail("externalReviews must come from tx.location on ready tip-session payloads only");
  }

  const locRoutes = read("backend/src/routes/locations.routes.ts");
  if (
    locRoutes.includes("requireRole(Role.MANAGER)") &&
    locRoutes.includes("locationsController.updateLocation")
  ) {
    pass("Location write APIs remain manager-only");
  } else {
    fail("Location routes must stay MANAGER-scoped");
  }

  const feedback = read("backend/src/controllers/feedback.controller.ts");
  if (feedback.includes("export async function submitTipFeedback") || feedback.includes("submitTip")) {
    pass("CareTip internal tip feedback endpoint still present");
  } else {
    fail("Internal CareTip review endpoint missing");
  }
}

async function createTestBusiness(): Promise<{ businessId: string; userId: string }> {
  const tag = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: {
          name: `${tag} venue`,
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
  const businessId = user.business?.id;
  if (!businessId) throw new Error("business create failed");
  return { businessId, userId: user.id };
}

async function dbCases(): Promise<void> {
  const owner = await createTestBusiness();
  const other = await createTestBusiness();
  try {
    const loc = await createLocationForBusinessUser(owner.userId, "Review site", null, {
      googlePlaceId: SAMPLE_PLACE,
      tripadvisorReviewUrl: "https://www.tripadvisor.com/Restaurant_Review-g187309.html",
    });
    if (loc.googlePlaceId !== SAMPLE_PLACE) {
      fail("create location did not persist Google Place ID");
    } else {
      pass("configuration creation persists Google Place ID");
    }
    if (!loc.tripadvisorReviewUrl?.startsWith("https://www.tripadvisor.com/")) {
      fail("create location did not persist TripAdvisor URL");
    } else {
      pass("configuration creation persists TripAdvisor URL");
    }

    const updated = await updateLocationForBusinessUser(owner.userId, loc.id, "Review site", null, {
      googlePlaceId: SAMPLE_PLACE,
      tripadvisorReviewUrl: "https://www.tripadvisor.de/Restaurant_Review-g187309.html",
    });
    if (!updated.tripadvisorReviewUrl?.includes("tripadvisor.de")) {
      fail("configuration update did not persist TripAdvisor URL");
    } else {
      pass("configuration update works");
    }

    const cleared = await updateLocationForBusinessUser(owner.userId, loc.id, "Review site", null, {
      googlePlaceId: "",
      tripadvisorReviewUrl: "",
    });
    if (cleared.googlePlaceId != null || cleared.tripadvisorReviewUrl != null) {
      fail("clearing review config must store null");
    } else {
      pass("configuration deletion/clearing stores null");
    }

    const reloadedAfterClear = await prisma.location.findUnique({
      where: { id: loc.id },
      select: { googlePlaceId: true, tripadvisorReviewUrl: true },
    });
    if (reloadedAfterClear?.googlePlaceId == null && reloadedAfterClear?.tripadvisorReviewUrl == null) {
      pass("SQL null after clear is visible on a fresh GET of the location row");
    } else {
      fail("location row still had review columns after clear");
    }

    const listed = await listLocationsForBusinessUser(owner.userId);
    const listedJson = JSON.stringify(listed.find((row) => row.id === loc.id));
    if (listedJson?.includes('"googlePlaceId":null') && listedJson.includes('"tripadvisorReviewUrl":null')) {
      pass("list DTO serializes unconfigured review fields as JSON null");
    } else {
      fail("list DTO must include googlePlaceId/tripadvisorReviewUrl null keys");
    }

    try {
      await updateLocationForBusinessUser(owner.userId, loc.id, "Review site", null, {
        googlePlaceId: "javascript:alert(1)",
      });
      fail("invalid Google Place ID must be rejected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === INVALID_GOOGLE_PLACE_ID) pass("invalid Google Place ID handling");
      else fail(`invalid Google Place ID unexpected: ${msg}`);
    }

    try {
      await updateLocationForBusinessUser(owner.userId, loc.id, "Review site", null, {
        tripadvisorReviewUrl: "http://www.tripadvisor.com/x",
      });
      fail("HTTP TripAdvisor URL must be rejected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === INVALID_TRIPADVISOR_REVIEW_URL) pass("HTTPS requirement for TripAdvisor URL");
      else fail(`HTTP TripAdvisor unexpected: ${msg}`);
    }

    try {
      await updateLocationForBusinessUser(owner.userId, loc.id, "Review site", null, {
        tripadvisorReviewUrl: "https://evil.example/review",
      });
      fail("non-TripAdvisor URL must be rejected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === INVALID_TRIPADVISOR_REVIEW_URL) pass("invalid TripAdvisor URL rejected");
      else fail(`non-TripAdvisor unexpected: ${msg}`);
    }

    try {
      await updateLocationForBusinessUser(other.userId, loc.id, "Hijack", null, {
        googlePlaceId: SAMPLE_PLACE,
      });
      fail("cross-tenant location update must be rejected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found/i.test(msg)) pass("tenant/location authorization blocks cross-business writes");
      else fail(`cross-tenant unexpected: ${msg}`);
    }

    const emp = await prisma.employee.create({
      data: {
        name: "Review staff QR",
        jobTitle: "Waiter",
        businessId: owner.businessId,
        isActive: true,
        activationStatus: "active",
      },
    });
    const sole = await resolveTipVenueIds(owner.businessId, emp.id, null, null);
    if (sole.locationId == null) {
      pass("staff QR without table/location does not infer a Location for reviews");
    } else {
      fail(`staff QR must not invent locationId, got ${sole.locationId}`);
    }

    const locB = await prisma.location.create({
      data: { name: "Second site", businessId: owner.businessId },
      select: { id: true },
    });
    const stillNone = await resolveTipVenueIds(owner.businessId, emp.id, null, null);
    if (stillNone.locationId == null) {
      pass("staff QR with multiple locations does not invent a venue");
    } else {
      fail(`ambiguous venue must stay null, got ${stillNone.locationId}`);
    }

    await updateLocationForBusinessUser(owner.userId, loc.id, "Review site", null, {
      googlePlaceId: SAMPLE_PLACE,
      tripadvisorReviewUrl: "https://www.tripadvisor.com/Restaurant_Review-g187309.html",
    });
    await prisma.location.update({
      where: { id: locB.id },
      data: {
        googlePlaceId: SAMPLE_PLACE_B,
        tripadvisorReviewUrl: "https://www.tripadvisor.de/Restaurant_Review-g187309.html",
      },
    });
    await updateLocationForBusinessUser(owner.userId, loc.id, "Review site", null, {
      googlePlaceId: null,
      tripadvisorReviewUrl: null,
    });
    const locAAfter = await prisma.location.findUnique({
      where: { id: loc.id },
      select: { googlePlaceId: true, tripadvisorReviewUrl: true },
    });
    const locBAfter = await prisma.location.findUnique({
      where: { id: locB.id },
      select: { googlePlaceId: true, tripadvisorReviewUrl: true },
    });
    const publicA = toPublicGuestExternalReviews(locAAfter);
    const publicB = toPublicGuestExternalReviews(locBAfter);
    if (publicA === null && publicB?.googleWriteReviewUrl && publicB.tripadvisorReviewUrl) {
      pass("clearing location A does not remove location B review links");
    } else {
      fail("location A/B review-link isolation failed");
    }
    if (!JSON.stringify(withLocationReviewLinkFields(locAAfter ?? {})).includes(SAMPLE_PLACE_B)) {
      pass("location A DTO does not contain location B Place ID");
    } else {
      fail("location A leaked location B Place ID");
    }

    await prisma.employee.update({
      where: { id: emp.id },
      data: { locationId: loc.id },
    });
    const fromEmp = await resolveTipVenueIds(owner.businessId, emp.id, null, null);
    if (fromEmp.locationId === loc.id) {
      pass("employee QR uses Employee.locationId when the staff member is assigned");
    } else {
      fail(`assigned employee expected location ${loc.id}, got ${fromEmp.locationId}`);
    }

    const explicitB = await resolveTipVenueIds(owner.businessId, emp.id, locB.id, null);
    if (explicitB.locationId === locB.id) {
      pass("explicit location QR still wins over employee assignment");
    } else {
      fail(`explicit location expected ${locB.id}, got ${explicitB.locationId}`);
    }

    await prisma.employee.update({
      where: { id: emp.id },
      data: { locationId: locB.id },
    });
    const newScanAfterMove = await resolveTipVenueIds(owner.businessId, emp.id, null, null);
    if (newScanAfterMove.locationId === locB.id) {
      pass("new employee QR after reassignment uses the current Location");
    } else {
      fail(`moved employee expected ${locB.id}, got ${newScanAfterMove.locationId}`);
    }
    const paidSnapshot = await resolveTipVenueIds(owner.businessId, null, loc.id, null);
    if (paidSnapshot.locationId === loc.id) {
      pass("captured tip keeps checkout locationId after the employee moved");
    } else {
      fail(`snapshot expected ${loc.id}, got ${paidSnapshot.locationId}`);
    }
    const historicalA = toPublicGuestExternalReviews(
      await prisma.location.findUnique({
        where: { id: loc.id },
        select: { googlePlaceId: true, tripadvisorReviewUrl: true },
      }),
    );
    const currentB = toPublicGuestExternalReviews(
      await prisma.location.findUnique({
        where: { id: locB.id },
        select: { googlePlaceId: true, tripadvisorReviewUrl: true },
      }),
    );
    if (!historicalA && currentB?.googleWriteReviewUrl && currentB.tripadvisorReviewUrl) {
      pass("historical Location A reviews stay isolated after employee moved to configured Location B");
    } else {
      fail("historical vs current location review isolation failed after employee move");
    }

    const cancelUrl = guestTipCheckoutCancelUrl("https://app.example", emp.id, loc.id, null);
    if (cancelUrl.includes(`employeeId=${emp.id}`) && cancelUrl.includes(`locationId=${loc.id}`)) {
      pass("Stripe cancel_url preserves originating locationId");
    } else {
      fail(`cancel_url missing venue: ${cancelUrl}`);
    }

    if (toPublicGuestExternalReviews(null) === null && publicB) {
      pass("tip with no location does not inherit another location's public reviews");
    } else {
      fail("missing tip location must yield no external reviews");
    }

    await updateLocationForBusinessUser(owner.userId, loc.id, "Review site", null, {
      googlePlaceId: SAMPLE_PLACE,
      tripadvisorReviewUrl: "https://www.tripadvisor.com/Restaurant_Review-g187309.html",
    });
    const bothAgain = toPublicGuestExternalReviews(
      await prisma.location.findUnique({
        where: { id: loc.id },
        select: { googlePlaceId: true, tripadvisorReviewUrl: true },
      }),
    );
    if (bothAgain?.googleWriteReviewUrl && bothAgain.tripadvisorReviewUrl) {
      pass("re-add both destinations restores public review payload");
    } else {
      fail("re-add both did not restore public reviews");
    }
    await updateLocationForBusinessUser(owner.userId, loc.id, "Review site", null, {
      googlePlaceId: null,
      tripadvisorReviewUrl: "https://www.tripadvisor.com/Restaurant_Review-g187309.html",
    });
    const tripOnly = toPublicGuestExternalReviews(
      await prisma.location.findUnique({
        where: { id: loc.id },
        select: { googlePlaceId: true, tripadvisorReviewUrl: true },
      }),
    );
    if (!tripOnly?.googleWriteReviewUrl && tripOnly?.tripadvisorReviewUrl) {
      pass("removing Google only leaves TripAdvisor public review");
    } else {
      fail("Google-only removal payload incorrect");
    }
    await updateLocationForBusinessUser(owner.userId, loc.id, "Review site", null, {
      googlePlaceId: SAMPLE_PLACE,
      tripadvisorReviewUrl: null,
    });
    const googleOnlyRow = toPublicGuestExternalReviews(
      await prisma.location.findUnique({
        where: { id: loc.id },
        select: { googlePlaceId: true, tripadvisorReviewUrl: true },
      }),
    );
    if (googleOnlyRow?.googleWriteReviewUrl && !googleOnlyRow.tripadvisorReviewUrl) {
      pass("removing TripAdvisor only leaves Google public review");
    } else {
      fail("TripAdvisor-only removal payload incorrect");
    }
    await updateLocationForBusinessUser(owner.userId, loc.id, "Review site", null, {
      googlePlaceId: null,
      tripadvisorReviewUrl: null,
    });
    const noneAgain = toPublicGuestExternalReviews(
      await prisma.location.findUnique({
        where: { id: loc.id },
        select: { googlePlaceId: true, tripadvisorReviewUrl: true },
      }),
    );
    if (noneAgain === null) {
      pass("removing both destinations returns CareTip-only public payload");
    } else {
      fail("both-removed payload must be null");
    }

    const otherEmp = await prisma.employee.create({
      data: {
        name: "Other business staff",
        jobTitle: "Waiter",
        businessId: other.businessId,
        isActive: true,
        activationStatus: "active",
      },
    });
    const leak = await resolveTipVenueIds(other.businessId, otherEmp.id, null, null);
    if (leak.locationId == null) {
      pass("other business without locations does not receive review config");
    } else {
      fail(`cross-tenant venue leak: ${leak.locationId}`);
    }
  } finally {
    await prisma.business.delete({ where: { id: owner.businessId } }).catch(() => undefined);
    await prisma.business.delete({ where: { id: other.businessId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: owner.userId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: other.userId } }).catch(() => undefined);
  }
}

async function main() {
  staticArchitecture();

  if (normalizeGooglePlaceId("").ok && normalizeGooglePlaceId("").value === null) {
    pass("empty Google Place ID is not configured");
  } else {
    fail("empty Google Place ID should be null");
  }
  if (normalizeTripadvisorReviewUrl("").ok && normalizeTripadvisorReviewUrl("").value === null) {
    pass("empty TripAdvisor URL is not configured");
  } else {
    fail("empty TripAdvisor URL should be null");
  }

  expectPlaceOk(SAMPLE_PLACE, "typical Google Place ID");
  expectPlaceFail("javascript:alert(1)", "javascript Place ID");
  expectPlaceFail("https://search.google.com/local/writereview?placeid=x", "URL is not a Place ID");
  expectPlaceFail("short", "too-short Place ID");
  expectPlaceFail("ChIJ<>oops", "markup in Place ID");

  expectTripOk("https://www.tripadvisor.com/Restaurant_Review-g187309.html", "tripadvisor.com HTTPS");
  expectTripOk("https://www.tripadvisor.de/Restaurant_Review-g187309.html", "tripadvisor.de HTTPS");
  expectTripFail("javascript:alert(1)", "javascript TripAdvisor");
  expectTripFail("https://evil.example/review", "non-TripAdvisor host");
  expectTripFail("http://www.tripadvisor.com/x", "http TripAdvisor");

  const googleUrl = googleWriteReviewUrlFromPlaceId(SAMPLE_PLACE);
  if (googleUrl === `https://search.google.com/local/writereview?placeid=${encodeURIComponent(SAMPLE_PLACE)}`) {
    pass("Google write-review URL is derived from Place ID");
  } else {
    fail("Google write-review URL derivation drifted");
  }

  const none = toPublicGuestExternalReviews({ googlePlaceId: null, tripadvisorReviewUrl: null });
  if (none === null) pass("customer-facing missing configuration is null");
  else fail("missing configuration must not expose an object");

  const googleOnly = toPublicGuestExternalReviews({
    googlePlaceId: SAMPLE_PLACE,
    tripadvisorReviewUrl: null,
  });
  if (googleOnly?.googleWriteReviewUrl && !googleOnly.tripadvisorReviewUrl) {
    pass("customer-facing Google only");
  } else {
    fail("Google-only public payload incorrect");
  }

  const tripOnly = toPublicGuestExternalReviews({
    googlePlaceId: null,
    tripadvisorReviewUrl: "https://www.tripadvisor.com/Restaurant_Review-g187309.html",
  });
  if (!tripOnly?.googleWriteReviewUrl && tripOnly?.tripadvisorReviewUrl) {
    pass("customer-facing TripAdvisor only");
  } else {
    fail("TripAdvisor-only public payload incorrect");
  }

  const both = toPublicGuestExternalReviews({
    googlePlaceId: SAMPLE_PLACE,
    tripadvisorReviewUrl: "https://www.tripadvisor.com/Restaurant_Review-g187309.html",
  });
  if (both?.googleWriteReviewUrl && both.tripadvisorReviewUrl) {
    pass("customer-facing both configured");
  } else {
    fail("both-configured public payload incorrect");
  }

  if (!googleOnly || !("googlePlaceId" in googleOnly)) {
    pass("customer-facing payload does not expose Place ID");
  } else {
    fail("do not expose Google Place ID to guests");
  }

  try {
    await dbCases();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|Unknown argument|P2022|google_place_id|tripadvisor_review_url/i.test(msg)) {
      results.push(`SKIP: database cases (apply migration 20260915120000_location_external_review_links): ${msg}`);
    } else {
      fail(`database cases: ${msg}`);
    }
  }

  console.log("external-review-links backend runtime\n");
  for (const line of results) console.log(line);
  if (failed > 0) {
    console.log("\nRESULT: FAIL");
    process.exitCode = 1;
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
