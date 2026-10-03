/**
 * Display-only enrichment for Connect bank payout detail (Stripe retrieve + CareTip ledgers).
 * Does not change payout state or financial behavior.
 */
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import type { ConnectPayoutDto } from "./stripeConnectPayout.service.js";

export type ConnectPayoutInitiationKind = "caretip_scheduled" | "caretip_instant" | null;

function destinationLast4Of(payout: Stripe.Payout): string | null {
  const dest = payout.destination;
  if (!dest || typeof dest === "string") return null;
  if ("deleted" in dest && dest.deleted) return null;
  const last4 = "last4" in dest ? dest.last4 : null;
  return typeof last4 === "string" && /^\d{2,4}$/.test(last4) ? last4.slice(-4) : null;
}

export async function resolveConnectPayoutInitiationKind(args: {
  businessId: string;
  stripePayoutId: string;
}): Promise<{ initiationKind: ConnectPayoutInitiationKind; bankPayoutSchedule: string | null }> {
  const [scheduled, instant, business] = await Promise.all([
    prisma.stripeConnectScheduledPayoutRequest.findFirst({
      where: { businessId: args.businessId, stripePayoutId: args.stripePayoutId, status: "submitted" },
      select: { id: true },
    }),
    prisma.stripeConnectInstantPayoutRequest.findFirst({
      where: { businessId: args.businessId, stripePayoutId: args.stripePayoutId, status: "submitted" },
      select: { id: true },
    }),
    prisma.business.findUnique({
      where: { id: args.businessId },
      select: { bankPayoutSchedule: true },
    }),
  ]);
  if (instant) {
    return { initiationKind: "caretip_instant", bankPayoutSchedule: null };
  }
  if (scheduled) {
    return {
      initiationKind: "caretip_scheduled",
      bankPayoutSchedule: business?.bankPayoutSchedule ?? null,
    };
  }
  return { initiationKind: null, bankPayoutSchedule: business?.bankPayoutSchedule ?? null };
}

export async function enrichBusinessConnectPayoutDto(
  dto: ConnectPayoutDto,
  ctx: { businessId: string; stripeAccountId: string; stripePayoutId: string },
): Promise<ConnectPayoutDto> {
  const { initiationKind, bankPayoutSchedule } = await resolveConnectPayoutInitiationKind({
    businessId: ctx.businessId,
    stripePayoutId: ctx.stripePayoutId,
  });

  let destinationLast4: string | null = null;
  if (isStripeConfigured() && ctx.stripePayoutId.startsWith("po_")) {
    try {
      const po = await getStripeClient().payouts.retrieve(ctx.stripePayoutId, {
        expand: ["destination"],
      }, { stripeAccount: ctx.stripeAccountId });
      destinationLast4 = destinationLast4Of(po);
    } catch {
      destinationLast4 = null;
    }
  }

  return {
    ...dto,
    stripePayoutId: ctx.stripePayoutId,
    destinationLast4,
    initiationKind,
    bankPayoutSchedule,
  };
}

export async function resolveEmployeePayoutInitiationKinds(
  employeeId: string,
  stripePayoutIds: string[],
): Promise<Map<string, ConnectPayoutInitiationKind>> {
  const ids = stripePayoutIds.filter((id) => id.startsWith("po_"));
  const map = new Map<string, ConnectPayoutInitiationKind>();
  if (ids.length === 0) return map;

  const [scheduled, instant] = await Promise.all([
    prisma.employeeStripeScheduledPayoutRequest.findMany({
      where: { employeeId, stripePayoutId: { in: ids }, status: "submitted" },
      select: { stripePayoutId: true },
    }),
    prisma.employeeInstantPayoutRequest.findMany({
      where: { employeeId, stripePayoutId: { in: ids }, status: "submitted" },
      select: { stripePayoutId: true },
    }),
  ]);
  for (const row of instant) {
    if (row.stripePayoutId) map.set(row.stripePayoutId, "caretip_instant");
  }
  for (const row of scheduled) {
    if (row.stripePayoutId && !map.has(row.stripePayoutId)) {
      map.set(row.stripePayoutId, "caretip_scheduled");
    }
  }
  return map;
}
