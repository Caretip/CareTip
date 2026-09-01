import { DateTime } from "luxon";
import { PHYSICAL_QR_PROCESSING_TIMEZONE } from "./processing.js";

/** Albertina package: 1–4 prints = €14.90; each print after 4 = €1.30. */
export const PHYSICAL_QR_PACKAGE_CENTS = 1490;
export const PHYSICAL_QR_PACKAGE_INCLUDED_PRINTS = 4;
export const PHYSICAL_QR_EXTRA_PRINT_CENTS = 130;
/** Pro monthly free order includes up to 8 prints. */
export const PHYSICAL_QR_PRO_FREE_INCLUDED_PRINTS = 8;

export type PhysicalQrQuote = {
  printCount: number;
  freeOrderApplied: boolean;
  includedPrints: number;
  extraPrints: number;
  extraUnitCents: number;
  packageCents: number;
  extraCents: number;
  totalCents: number;
};

export function berlinCalendarMonthStart(now = new Date(), zone = PHYSICAL_QR_PROCESSING_TIMEZONE): Date {
  return DateTime.fromJSDate(now, { zone }).startOf("month").toUTC().toJSDate();
}

export function isPhysicalQrFreeOrderUsedThisMonth(
  usedAt: Date | null | undefined,
  now = new Date(),
  zone = PHYSICAL_QR_PROCESSING_TIMEZONE,
): boolean {
  if (!usedAt) return false;
  return usedAt.getTime() >= berlinCalendarMonthStart(now, zone).getTime();
}

/**
 * Server-authoritative print-order quote.
 * Never uses catalog unit price. Never trusts the client total.
 */
export function quotePhysicalQrPrints(input: {
  printCount: number;
  printingIncludedEligible: boolean;
  freeOrderAvailable: boolean;
}): PhysicalQrQuote {
  const printCount = Math.max(0, Math.trunc(input.printCount));
  const extraUnitCents = PHYSICAL_QR_EXTRA_PRINT_CENTS;

  if (printCount <= 0) {
    return {
      printCount: 0,
      freeOrderApplied: false,
      includedPrints: 0,
      extraPrints: 0,
      extraUnitCents,
      packageCents: 0,
      extraCents: 0,
      totalCents: 0,
    };
  }

  if (input.printingIncludedEligible && input.freeOrderAvailable) {
    const extraPrints = Math.max(0, printCount - PHYSICAL_QR_PRO_FREE_INCLUDED_PRINTS);
    const extraCents = extraPrints * extraUnitCents;
    return {
      printCount,
      freeOrderApplied: true,
      includedPrints: Math.min(printCount, PHYSICAL_QR_PRO_FREE_INCLUDED_PRINTS),
      extraPrints,
      extraUnitCents,
      packageCents: 0,
      extraCents,
      totalCents: extraCents,
    };
  }

  const extraPrints = Math.max(0, printCount - PHYSICAL_QR_PACKAGE_INCLUDED_PRINTS);
  const extraCents = extraPrints * extraUnitCents;
  return {
    printCount,
    freeOrderApplied: false,
    includedPrints: Math.min(printCount, PHYSICAL_QR_PACKAGE_INCLUDED_PRINTS),
    extraPrints,
    extraUnitCents,
    packageCents: PHYSICAL_QR_PACKAGE_CENTS,
    extraCents,
    totalCents: PHYSICAL_QR_PACKAGE_CENTS + extraCents,
  };
}

export function allocateQuoteAcrossQuantities(quote: PhysicalQrQuote, quantities: number[]): number[] {
  const n = quantities.length;
  if (n === 0) return [];
  const totalPrints = quantities.reduce((s, q) => s + q, 0);
  if (totalPrints <= 0 || quote.totalCents <= 0) return quantities.map(() => 0);
  const shares = quantities.map((q) => Math.floor((quote.totalCents * q) / totalPrints));
  const allocated = shares.reduce((s, v) => s + v, 0);
  shares[n - 1] += quote.totalCents - allocated;
  return shares;
}

export type PhysicalQrStoredQuote = PhysicalQrQuote & { quotaClaimedAt?: string | null };

export function parseStoredPhysicalQrQuote(raw: unknown): PhysicalQrStoredQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const printCount = Number(value.printCount);
  const totalCents = Number(value.totalCents);
  if (!Number.isInteger(printCount) || printCount < 0 || !Number.isInteger(totalCents) || totalCents < 0) {
    return null;
  }
  const extraUnitCents = Number(value.extraUnitCents);
  const extraPrints = Number(value.extraPrints);
  const includedPrints = Number(value.includedPrints);
  const packageCents = Number(value.packageCents);
  const extraCents = Number(value.extraCents);
  if (
    ![extraUnitCents, extraPrints, includedPrints, packageCents, extraCents].every((n) =>
      Number.isFinite(n),
    )
  ) {
    return null;
  }
  const quotaClaimedAt =
    typeof value.quotaClaimedAt === "string" && value.quotaClaimedAt.trim()
      ? value.quotaClaimedAt
      : null;
  return {
    printCount,
    freeOrderApplied: value.freeOrderApplied === true,
    includedPrints: Math.trunc(includedPrints),
    extraPrints: Math.trunc(extraPrints),
    extraUnitCents: Math.trunc(extraUnitCents),
    packageCents: Math.trunc(packageCents),
    extraCents: Math.trunc(extraCents),
    totalCents,
    quotaClaimedAt,
  };
}

/** Valid claim timestamp from this order's snapshot, or null. */
export function parsePhysicalQrQuotaClaimedAt(storedQuote: unknown): Date | null {
  const stored = parseStoredPhysicalQrQuote(storedQuote);
  if (!stored?.quotaClaimedAt) return null;
  const claimedAt = new Date(stored.quotaClaimedAt);
  return Number.isNaN(claimedAt.getTime()) ? null : claimedAt;
}

/**
 * This order already consumed the monthly free allowance (not merely eligible).
 * Requires both the consumed flag and a claim timestamp on this order's snapshot.
 */
export function orderHasConsumedMonthlyFreeQuota(input: {
  monthlyFreeQuotaApplied: boolean;
  storedQuote: unknown;
}): { consumed: boolean; quotaClaimedAt: Date | null } {
  const quotaClaimedAt = parsePhysicalQrQuotaClaimedAt(input.storedQuote);
  if (!input.monthlyFreeQuotaApplied || !quotaClaimedAt) {
    return { consumed: false, quotaClaimedAt: null };
  }
  return { consumed: true, quotaClaimedAt };
}

/**
 * Checkout quote. Reuse the stored free quote only when THIS PENDING order
 * already consumed the monthly quota (flag + quotaClaimedAt). A create-time
 * freeOrderApplied preview is eligibility, not consumption.
 * Does not trust a client-supplied total.
 */
export function resolvePhysicalQrCheckoutQuote(input: {
  printCount: number;
  printingIncludedEligible: boolean;
  freeOrderAvailable: boolean;
  orderMonthlyFreeQuotaApplied: boolean;
  storedQuote: unknown;
}): { quote: PhysicalQrQuote; reuseStoredFreeQuote: boolean; quotaClaimedAt: Date | null } {
  const expectedFree = quotePhysicalQrPrints({
    printCount: input.printCount,
    printingIncludedEligible: true,
    freeOrderAvailable: true,
  });
  const stored = parseStoredPhysicalQrQuote(input.storedQuote);
  const consumed = orderHasConsumedMonthlyFreeQuota({
    monthlyFreeQuotaApplied: input.orderMonthlyFreeQuotaApplied,
    storedQuote: input.storedQuote,
  });

  const storedPrintsMatch = !stored || stored.printCount === input.printCount;
  const storedTotalMatches = !stored || stored.totalCents === expectedFree.totalCents;
  if (
    consumed.consumed &&
    consumed.quotaClaimedAt &&
    expectedFree.freeOrderApplied &&
    storedPrintsMatch &&
    storedTotalMatches &&
    (!stored || stored.freeOrderApplied)
  ) {
    return {
      quote: expectedFree,
      reuseStoredFreeQuote: true,
      quotaClaimedAt: consumed.quotaClaimedAt,
    };
  }

  const quote = quotePhysicalQrPrints({
    printCount: input.printCount,
    printingIncludedEligible: input.printingIncludedEligible,
    freeOrderAvailable: input.freeOrderAvailable,
  });
  return { quote, reuseStoredFreeQuote: false, quotaClaimedAt: null };
}

export function shouldReleasePhysicalQrQuotaOnExpire(input: {
  sessionId: string;
  orderSessionId: string | null | undefined;
  paymentStatus: string;
  monthlyFreeQuotaApplied: boolean;
  quotaClaimedAt: Date | null;
  paidFreeOrderThisMonth: boolean;
}): boolean {
  if (!input.sessionId || !input.orderSessionId) return false;
  if (input.sessionId !== input.orderSessionId) return false;
  if (input.paymentStatus !== "PENDING") return false;
  if (!input.monthlyFreeQuotaApplied) return false;
  if (!input.quotaClaimedAt) return false;
  if (input.paidFreeOrderThisMonth) return false;
  return true;
}
