import type { TFunction } from "i18next";
import type { BillingCycle } from "@/app/data/pricingTypes";
import type { PricingCopyScope } from "@/app/data/pricingCopy";
import type { PricingTierViewModel } from "@/app/data/pricingPlanCatalog";

export function resolveTierPricing(
  tier: Pick<PricingTierViewModel, "tierKey" | "feeLine" | "feeNote">,
  billingCycle: BillingCycle,
  t: TFunction,
): { feeLine: string; feeNote: string } {
  if (!tier.tierKey) {
    return { feeLine: tier.feeLine, feeNote: tier.feeNote };
  }

  const prefix = `staticPages.pricing.tiers.${tier.tierKey}`;
  const cycleSuffix = billingCycle === "yearly" ? "Yearly" : "Monthly";
  const feeLineKey = `${prefix}.fee${cycleSuffix}`;
  const feeNoteKey = `${prefix}.feeNote${cycleSuffix}`;
  const feeLine = t(feeLineKey);
  const feeNote = t(feeNoteKey);

  return {
    feeLine: feeLine !== feeLineKey ? feeLine : tier.feeLine,
    feeNote: feeNote !== feeNoteKey ? feeNote : tier.feeNote,
  };
}

export function resolveTierDescription(
  tier: Pick<PricingTierViewModel, "tierKey" | "description">,
  t: TFunction,
  copyScope: PricingCopyScope = "staticPages.pricing.audience.general",
): string {
  if (!tier.tierKey) return tier.description;
  return t(`${copyScope}.tiers.${tier.tierKey}.description`, {
    defaultValue: tier.description,
  });
}
