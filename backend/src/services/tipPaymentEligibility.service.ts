import { prisma } from "../prisma.js";
import {
  GO_LIVE_REQUIRED_CODE,
  GO_LIVE_REQUIRED_MESSAGE,
  hasBusinessVerificationCapability,
} from "../config/businessVerificationCapabilities.js";
import { kycStatusToLegacyMirror } from "../lib/verificationWorkflow.js";

/** Guest-safe error when employee or venue cannot receive tips. */
export class TipPaymentEligibilityError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "TipPaymentEligibilityError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const EMPLOYEE_UNAVAILABLE_MSG = "This staff member is not available for tips right now.";

export type TipPaymentEligibilitySnapshot = {
  employeeId: string;
  businessId: string;
  employeeIsActive: boolean;
  activationStatus: string;
  emailVerified: boolean;
  userIsActive: boolean;
  businessVerificationStatus: string;
};

/**
 * Ensures an employee may receive guest tips via Stripe (checkout or webhook).
 * Go-live / receiveTips is resolved centrally in `hasBusinessVerificationCapability`
 * (Policy A: onboarding while MVP KYC disabled; KYC when re-enabled).
 */
export async function assertEmployeeEligibleForTipPayment(
  employeeId: string,
  businessId: string,
): Promise<TipPaymentEligibilitySnapshot> {
  const trimmedEmployeeId = employeeId?.trim();
  const trimmedBusinessId = businessId?.trim();

  if (!trimmedEmployeeId || !trimmedBusinessId) {
    throw new TipPaymentEligibilityError(EMPLOYEE_UNAVAILABLE_MSG, "TIP_CONTEXT_INVALID");
  }

  const emp = await prisma.employee.findUnique({
    where: { id: trimmedEmployeeId },
    select: {
      id: true,
      businessId: true,
      isActive: true,
      isDeleted: true,
      activationStatus: true,
      user: { select: { emailVerified: true, isActive: true } },
      business: {
        select: {
          id: true,
          kycVerificationStatus: true,
          onboardingVerificationStatus: true,
          operationalStatus: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!emp) {
    throw new TipPaymentEligibilityError(EMPLOYEE_UNAVAILABLE_MSG, "EMPLOYEE_NOT_FOUND");
  }

  const snapshot: TipPaymentEligibilitySnapshot = {
    employeeId: emp.id,
    businessId: emp.businessId,
    employeeIsActive: emp.isActive,
    activationStatus: emp.activationStatus,
    emailVerified: emp.user?.emailVerified === true,
    userIsActive: emp.user?.isActive !== false,
    businessVerificationStatus: kycStatusToLegacyMirror(emp.business.kycVerificationStatus),
  };

  if (emp.businessId !== trimmedBusinessId) {
    throw new TipPaymentEligibilityError(EMPLOYEE_UNAVAILABLE_MSG, "EMPLOYEE_BUSINESS_MISMATCH");
  }

  if (emp.isDeleted) {
    throw new TipPaymentEligibilityError(EMPLOYEE_UNAVAILABLE_MSG, "EMPLOYEE_DELETED");
  }

  if (!emp.isActive) {
    throw new TipPaymentEligibilityError(EMPLOYEE_UNAVAILABLE_MSG, "EMPLOYEE_INACTIVE");
  }

  if (emp.activationStatus !== "active") {
    throw new TipPaymentEligibilityError(EMPLOYEE_UNAVAILABLE_MSG, "EMPLOYEE_NOT_ACTIVATED");
  }

  if (!emp.user || emp.user.emailVerified !== true) {
    throw new TipPaymentEligibilityError(EMPLOYEE_UNAVAILABLE_MSG, "EMPLOYEE_EMAIL_UNVERIFIED");
  }

  if (emp.user.isActive === false) {
    throw new TipPaymentEligibilityError(EMPLOYEE_UNAVAILABLE_MSG, "EMPLOYEE_USER_INACTIVE");
  }

  if (emp.business.deletedAt) {
    throw new TipPaymentEligibilityError(EMPLOYEE_UNAVAILABLE_MSG, "BUSINESS_SOFT_CLOSED");
  }

  if (emp.business.operationalStatus !== "active") {
    throw new TipPaymentEligibilityError(EMPLOYEE_UNAVAILABLE_MSG, "BUSINESS_NOT_OPERATIONAL");
  }

  if (
    !hasBusinessVerificationCapability(
      kycStatusToLegacyMirror(emp.business.kycVerificationStatus),
      "receiveTips",
      {
        onboardingVerificationStatus: emp.business.onboardingVerificationStatus,
      },
    )
  ) {
    throw new TipPaymentEligibilityError(GO_LIVE_REQUIRED_MESSAGE, GO_LIVE_REQUIRED_CODE);
  }

  return snapshot;
}

export function logTipPaymentEligibilityBlocked(
  context: string,
  details: Record<string, unknown>,
  err: unknown,
): void {
  const code = err instanceof TipPaymentEligibilityError ? err.code : "UNKNOWN";
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[tip.payment.eligibility_blocked] ${context}`, {
    ...details,
    code,
    message,
  });
}
