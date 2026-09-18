import { useMemo } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { BillingCycle } from "@/app/data/pricingTypes";
import type { PricingCopyScope } from "@/app/data/pricingCopy";
import { buildSoloPricingPlanCatalog } from "@/app/data/pricingSoloPlanCatalog";
import { PricingTierCard } from "@/components/pricing/PricingTierCard";
import { pricingPageUi } from "@/components/pricing/pricingPageUi";
import { cn } from "@/lib/utils";
import { RequestDemoCta } from "@/app/components/RequestDemoCta";

type PricingCardsFreelancersProps = {
  billingCycle: BillingCycle;
  copyScope: PricingCopyScope;
};

/**
 * Midwives & freelancers — UI-only pricing (no Stripe checkout).
 * Billing cycle is accepted for layout parity; prices stay free until future plans ship.
 */
export function PricingCardsFreelancers({ billingCycle, copyScope }: PricingCardsFreelancersProps) {
  const { t } = useTranslation();
  const plans = useMemo(() => buildSoloPricingPlanCatalog(t), [t]);

  return (
    <div
      id="pricing-plans-panel"
      role="tabpanel"
      aria-labelledby={`pricing-billing-${billingCycle}`}
      className="caretip-pricing-tiers caretip-pricing-tiers--solo"
      data-billing-cycle={billingCycle}
      data-pricing-audience="midwives_freelancers"
    >
      <div className="caretip-pricing-tiers__grid">
        {plans.map((plan) => {
          const isEnterprise = plan.tierKey === "enterprise";
          const ctaClass = isEnterprise
            ? pricingPageUi.cardCtaEnterprise
            : plan.isPopular
              ? pricingPageUi.cardCtaPrimary
              : pricingPageUi.cardCtaSecondary;

          return (
            <PricingTierCard
              key={plan.planKey}
              tier={plan}
              billingCycle={billingCycle}
              copyScope={copyScope}
              displayOnly
              deferFeatureSkeleton
              className={cn(!plan.available && "caretip-pricing-tier-card--placeholder")}
              footer={
                plan.available ? (
                  <Link to="/signup" className={ctaClass}>
                    {plan.buttonText}
                  </Link>
                ) : isEnterprise ? (
                  <RequestDemoCta className={ctaClass}>{plan.buttonText}</RequestDemoCta>
                ) : (
                  <button type="button" className={cn(ctaClass, "pointer-events-none opacity-60")} disabled>
                    {plan.buttonText}
                  </button>
                )
              }
            />
          );
        })}
      </div>
      <p className="caretip-pricing-solo-footnote">{t("staticPages.pricing.soloPlans.footnote")}</p>
    </div>
  );
}
