/**
 * Sprint 3 manager KYC self-service runtime checks.
 * Run: npm run test:sprint3-kyc (from backend/)
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import * as kycService from "../src/services/kyc.service.js";
import * as authService from "../src/services/auth.service.js";

const TEST_PASSWORD = "TestPass1!";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function main() {
  const email = `sprint3-kyc-${Date.now()}@caretip-test.local`;
  let userId: string | null = null;
  let businessId: string | null = null;

  try {
    const reg = await authService.registerBusiness({
      email,
      password: TEST_PASSWORD,
      name: "Sprint3 KYC Test Venue",
    });
    userId = reg.user.id;
    const biz = await prisma.business.findFirst({ where: { userId }, select: { id: true } });
    businessId = biz?.id ?? null;
    if (!userId || !businessId) {
      fail("register business seed");
    } else {
      pass("register business for KYC test");
    }

    await prisma.user.update({
      where: { id: userId! },
      data: { emailVerified: true, hasCompletedOnboarding: true },
    });

    const initial = await kycService.getManagerKycStatus(userId!);
    if (initial.kycUiStatus === "PENDING_UPLOAD") pass("initial status PENDING_UPLOAD");
    else fail(`initial status expected PENDING_UPLOAD got ${initial.kycUiStatus}`);

    if (initial.timeline.length === 0) pass("timeline empty before any KYC event");
    else fail(`fresh business timeline should be empty, got ${initial.timeline.length}`);

    const docs = {
      registration: "/uploads/kyc/test-reg.pdf",
      address: "/uploads/kyc/test-addr.pdf",
      governmentId: "/uploads/kyc/test-id.pdf",
    };
    for (const [type, path] of Object.entries(docs)) {
      await kycService.upsertManagerKycDocument(
        userId!,
        type as kycService.KycDocumentType,
        path,
      );
    }
    pass("upsert three required documents");

    const afterUpload = await kycService.getManagerKycStatus(userId!);
    if (kycService.hasRequiredKycDocuments(afterUpload.kycDocuments)) {
      pass("required documents present after upload");
    } else {
      fail("required documents missing after upload");
    }

    const submitted = await kycService.submitManagerKycForReview(userId!);
    if (submitted.kycUiStatus === "UNDER_REVIEW" && submitted.kycSubmittedAt) {
      pass("submit → UNDER_REVIEW with timestamp");
    } else {
      fail("submit did not move to UNDER_REVIEW");
    }

    await prisma.business.update({
      where: { id: businessId! },
      data: { verificationStatus: "rejected" },
    });
    const rejected = await kycService.getManagerKycStatus(userId!);
    if (rejected.kycUiStatus === "REJECTED") pass("admin rejection → REJECTED UI status");
    else fail("rejection UI status");

    await kycService.upsertManagerKycDocument(userId!, "registration", "/uploads/kyc/test-reg-v2.pdf");
    const reupload = await kycService.getManagerKycStatus(userId!);
    if (reupload.verificationStatus === "pending") pass("re-upload after rejection resets to pending");
    else fail("re-upload after rejection");

    await kycService.submitManagerKycForReview(userId!);
    pass("resubmit after rejection");

    await prisma.business.update({
      where: { id: businessId! },
      data: { verificationStatus: "verified" },
    });
    const approved = await kycService.getManagerKycStatus(userId!);
    if (approved.kycUiStatus === "APPROVED") pass("verified → APPROVED UI status");
    else fail("approved UI status");
  } finally {
    if (userId) {
      await prisma.business.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
