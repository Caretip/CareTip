/**
 * Employee Instant Payouts against the employee Stripe Connect account.
 *
 * Amount and destination are Stripe-authoritative. CareTip does not subtract a second 2.5%.
 * The employee-facing 2.5% Instant total is Stripe Platform Pricing / net_available, not a
 * homemade Instant application-fee parameter (that parameter is not used).
 * Instant is not a CareTip → bank payout and is not a CareTip SCT.
 */
import { StripeConnectInstantPayoutRequestStatus } from "@prisma/client";
import { EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS } from "../config/employeeInstantPayout.js";
import { prisma } from "../prisma.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import { StripeConnectError } from "./stripeConnect.service.js";
import {
  CARETIP_INSTANT_PAYOUT_TARGET_TOTAL_FEE_BPS,
  createInstantPayoutOnConnectedAccount,
  evaluateInstantPayoutForStripeAccount,
  instantPayoutMaxCents,
  mapInstantPayoutCreateError,
  normalizeInstantPayoutIdempotencyKey,
  stripeInstantPayoutMinCents,
  toPublicInstantEligibility,
  type InstantPayoutEligibilityDto,
  type InstantPayoutReason,
} from "./stripeConnectInstantPayout.service.js";
import { resolveActiveEmployeeForConnect } from "./employeeStripeConnect.service.js";

export type EmployeeInstantPayoutEligibilityDto = InstantPayoutEligibilityDto & {
  minPayoutCents: number;
  stakeholderMinCents: number;
  stripeMinCents: number;
  feeSource: "stripe_platform_pricing" | "unknown";
};

export type EmployeeInstantPayoutDto = {
  requestId: string;
  amountCents: number;
  currency: string;
  status: "pending" | "submitted" | "failed";
  method: "instant";
};

function withEmployeeMin(pub: InstantPayoutEligibilityDto, currency: string | null): EmployeeInstantPayoutEligibilityDto {
  const stripeMin = stripeInstantPayoutMinCents(currency ?? "eur");
  const minPayoutCents = Math.max(stripeMin, EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS);
  return {
    ...pub,
    minPayoutCents,
    stakeholderMinCents: EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS,
    stripeMinCents: stripeMin,
    feeSource: pub.feeConfigured ? "stripe_platform_pricing" : "unknown",
    targetTotalFeeBps: CARETIP_INSTANT_PAYOUT_TARGET_TOTAL_FEE_BPS,
  };
}

function emptyEmployeeEligibility(reason: InstantPayoutReason): EmployeeInstantPayoutEligibilityDto {
  return withEmployeeMin(
    {
      connected: false,
      eligible: false,
      reason,
      payoutsEnabled: false,
      currency: null,
      instantAvailableGrossCents: 0,
      instantAvailableNetCents: 0,
      availableCents: 0,
      pendingCents: 0,
      platformFeeCents: 0,
      feeConfigured: false,
      targetTotalFeeBps: CARETIP_INSTANT_PAYOUT_TARGET_TOTAL_FEE_BPS,
      displayedFeeBps: null,
      destinationLast4: null,
      destinationKind: null,
      canOpenExpressDashboard: false,
    },
    "eur",
  );
}

async function loadEmployeeStripeAccount(employeeId: string) {
  return prisma.employeeStripeAccount.findUnique({
    where: { employeeId },
    select: {
      stripeAccountId: true,
      stripePayoutsEnabled: true,
    },
  });
}

export async function getEmployeeInstantPayoutEligibilityForUser(
  userId: string,
): Promise<EmployeeInstantPayoutEligibilityDto> {
  const actor = await resolveActiveEmployeeForConnect(userId);
  const account = await loadEmployeeStripeAccount(actor.employeeId);
  if (!account?.stripeAccountId?.startsWith("acct_")) {
    return emptyEmployeeEligibility("not_connected");
  }

  const snap = await evaluateInstantPayoutForStripeAccount({
    stripeAccountId: account.stripeAccountId,
    payoutsEnabledFallback: account.stripePayoutsEnabled,
    minNetCents: EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS,
    logContext: { employeeId: actor.employeeId },
  });
  return withEmployeeMin(toPublicInstantEligibility(snap), snap.currency);
}

function toDto(row: {
  id: string;
  amountCents: number;
  currency: string;
  status: StripeConnectInstantPayoutRequestStatus;
}): EmployeeInstantPayoutDto {
  return {
    requestId: row.id,
    amountCents: row.amountCents,
    currency: row.currency,
    status:
      row.status === StripeConnectInstantPayoutRequestStatus.submitted
        ? "submitted"
        : row.status === StripeConnectInstantPayoutRequestStatus.failed
          ? "failed"
          : "pending",
    method: "instant",
  };
}

export async function createEmployeeInstantPayoutForUser(args: {
  userId: string;
  idempotencyKey: unknown;
}): Promise<{ payout: EmployeeInstantPayoutDto; eligibility: EmployeeInstantPayoutEligibilityDto }> {
  const actor = await resolveActiveEmployeeForConnect(args.userId);
  const idempotencyKey = normalizeInstantPayoutIdempotencyKey(args.idempotencyKey);
  const ledgerKey = `caretip_employee_instant_payout:${actor.employeeId}:${idempotencyKey}`;

  return runSerializedByKey(`employee-instant-payout:${actor.employeeId}`, async () => {
    const existing = await prisma.employeeInstantPayoutRequest.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (existing?.status === StripeConnectInstantPayoutRequestStatus.submitted) {
      const eligibility = await getEmployeeInstantPayoutEligibilityForUser(args.userId);
      return { payout: toDto(existing), eligibility };
    }

    const account = await loadEmployeeStripeAccount(actor.employeeId);
    if (!account?.stripeAccountId?.startsWith("acct_")) {
      throw new StripeConnectError(
        "Instant Payout is not available for this account.",
        "INSTANT_PAYOUT_NOT_CONNECTED",
        400,
      );
    }

    const snap = await evaluateInstantPayoutForStripeAccount({
      stripeAccountId: account.stripeAccountId,
      payoutsEnabledFallback: account.stripePayoutsEnabled,
      minNetCents: EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS,
      logContext: { employeeId: actor.employeeId },
    });
    const eligibility = withEmployeeMin(toPublicInstantEligibility(snap), snap.currency);

    if (!snap.eligible || !snap.destinationId || !snap.currency) {
      throw new StripeConnectError(
        snap.reason === "no_instant_destination"
          ? "Add an Instant-eligible payout method in Stripe before requesting an Instant Payout."
          : snap.reason === "zero_balance" || snap.reason === "below_minimum"
            ? snap.reason === "below_minimum"
              ? "Instant payout is available from €30."
              : "There is no Instant Payout balance available right now."
            : "Instant Payout is not available for this account.",
        `INSTANT_PAYOUT_${snap.reason.toUpperCase()}`,
        400,
      );
    }

    const amountCents = snap.instantAvailableNetCents;
    if (amountCents < EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS) {
      throw new StripeConnectError(
        "Instant payout is available from €30.",
        "INSTANT_PAYOUT_BELOW_MINIMUM",
        400,
      );
    }
    const max = instantPayoutMaxCents(snap.currency);
    if (amountCents > max) {
      throw new StripeConnectError(
        "This Instant Payout exceeds Stripe’s maximum for this currency.",
        "INSTANT_PAYOUT_ABOVE_MAXIMUM",
        400,
      );
    }

    const request = existing
      ? existing
      : await prisma.employeeInstantPayoutRequest.create({
          data: {
            employeeId: actor.employeeId,
            idempotencyKey: ledgerKey,
            amountCents,
            currency: snap.currency,
            status: StripeConnectInstantPayoutRequestStatus.pending,
          },
        });

    if (request.status === StripeConnectInstantPayoutRequestStatus.submitted) {
      return { payout: toDto(request), eligibility };
    }

    try {
      const stripePayout = await createInstantPayoutOnConnectedAccount({
        stripeAccountId: snap.stripeAccountId,
        amountCents,
        currency: snap.currency,
        destination: snap.destinationId,
        idempotencyKey: ledgerKey,
      });
      const updated = await prisma.employeeInstantPayoutRequest.update({
        where: { id: request.id },
        data: {
          status: StripeConnectInstantPayoutRequestStatus.submitted,
          stripePayoutId: stripePayout.id,
          amountCents,
          currency: snap.currency,
        },
      });
      const nextEligibility = await getEmployeeInstantPayoutEligibilityForUser(args.userId);
      return { payout: toDto(updated), eligibility: nextEligibility };
    } catch (err) {
      await prisma.employeeInstantPayoutRequest.update({
        where: { id: request.id },
        data: {
          status: StripeConnectInstantPayoutRequestStatus.failed,
          failureCode: "stripe_create_failed",
        },
      });
      throw mapInstantPayoutCreateError(err);
    }
  });
}
