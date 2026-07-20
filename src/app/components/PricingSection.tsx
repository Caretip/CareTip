import type { ComponentType } from "react";
import { useMemo } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import type { BillingCycle, Industry } from "../data/pricingTypes";
import type { PricingCopyScope } from "../data/pricingCopy";
import { pricingPageUi } from "@/components/pricing/pricingPageUi";
import { usePublicMountProbe } from "@/lib/publicMountProbe";
import { PricingTierCard } from "@/components/pricing/PricingTierCard";
import { buildPricingTierCatalog } from "../data/pricingPlanCatalog";
import {
  buildAuthPathForCheckoutIntent,
  buildCheckoutIntent,
} from "../lib/checkoutIntent";

interface PricingSectionProps {
  billingCycle: BillingCycle;
  industry: Industry;
  copyScope?: PricingCopyScope;
}

function tierSignupHref(
  tierKey: "starter" | "business" | "enterprise" | undefined,
  billingCycle: BillingCycle,
  trial = false,
): string {
  if (tierKey === "enterprise") return "/contact?intent=demo&plan=enterprise";
  if (!tierKey) return "/contact?intent=demo";
  if (tierKey === "starter") return "/signup";
  return buildAuthPathForCheckoutIntent(
    buildCheckoutIntent({ marketingPlan: tierKey, billingCycle, trial }),
    "signup",
  );
}

/**
 * Hospitality SaaS plans — monthly/yearly prices reflect the billing cycle toggle.
 */
export function PricingSection({
  billingCycle,
  industry,
  copyScope = "staticPages.pricing.audience.general",
}: PricingSectionProps) {
  usePublicMountProbe("PricingSection");
  const { t } = useTranslation();
  const tiers = useMemo(() => buildPricingTierCatalog(t), [t]);

  return (
    <div
      id="pricing-plans-panel"
      role="tabpanel"
      aria-labelledby={`pricing-billing-${billingCycle}`}
      className="caretip-pricing-tiers"
      data-billing-cycle={billingCycle}
      data-industry={industry}
      data-copy-scope={copyScope}
    >
      <div className="caretip-pricing-tiers__grid">
        {tiers.map((tier) => {
          const isEnterprise = tier.tierKey === "enterprise";
          const isPro = tier.tierKey === "business";

          const footer = isPro ? (
            <Link
              to={tierSignupHref("business", billingCycle, true)}
              className={cn(pricingPageUi.cardCtaPrimary, "w-full text-center")}
            >
              {t("staticPages.pricing.tiers.business.subscribeButton")}
            </Link>
          ) : (
            <Link
              to={tierSignupHref(tier.tierKey, billingCycle)}
              className={cn(
                isEnterprise
                  ? pricingPageUi.cardCtaEnterprise
                  : tier.isPopular
                    ? pricingPageUi.cardCtaPrimary
                    : pricingPageUi.cardCtaSecondary,
              )}
            >
              {tier.buttonText}
            </Link>
          );

          return (
            <PricingTierCard
              key={tier.tierKey}
              tier={tier}
              billingCycle={billingCycle}
              copyScope={copyScope}
              deferFeatureSkeleton
              footer={footer}
            />
          );
        })}
      </div>
    </div>
  );
}

/** @deprecated Use PricingTierViewModel from pricingPlanCatalog — kept for legacy imports. */
export type TippingTier = {
  tierKey?: import("../data/pricingConfig").PricingTierKey;
  name: string;
  tagline?: string;
  feeLine: string;
  feeNote: string;
  features: string[];
  description: string;
  buttonText: string;
  isPopular: boolean;
  icon: ComponentType<{ className?: string }>;
};
