/**
 * Phase 2 — server-side Connect destination resolution for guest tip Checkout.
 *
 * Destination MUST come from Business.stripeAccountId after CareTip readiness checks.
 * Never from request body, query, headers, QR, or client metadata.
 */
import type Stripe from "stripe";
import { StripeConnectStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { TipPaymentEligibilityError } from "./tipPaymentEligibility.service.js";

/** Guest-safe — never include acct ids, requirements, or internal Connect status. */
export const CONNECT_TIP_UNAVAILABLE_MSG = "This venue cannot accept tips right now.";
export const CONNECT_NOT_READY_CODE = "CONNECT_NOT_READY" as const;
export const CONNECT_DESTINATION_MISMATCH_CODE = "CONNECT_DESTINATION_MISMATCH" as const;
export const CONNECT_PAYMENT_INVARIANT_CODE = "CONNECT_PAYMENT_INVARIANT" as const;
export const CONNECT_LIVE_ACCOUNT_NOT_CAPABLE_CODE = "CONNECT_LIVE_ACCOUNT_NOT_CAPABLE" as const;

function logConnectTipBlocked(reason: string, businessId: string): void {
  console.warn("[stripe.connect.tip_destination_blocked]", {
    businessId,
    reason,
  });
}

/**
 * Fail-closed Connect readiness for destination charges.
 *
 * Checkout creation uses the Phase 1.6 CareTip **mirror** (no live Stripe retrieve)
 * so guest session create stays fast and does not depend on Stripe availability.
 *
 * Successful Checkout webhooks additionally retrieve the live connected account
 * (see stripe.service handleSuccessfulTipPayment) before ledger credit.
 *
 * `ready` already requires charges_enabled AND payouts_enabled. Both flags are
 * re-checked here. That is a payment-acceptance gate, not payout processing.
 */
export async function assertBusinessReadyForConnectTipDestination(
  businessId: string,
): Promise<{ stripeAccountId: string }> {
  const trimmed = businessId?.trim() ?? "";
  if (!trimmed) {
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_NOT_READY_CODE);
  }

  const business = await prisma.business.findUnique({
    where: { id: trimmed },
    select: {
      id: true,
      deletedAt: true,
      legalHold: true,
      operationalStatus: true,
      stripeAccountId: true,
      stripeConnectStatus: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });

  if (!business) {
    logConnectTipBlocked("BUSINESS_NOT_FOUND", trimmed);
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_NOT_READY_CODE);
  }

  if (business.deletedAt) {
    logConnectTipBlocked("BUSINESS_SOFT_CLOSED", business.id);
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_NOT_READY_CODE);
  }

  if (business.legalHold) {
    logConnectTipBlocked("BUSINESS_LEGAL_HOLD", business.id);
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_NOT_READY_CODE);
  }

  if (business.operationalStatus !== "active") {
    logConnectTipBlocked("BUSINESS_NOT_OPERATIONAL", business.id);
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_NOT_READY_CODE);
  }

  const accountId = business.stripeAccountId?.trim() ?? "";
  if (!accountId) {
    logConnectTipBlocked("NOT_CONNECTED", business.id);
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_NOT_READY_CODE);
  }

  if (!accountId.startsWith("acct_")) {
    logConnectTipBlocked("INVALID_ACCOUNT_ID_SHAPE", business.id);
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_NOT_READY_CODE);
  }

  if (business.stripeConnectStatus !== StripeConnectStatus.ready) {
    logConnectTipBlocked(`STATUS_${business.stripeConnectStatus}`, business.id);
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_NOT_READY_CODE);
  }

  if (business.stripeChargesEnabled !== true) {
    logConnectTipBlocked("CHARGES_DISABLED", business.id);
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_NOT_READY_CODE);
  }

  if (business.stripePayoutsEnabled !== true) {
    logConnectTipBlocked("PAYOUTS_DISABLED", business.id);
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_NOT_READY_CODE);
  }

  return { stripeAccountId: accountId };
}

/** Stripe PaymentIntent destination — never from metadata. */
export function destinationAccountIdFromPaymentIntent(
  paymentIntent: Pick<Stripe.PaymentIntent, "transfer_data">,
): string | null {
  const dest = paymentIntent.transfer_data?.destination;
  if (typeof dest === "string" && dest.startsWith("acct_")) return dest;
  if (dest && typeof dest === "object" && typeof dest.id === "string" && dest.id.startsWith("acct_")) {
    return dest.id;
  }
  return null;
}

/**
 * Fail closed unless the PaymentIntent destination is exactly the Business's stored account.
 * Does not log full account ids.
 */
export function assertPaymentIntentDestinationMatchesBusiness(params: {
  paymentIntentDestination: string | null;
  businessStripeAccountId: string;
  businessId: string;
}): void {
  const expected = params.businessStripeAccountId.trim();
  const actual = params.paymentIntentDestination?.trim() ?? "";
  if (!expected.startsWith("acct_") || !actual.startsWith("acct_") || actual !== expected) {
    console.warn("[stripe.connect.destination_mismatch]", {
      businessId: params.businessId,
      expectedSuffix: expected.length > 8 ? expected.slice(-8) : "(none)",
      actualSuffix: actual.length > 8 ? actual.slice(-8) : actual ? "(short)" : "(none)",
    });
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_DESTINATION_MISMATCH_CODE);
  }
}
