/**
 * Google / TripAdvisor review links — frontend architecture lock.
 * Run: npm run test:external-review-links-frontend
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  coerceLocationReviewLinkFields,
  guestReviewExperience,
  googleWriteReviewUrlFromPlaceId,
  normalizeGooglePlaceId,
  normalizeTripadvisorReviewUrl,
  sanitizeGuestExternalReviews,
} from "../src/app/lib/externalReviewLinks.ts";
import {
  applyGuestTipVenueSearchParams,
  tippingVenueFromGuestSearchParams,
} from "../src/app/lib/guestEmployeeTippingVenue.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results: string[] = [];
let failed = 0;
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => {
  failed += 1;
  results.push(`FAIL: ${m}`);
};

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const SAMPLE_PLACE = "ChIJJ4vHZOVkskcRYFbcF3dtLbo";

function run() {
  const rating = read("src/app/pages/customer/RatingPage.tsx");
  const success = read("src/app/pages/customer/SuccessPage.tsx");
  const completion = read("src/app/pages/customer/TipCompletionPage.tsx");
  const locations = read("src/app/pages/business/LocationsPage.tsx");
  const stripe = read("backend/src/services/stripe.service.ts");
  const en = JSON.parse(read("src/i18n/locales/en.json")) as {
    tipFlow?: { success?: Record<string, string>; rating?: { skip?: string } };
    business?: { locationsPage?: Record<string, string> };
  };
  const de = JSON.parse(read("src/i18n/locales/de.json")) as {
    tipFlow?: { success?: Record<string, string>; rating?: { skip?: string } };
    business?: { locationsPage?: Record<string, string> };
  };

  if (rating.includes("submitTipFeedback") && rating.includes("handleSkip") && rating.includes("GuestExternalReviewLinks")) {
    pass("Rating page still contains CareTip feedback and external links");
  } else {
    fail("Rating page must keep internal review and GuestExternalReviewLinks");
  }
  if (
    rating.includes("guestReviewExperience") &&
    rating.includes('reviewExperience === "external"') &&
    rating.includes("GuestExternalReviewLinks") &&
    rating.includes("tipFlow.rating.experiencePrompt")
  ) {
    pass("External and CareTip review UIs are mutually exclusive on /rating");
  } else {
    fail("Rating page must show either external links or CareTip form, not both");
  }
  if (locations.includes("withReviewLinkFields") && locations.includes("invalidateVenueCatalog")) {
    pass("Location save replaces review fields and invalidates venue cache");
  } else {
    fail("Location save must not merge stale review fields");
  }
  if (en.business?.locationsPage?.reviewNotConfigured && de.business?.locationsPage?.reviewNotConfigured) {
    pass("Settings show configured vs not-configured EN+DE");
  } else {
    fail("Missing not-configured settings copy");
  }

  const staleRow = {
    id: "loc-1",
    googlePlaceId: SAMPLE_PLACE,
    tripadvisorReviewUrl: "https://www.tripadvisor.com/Restaurant_Review-g187309.html",
  };
  const patchOmittingNulls = { id: "loc-1", name: "Site" };
  const naiveMerge = { ...staleRow, ...patchOmittingNulls } as typeof staleRow & { name: string };
  if (naiveMerge.googlePlaceId === SAMPLE_PLACE) {
    pass("naive object merge would keep a removed Place ID");
  } else {
    fail("stale-merge fixture drifted");
  }
  const coerced = { ...staleRow, ...patchOmittingNulls, ...coerceLocationReviewLinkFields(patchOmittingNulls) };
  if (coerced.googlePlaceId === null && coerced.tripadvisorReviewUrl === null) {
    pass("omitted review keys coerce to unconfigured null");
  } else {
    fail("coerceLocationReviewLinkFields must treat missing keys as not configured");
  }
  if (rating.includes("sessionReady ?") && rating.includes("GuestExternalReviewLinks")) {
    pass("External links on /rating require verified session");
  } else {
    fail("Do not show external links before verified payment on /rating");
  }

  const guestLinks = read("src/app/pages/customer/GuestExternalReviewLinks.tsx");
  if (guestLinks.includes('../../lib/externalReviewLinks')) {
    pass("Guest review links import shared sanitizer from app/lib");
  } else {
    fail("GuestExternalReviewLinks must import ../../lib/externalReviewLinks");
  }

  if (success.includes("isVerifiedTipSessionReady") && !success.includes("GuestExternalReviewLinks")) {
    pass("Success confirmation does not duplicate /rating review UI");
  } else {
    fail("Do not render Google/TripAdvisor on /success; /rating is the review surface");
  }

  if (!completion.includes("GuestExternalReviewLinks")) {
    pass("Tip completion does not duplicate external review UI");
  } else {
    fail("Do not duplicate review links on /tip-complete");
  }

  if (
    locations.includes("googlePlaceId") &&
    locations.includes("tripadvisorReviewUrl") &&
    locations.includes("normalizeGooglePlaceId") &&
    locations.includes("normalizeTripadvisorReviewUrl")
  ) {
    pass("Locations settings can save, edit, and clear review links");
  } else {
    fail("Locations page missing review-link configuration");
  }

  if (stripe.includes("/rating?session_id={CHECKOUT_SESSION_ID}")) {
    pass("Guest Stripe return path remains /rating");
  } else {
    fail("Do not change Stripe Checkout success_url");
  }

  const requiredEn = [
    "externalReviewsHeading",
    "externalReviewsHint",
    "reviewOnGoogle",
    "reviewOnTripadvisor",
    "opensExternal",
  ];
  for (const key of requiredEn) {
    if (en.tipFlow?.success?.[key] && de.tipFlow?.success?.[key]) pass(`i18n ${key} EN+DE`);
    else fail(`missing i18n tipFlow.success.${key}`);
  }
  if (en.business?.locationsPage?.labelGoogleReview && de.business?.locationsPage?.labelGoogleReview) {
    pass("Business settings review labels EN+DE");
  } else {
    fail("Business settings missing review i18n");
  }
  if (en.tipFlow?.rating?.skip && de.tipFlow?.rating?.skip) {
    pass("Internal review skip copy still localized");
  } else {
    fail("Do not remove CareTip skip feedback copy");
  }

  const googleUrl = googleWriteReviewUrlFromPlaceId(SAMPLE_PLACE);
  const safe = sanitizeGuestExternalReviews({
    googleWriteReviewUrl: googleUrl,
    tripadvisorReviewUrl: "https://www.tripadvisor.com/Restaurant_Review-g187309.html",
  });
  if (safe?.googleWriteReviewUrl && safe.tripadvisorReviewUrl) pass("client sanitizer accepts both HTTPS destinations");
  else fail("client sanitizer rejected valid destinations");

  if (!sanitizeGuestExternalReviews({ googleWriteReviewUrl: "javascript:alert(1)", tripadvisorReviewUrl: "https://evil.example" })) {
    pass("client sanitizer drops javascript / non-allowlisted hosts");
  } else {
    fail("client sanitizer must drop unsafe URLs");
  }
  if (!sanitizeGuestExternalReviews(null)) pass("missing configuration sanitizes to null");
  else fail("null reviews must stay hidden");

  if (!normalizeGooglePlaceId("https://evil").ok) pass("frontend Place ID validation rejects URLs");
  else fail("frontend Place ID validation too loose");
  if (!normalizeTripadvisorReviewUrl("http://www.tripadvisor.com/x").ok) {
    pass("frontend TripAdvisor validation requires HTTPS");
  } else {
    fail("frontend TripAdvisor validation must require HTTPS");
  }

  if (guestReviewExperience(null) === "caretip") pass("guestReviewExperience none → caretip");
  else fail("unconfigured must be caretip mode");
  if (guestReviewExperience(safe) === "external") pass("guestReviewExperience both → external");
  else fail("configured payload must be external mode");

  const css = read("src/styles/caretip-customer-flow-premium.css");
  if (css.includes("white-space: normal") && css.includes(".customer-flow-external-review-btn")) {
    pass("External review buttons wrap on narrow viewports");
  } else {
    fail("External review button CSS missing wrap");
  }

  const empQr = read("src/app/pages/customer/EmployeeQrEntryPage.tsx");
  const staffPath = read("src/app/pages/customer/StaffTipByPublicPathPage.tsx");
  const staffLand = read("src/app/pages/customer/StaffLandingPage.tsx");
  const locQr = read("src/app/pages/customer/LocationQrLandingPage.tsx");
  const tableQr = read("src/app/pages/customer/TableQrLandingPage.tsx");
  const tipAmt = read("src/app/pages/customer/TipAmountPage.tsx");
  const stripeSvc = read("backend/src/services/stripe.service.ts");
  const empSvc = read("backend/src/services/employee.service.ts");
  if (
    empQr.includes("applyGuestTipVenueSearchParams") &&
    staffPath.includes("applyGuestTipVenueSearchParams") &&
    staffLand.includes("applyGuestTipVenueSearchParams") &&
    locQr.includes("applyGuestTipVenueSearchParams") &&
    tableQr.includes("applyGuestTipVenueSearchParams") &&
    tipAmt.includes("tippingVenueFromGuestSearchParams") &&
    empQr.includes('usePublicHtmlBootHandoff(phase === "ready" && Boolean(emp))') &&
    tipAmt.includes("loading={!contextReady}") &&
    stripeSvc.includes("Employee.locationId") &&
    empSvc.includes("locationName: emp.location?.name") &&
    !empQr.includes("googlePlaceId") &&
    read("src/app/lib/resolveCustomerEmployeeContext.ts").includes("ctx.employeeName?.trim()")
  ) {
    pass("Employee/staff/location QR persist originating locationId without gating tip-page on review config");
  } else {
    fail("Employee QR must capture assigned locationId and must not gate ready on review config");
  }

  const qs = new URLSearchParams({ employeeId: "emp-1" });
  applyGuestTipVenueSearchParams(qs, { locationId: "loc-a", tableId: "tbl-1" });
  const fromUrl = tippingVenueFromGuestSearchParams(qs);
  if (qs.get("locationId") === "loc-a" && qs.get("tableId") === "tbl-1" && fromUrl?.locationId === "loc-a") {
    pass("Guest tip URL venue params round-trip locationId and tableId");
  } else {
    fail("applyGuestTipVenueSearchParams / tippingVenueFromGuestSearchParams mismatch");
  }

  const locationsPage = read("src/app/pages/business/LocationsPage.tsx");
  if (
    locationsPage.includes("openEdit = (loc: LocationDTO)") &&
    locationsPage.includes("setGooglePlaceId(loc.googlePlaceId ?? \"\")") &&
    locationsPage.includes("updateLocationAPI(editing.id")
  ) {
    pass("Locations settings edit/save target the selected Location id only");
  } else {
    fail("Locations page must bind review fields to editing.id");
  }

  const htmlBoot = read("src/app/lib/htmlMarketingBootBridge.ts");
  const shell = read("src/app/pages/customer/CustomerFlowShell.tsx");
  const pageLoader = read("src/app/components/CareTipPageLoader.tsx");
  const tipAmtSrc = read("src/app/pages/customer/TipAmountPage.tsx");
  const manager = read("src/app/context/AppLoadingManager.tsx");
  if (
    htmlBoot.includes("isCustomerJourneyPath") &&
    htmlBoot.includes("[data-caretip-route-ready]") &&
    manager.includes("if (isHtmlBootElementPresent())") &&
    manager.includes("htmlBootHandoffStartedRef.current = false") &&
    !manager.includes('boot?.classList.remove("caretip-html-boot--exiting")') &&
    shell.includes("usePublicHtmlBootHandoff(!loading)") &&
    shell.includes("data-caretip-route-ready") &&
    !pageLoader.includes("data-caretip-public-committed") &&
    tipAmtSrc.includes("loading={!contextReady}")
  ) {
    pass("HTML boot stays until destination route-ready; wait placeholders do not dismiss it");
  } else {
    fail("Public tip hang: HTML boot must dismiss only when the destination is ready");
  }
  for (const line of results) console.log(line);
  if (failed > 0) {
    console.log("\nRESULT: FAIL");
    process.exit(1);
  }
  console.log("\nRESULT: PASS");
}

run();
