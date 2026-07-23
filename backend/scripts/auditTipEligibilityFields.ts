/**
 * Phase 13.8b — tip eligibility field dump (demo vs onboarding-approved non-demo).
 * Run from backend/: npx tsx scripts/auditTipEligibilityFields.ts
 */
import "../src/loadEnv.js";
import { PrismaClient } from "@prisma/client";
import {
  hasBusinessVerificationCapability,
  resolveBusinessVerificationCapabilities,
} from "../src/config/businessVerificationCapabilities.js";
import { kycStatusToLegacyMirror } from "../src/lib/verificationWorkflow.js";

const prisma = new PrismaClient();

function decide(row: {
  id: string;
  name: string;
  onboardingVerificationStatus: string | null;
  kycVerificationStatus: string | null;
  verificationStatus: string | null;
  operationalStatus: string | null;
  stripeAccountId: string | null;
}) {
  const legacy = kycStatusToLegacyMirror(row.kycVerificationStatus as never);
  const flags = resolveBusinessVerificationCapabilities(legacy, {
    onboardingVerificationStatus: row.onboardingVerificationStatus as never,
  });
  const receiveTips = hasBusinessVerificationCapability(legacy, "receiveTips", {
    onboardingVerificationStatus: row.onboardingVerificationStatus as never,
  });
  return {
    businessId: row.id,
    name: row.name,
    onboardingVerificationStatus: row.onboardingVerificationStatus,
    kycVerificationStatus: row.kycVerificationStatus,
    verificationStatus_legacyColumn: row.verificationStatus,
    operationalStatus: row.operationalStatus,
    stripeAccountId: row.stripeAccountId,
    legacyMirrorFromKyc: legacy,
    canGenerateQrCodes: flags.canGenerateQrCodes,
    canActivateTipping: flags.canActivateTipping,
    canReceiveTips: flags.canReceiveTips,
    receiveTips_withOnboardingOpts: receiveTips,
    GO_LIVE_REQUIRED_would_fire: !receiveTips,
    GO_LIVE_REQUIRED_reason: !receiveTips
      ? `canReceiveTips=false (onboarding=${row.onboardingVerificationStatus}, kyc=${row.kycVerificationStatus}, mirror=${legacy})`
      : null,
  };
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL missing after loadEnv — check repo root /.env and backend/.env");
  }

  const select = {
    id: true,
    name: true,
    slug: true,
    onboardingVerificationStatus: true,
    kycVerificationStatus: true,
    verificationStatus: true,
    operationalStatus: true,
    stripeAccountId: true,
    stripeCustomerId: true,
    createdAt: true,
  } as const;

  const demo = await prisma.business.findMany({
    where: { id: { startsWith: "cldemo_business_" } },
    select,
    orderBy: { name: "asc" },
  });

  const approvedNonDemo = await prisma.business.findMany({
    where: {
      onboardingVerificationStatus: "approved",
      NOT: { id: { startsWith: "cldemo_business_" } },
    },
    select,
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  console.log(
    JSON.stringify(
      {
        demo: demo.map(decide),
        approvedNonDemo: approvedNonDemo.map(decide),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
