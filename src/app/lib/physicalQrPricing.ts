/** Mirrors backend `physicalQrPricing.service.ts` for display only. Server quote is authoritative. */

export const PHYSICAL_QR_PACKAGE_CENTS = 1490;
export const PHYSICAL_QR_PACKAGE_INCLUDED_PRINTS = 4;
export const PHYSICAL_QR_EXTRA_PRINT_CENTS = 130;
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

export const PHYSICAL_QR_LOCATION_FILTER_ALL = "__all__";
