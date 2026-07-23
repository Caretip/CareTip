/**
 * Probe tip + refunds for a PaymentIntent.
 * Run: npx tsx scripts/probeTipByPaymentIntent.ts pi_xxx
 */
import "../src/loadEnv.js";
import { PrismaClient } from "@prisma/client";
import {
  hasBusinessVerificationCapability,
  resolveBusinessVerificationCapabilities,
} from "../src/config/businessVerificationCapabilities.js";
import { kycStatusToLegacyMirror } from "../src/lib/verificationWorkflow.js";
import { isKycRequiredForReceiveTips } from "../src/config/mvpVerificationPolicy.js";

const prisma = new PrismaClient();
const piId = process.argv[2]?.trim() || "pi_3TwJQQ66w930Tx0A0QRaBjQg";

async function main() {
  const tips = await prisma.transaction.findMany({
    where: { stripePaymentIntentId: piId },
    select: {
      id: true,
      status: true,
      amount: true,
      businessId: true,
      employeeId: true,
      receiptNumber: true,
      createdAt: true,
      stripePaymentIntentId: true,
    },
  });

  const businessId = tips[0]?.businessId ?? "cmrx7jm58000bku48a0v4u27x";
  const employeeId = tips[0]?.employeeId ?? "cmrx8gt8p004bku48hfkxidn9";

  const [business, employee, refunds] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        onboardingVerificationStatus: true,
        kycVerificationStatus: true,
        operationalStatus: true,
      },
    }),
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        isActive: true,
        isDeleted: true,
        activationStatus: true,
        user: { select: { emailVerified: true, isActive: true } },
      },
    }),
    prisma.tipRefund.findMany({
      where: { stripePaymentIntentId: piId },
      select: {
        id: true,
        stripeRefundId: true,
        status: true,
        amountEur: true,
        reason: true,
        tipId: true,
        createdAt: true,
      },
    }),
  ]);

  const legacy = kycStatusToLegacyMirror(business?.kycVerificationStatus as never);
  const caps = resolveBusinessVerificationCapabilities(legacy, {
    onboardingVerificationStatus: business?.onboardingVerificationStatus as never,
  });

  console.log(
    JSON.stringify(
      {
        paymentIntentId: piId,
        tips,
        refunds,
        business,
        employee,
        mvpKycRequiredForReceiveTips: isKycRequiredForReceiveTips(),
        legacyMirrorFromKyc: legacy,
        capabilities: caps,
        lookupWouldFindSuccess: tips.some((t) => t.status === "success"),
        lifecycleVerdict:
          tips.length === 0
            ? "NO_TIP — webhook never persisted"
            : tips[0]?.status === "failed"
              ? "WEBHOOK_RAN → eligibility failed → tip status=failed → getTipSessionContext filters status=success → infinite pending"
              : tips[0]?.status === "success"
                ? "SUCCESS — should be ready"
                : `UNEXPECTED status=${tips[0]?.status}`,
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
