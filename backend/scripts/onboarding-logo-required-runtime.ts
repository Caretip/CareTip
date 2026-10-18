/**
 * Onboarding cannot finish without a logo this app persisted for the business.
 * Pure checks only — no database and no uploads.
 *
 *   npx tsx scripts/onboarding-logo-required-runtime.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  inferManagerOnboardingStep,
  isPersistedBusinessLogoReference,
  managerProfileReadyToFinish,
  type BusinessProfileForOnboarding,
} from "../src/services/onboardingProgress.service.js";

const ready: BusinessProfileForOnboarding = {
  name: "Care Tip Venue",
  businessType: "cafe",
  registeredAddress: "1 Main Street",
  contactPhone: "+491701234567",
};

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}`);
  }
}

check("missing logo blocks finish", !managerProfileReadyToFinish(ready));
check("empty logo blocks finish", !managerProfileReadyToFinish({ ...ready, logoPath: "  " }));
check("client url is not a stored logo", !isPersistedBusinessLogoReference("https://evil.example/logo.png"));
check("javascript url rejected", !isPersistedBusinessLogoReference("javascript:alert(1)"));
check(
  "other business disk path is still a stored logo shape",
  isPersistedBusinessLogoReference("https://api.example/uploads/businesses/other-business/logo.png"),
);
check(
  "manager upload path accepted",
  managerProfileReadyToFinish({
    ...ready,
    logoPath: "https://project.supabase.co/storage/v1/object/public/media/business-logos/logo.png",
  }),
);
check(
  "platform upload path accepted",
  isPersistedBusinessLogoReference("https://cdn.example/platform-logos/biz/logo.png"),
);
check(
  "step inference ignores logo so completed businesses are not rewound",
  inferManagerOnboardingStep(ready) === 3,
);

const controller = readFileSync(new URL("../src/controllers/auth.controller.ts", import.meta.url), "utf8");
check("finish route uses managerProfileReadyToFinish", controller.includes("managerProfileReadyToFinish"));
check("finish route returns ONBOARDING_LOGO_REQUIRED", controller.includes("ONBOARDING_LOGO_REQUIRED"));
check("finish route reads the stored profile logo", controller.includes("logoPath: profile.logo"));

const uploadRoute = readFileSync(new URL("../src/routes/business.routes.ts", import.meta.url), "utf8");
const uploadService = readFileSync(new URL("../src/services/upload.service.ts", import.meta.url), "utf8");
const uploadMw = readFileSync(new URL("../src/middleware/businessUpload.middleware.ts", import.meta.url), "utf8");
check("logo route stays authenticated manager upload", uploadRoute.includes('"/profile/logo"') && uploadRoute.includes("requireRole(Role.MANAGER)"));
check("upload writes business-logos before returning", uploadService.includes("business-logos/"));
check("upload confirms the object before the caller stores it", uploadService.includes("assertUploadedObjectReadableInBucket"));
check("logo upload stays at 5 MB", uploadMw.includes("fileSize: 5 * 1024 * 1024"));
check("logo upload still uses the image mime guard", uploadMw.includes("assertMulterMimetypeAllowedForLogo"));

const profileUpdate = readFileSync(new URL("../src/services/business.service.ts", import.meta.url), "utf8");
const updateFn = profileUpdate.slice(profileUpdate.indexOf("export async function updateManagerBusinessProfile"));
check("profile patch cannot set logoPath", !updateFn.slice(0, 800).includes("logoPath"));

assert.equal(failed, 0);
console.log("ALL PASS");
