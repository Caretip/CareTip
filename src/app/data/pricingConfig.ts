import type { TFunction } from "i18next";
import { Store, Building2, Crown } from "lucide-react";
import type { ComponentType } from "react";
import { PRO_NET_MONTHLY_DISPLAY_EN } from "@/app/data/proSubscriptionNetPricing";

export type PricingTierKey = "starter" | "business" | "enterprise";

/** Fee amounts only — all marketing copy lives in i18n `staticPages.pricing.tiers.*`. */
export type PricingTierDefinition = {
  tierKey: PricingTierKey;
  feeLine: string;
  icon: ComponentType<{ className?: string }>;
  isPopular: boolean;
};

export const PRICING_TIER_DEFINITIONS: readonly PricingTierDefinition[] = [
  {
    tierKey: "starter",
    feeLine: "€0/month",
    icon: Store,
    isPopular: false,
  },
  {
    tierKey: "business",
    feeLine: `${PRO_NET_MONTHLY_DISPLAY_EN} / month`,
    icon: Building2,
    isPopular: true,
  },
  {
    tierKey: "enterprise",
    feeLine: "Upon Request",
    icon: Crown,
    isPopular: false,
  },
] as const;

/** Max feature slots per tier in i18n (`f0` … `f{n}`). Empty strings are omitted. */
export const PRICING_TIER_FEATURE_SLOT_COUNT = 15;

export function buildPricingTierFeatures(t: TFunction, tierKey: PricingTierKey): string[] {
  const features: string[] = [];
  for (let i = 0; i < PRICING_TIER_FEATURE_SLOT_COUNT; i++) {
    const key = `staticPages.pricing.tiers.${tierKey}.f${i}`;
    const value = t(key);
    if (value && value !== key) features.push(value);
  }
  return features;
}

export function mapPricingTierFromI18n(
  t: TFunction,
  def: PricingTierDefinition,
): {
  tierKey: PricingTierKey;
  name: string;
  tagline: string;
  feeLine: string;
  feeNote: string;
  description: string;
  features: string[];
  buttonText: string;
  isPopular: boolean;
  icon: ComponentType<{ className?: string }>;
} {
  const k = def.tierKey;
  const feeLine =
    k === "enterprise"
      ? t(`staticPages.pricing.tiers.${k}.feeMonthly`, { defaultValue: def.feeLine })
      : def.feeLine;
  return {
    tierKey: k,
    name: t(`staticPages.pricing.tiers.${k}.name`),
    tagline: t(`staticPages.pricing.tiers.${k}.tagline`),
    feeLine,
    feeNote: t(`staticPages.pricing.tiers.${k}.feeNote`),
    description: t(`staticPages.pricing.tiers.${k}.description`),
    features: buildPricingTierFeatures(t, k),
    buttonText: t(`staticPages.pricing.tiers.${k}.button`),
    isPopular: def.isPopular,
    icon: def.icon,
  };
}
