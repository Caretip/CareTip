import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { pricingPageUi } from "@/components/pricing/pricingPageUi";
import type { PricingTierKey } from "@/app/data/pricingConfig";
import type { BillingCycle } from "@/app/data/pricingTypes";
import {
  buildAuthPathForCheckoutIntent,
  buildCheckoutIntent,
} from "@/app/lib/checkoutIntent";

type PricingTrialCtaProps = {
  className?: string;
  variant?: "inline" | "panel";
  /** Marketing tier from pricing page; defaults to business (Premium trial). */
  marketingPlan?: PricingTierKey;
  billingCycle?: BillingCycle;
};

/** Marketing CTA for the 30-day Pro trial — routes to signup with plan intent preserved. */
export function PricingTrialCta({
  className,
  variant = "panel",
  marketingPlan = "business",
  billingCycle = "monthly",
}: PricingTrialCtaProps) {
  const { t } = useTranslation();
  const trialHref = buildAuthPathForCheckoutIntent(
    buildCheckoutIntent({ marketingPlan, billingCycle, trial: true }),
    "signup",
  );

  if (variant === "inline") {
    return (
      <div className={cn("text-center", className)}>
        <Link
          to={trialHref}
          className={cn(pricingPageUi.cardCtaSecondary, "mt-3 w-full text-center")}
        >
          {t("staticPages.pricing.trialCta.button")}
        </Link>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {t("staticPages.pricing.trialCta.paymentNote")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-primary/20 bg-primary/5 px-4 py-4 text-center sm:px-6",
        className,
      )}
    >
      <p className="text-sm font-semibold text-foreground">{t("staticPages.pricing.trialCta.title")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("staticPages.pricing.trialCta.body")}</p>
      <Link to={trialHref} className={cn(pricingPageUi.ctaButtonPrimary, "mt-4 inline-flex")}>
        {t("staticPages.pricing.trialCta.button")}
      </Link>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {t("staticPages.pricing.trialCta.paymentNote")}
      </p>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {t("staticPages.pricing.trialCta.conversionNote")}
      </p>
    </div>
  );
}
