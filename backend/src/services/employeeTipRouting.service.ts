/**
 * Server-only guest-tip Connect routing.
 * Destination and fee never come from the client or Checkout metadata.
 */
import type Stripe from "stripe";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayoutMode,
  StripeConnectStatus,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import { calculateTipPlatformFeeCents } from "../config/fees.js";
import { attributeStripeConnectAccount } from "./connectAccountOwnership.service.js";
import {
  assertBusinessReadyForConnectTipDestination,
  assertPaymentIntentDestinationMatchesBusiness,
  CONNECT_DESTINATION_MISMATCH_CODE,
  CONNECT_PAYMENT_INVARIANT_CODE,
  CONNECT_TIP_UNAVAILABLE_MSG,
  destinationAccountIdFromPaymentIntent,
} from "./connectTipDestination.service.js";
import { assertEmployeeEligibleForTipPayment, TipPaymentEligibilityError } from "./tipPaymentEligibility.service.js";

export type TipCheckoutRouting =
  | {
      chargeModel: typeof EmployeeTipChargeModel.destination_employee;
      routingMode: typeof EmployeeTipPayoutMode.direct_to_employee;
      destinationAccountId: string;
      applyApplicationFee: true;
    }
  | {
      chargeModel: typeof EmployeeTipChargeModel.destination_business;
      routingMode: typeof EmployeeTipPayoutMode.business_distribution;
      destinationAccountId: string;
      applyApplicationFee: true;
    }
  | {
      chargeModel: typeof EmployeeTipChargeModel.platform_hold;
      routingMode: typeof EmployeeTipPayoutMode.direct_to_employee;
      destinationAccountId: null;
      applyApplicationFee: false;
    }
  | {
      chargeModel: typeof EmployeeTipChargeModel.platform_hold;
      routingMode: typeof EmployeeTipPayoutMode.business_distribution;
      destinationAccountId: null;
      applyApplicationFee: false;
    };

export type PaidTipConnectSnapshot = {
  chargeModel: EmployeeTipChargeModel;
  routingMode: EmployeeTipPayoutMode;
  destinationAccountId: string | null;
};

/** Frozen at Checkout via server-set PaymentIntent metadata — never from the client body. */
export function routingModeFromStripeMetadata(
  metadata: Stripe.Metadata | null | undefined,
): EmployeeTipPayoutMode {
  const raw = typeof metadata?.caretipRoutingMode === "string" ? metadata.caretipRoutingMode.trim() : "";
  if (raw === EmployeeTipPayoutMode.business_distribution) {
    return EmployeeTipPayoutMode.business_distribution;
  }
  return EmployeeTipPayoutMode.direct_to_employee;
}

export function isEmployeeRecipientReady(row: {
  stripeAccountId: string | null;
  stripeConnectStatus: StripeConnectStatus;
  stripePayoutsEnabled: boolean;
}): boolean {
  const acct = row.stripeAccountId?.trim() ?? "";
  return (
    acct.startsWith("acct_") &&
    row.stripeConnectStatus === StripeConnectStatus.ready &&
    row.stripePayoutsEnabled === true
  );
}

export async function resolveTipCheckoutRouting(
  businessId: string,
  employeeId: string,
): Promise<TipCheckoutRouting> {
  const { stripeAccountId: businessStripeAccountId } =
    await assertBusinessReadyForConnectTipDestination(businessId);

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { employeeTipPayoutMode: true },
  });
  const mode = business?.employeeTipPayoutMode ?? EmployeeTipPayoutMode.direct_to_employee;

  if (mode === EmployeeTipPayoutMode.business_distribution) {
    // BUSINESS_RECEIVES: destination-charge the Business Express account.
    // Employee Stripe status never selects destination and never blocks Checkout.
    return {
      chargeModel: EmployeeTipChargeModel.destination_business,
      routingMode: EmployeeTipPayoutMode.business_distribution,
      destinationAccountId: businessStripeAccountId,
      applyApplicationFee: true,
    };
  }

  const employeeAccount = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId },
    select: {
      stripeAccountId: true,
      stripeConnectStatus: true,
      stripePayoutsEnabled: true,
    },
  });

  if (employeeAccount && isEmployeeRecipientReady(employeeAccount)) {
    return {
      chargeModel: EmployeeTipChargeModel.destination_employee,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      destinationAccountId: employeeAccount.stripeAccountId.trim(),
      applyApplicationFee: true,
    };
  }

  return {
    chargeModel: EmployeeTipChargeModel.platform_hold,
    routingMode: EmployeeTipPayoutMode.direct_to_employee,
    destinationAccountId: null,
    applyApplicationFee: false,
  };
}

export function stripeChargeIdFromPaymentIntent(paymentIntent: Stripe.PaymentIntent): string | null {
  const latest = paymentIntent.latest_charge;
  if (typeof latest === "string" && latest.startsWith("ch_")) return latest;
  if (latest && typeof latest === "object" && typeof latest.id === "string" && latest.id.startsWith("ch_")) {
    return latest.id;
  }
  return null;
}

export function destinationTransferIdFromPaymentIntent(paymentIntent: Stripe.PaymentIntent): string | null {
  const transfer = (paymentIntent as Stripe.PaymentIntent & { transfer?: string | Stripe.Transfer | null })
    .transfer;
  if (typeof transfer === "string" && transfer.startsWith("tr_")) return transfer;
  if (transfer && typeof transfer === "object" && typeof transfer.id === "string" && transfer.id.startsWith("tr_")) {
    return transfer.id;
  }
  return null;
}

export function assertLiveRecipientAccountCapable(
  account: {
    id: string;
    payouts_enabled?: boolean | null;
    requirements?: { disabled_reason?: string | null } | null;
  },
  expectedAccountId: string,
): void {
  if (account.id !== expectedAccountId) {
    console.warn("[stripe.connect.live_recipient]", {
      reason: "ACCOUNT_ID_MISMATCH",
      expectedSuffix: expectedAccountId.slice(-8),
      actualSuffix: account.id.slice(-8),
    });
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_DESTINATION_MISMATCH_CODE);
  }
  if (account.payouts_enabled !== true) {
    console.warn("[stripe.connect.live_recipient]", { reason: "PAYOUTS_DISABLED" });
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_DESTINATION_MISMATCH_CODE);
  }
  if (account.requirements?.disabled_reason) {
    console.warn("[stripe.connect.live_recipient]", { reason: "DISABLED" });
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_DESTINATION_MISMATCH_CODE);
  }
}

/**
 * Validate a captured PaymentIntent against Stripe objects + DB ownership.
 * Does not use the current Business routing setting (already frozen on the PI).
 */
export async function assertPaidTipConnectInvariants(params: {
  paymentIntent: Stripe.PaymentIntent;
  employeeId: string;
  businessId: string;
  retrieveMerchantAccount: (stripeAccountId: string) => Promise<{
    id: string;
    charges_enabled?: boolean | null;
    payouts_enabled?: boolean | null;
    requirements?: { disabled_reason?: string | null } | null;
  }>;
  retrieveRecipientAccount: (stripeAccountId: string) => Promise<{
    id: string;
    payouts_enabled?: boolean | null;
    requirements?: { disabled_reason?: string | null } | null;
  }>;
  assertMerchantCapable: (
    account: {
      id: string;
      charges_enabled?: boolean | null;
      payouts_enabled?: boolean | null;
      requirements?: { disabled_reason?: string | null } | null;
    },
    expectedAccountId: string,
  ) => void;
}): Promise<PaidTipConnectSnapshot> {
  const { paymentIntent, employeeId, businessId } = params;
  await assertEmployeeEligibleForTipPayment(employeeId, businessId);
  const { stripeAccountId: businessAccountId } =
    await assertBusinessReadyForConnectTipDestination(businessId);

  const dest = destinationAccountIdFromPaymentIntent(paymentIntent);
  const piCents = paymentIntent.amount_received ?? paymentIntent.amount;
  const expectedFee = calculateTipPlatformFeeCents(piCents);

  if (!dest) {
    if (paymentIntent.application_fee_amount != null && paymentIntent.application_fee_amount !== 0) {
      throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_PAYMENT_INVARIANT_CODE);
    }
    return {
      chargeModel: EmployeeTipChargeModel.platform_hold,
      routingMode: routingModeFromStripeMetadata(paymentIntent.metadata),
      destinationAccountId: null,
    };
  }

  if (paymentIntent.application_fee_amount !== expectedFee) {
    console.warn("[stripe.connect.fee_mismatch]", {
      businessId,
      expectedFee,
      actualFee: paymentIntent.application_fee_amount ?? null,
    });
    throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_PAYMENT_INVARIANT_CODE);
  }

  const attribution = await attributeStripeConnectAccount(dest);
  if (attribution.kind === "employee") {
    if (attribution.employeeId !== employeeId) {
      throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_DESTINATION_MISMATCH_CODE);
    }
    const live = await params.retrieveRecipientAccount(dest);
    assertLiveRecipientAccountCapable(live, dest);
    return {
      chargeModel: EmployeeTipChargeModel.destination_employee,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      destinationAccountId: dest,
    };
  }

  if (attribution.kind === "business") {
    if (attribution.businessId !== businessId) {
      throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_DESTINATION_MISMATCH_CODE);
    }
    assertPaymentIntentDestinationMatchesBusiness({
      paymentIntentDestination: dest,
      businessStripeAccountId: businessAccountId,
      businessId,
    });
    const live = await params.retrieveMerchantAccount(dest);
    params.assertMerchantCapable(live, dest);
    return {
      chargeModel: EmployeeTipChargeModel.destination_business,
      routingMode: EmployeeTipPayoutMode.business_distribution,
      destinationAccountId: dest,
    };
  }

  throw new TipPaymentEligibilityError(CONNECT_TIP_UNAVAILABLE_MSG, CONNECT_DESTINATION_MISMATCH_CODE);
}
