import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_PRICING_UI_STATE,
  YEARLY_BILLING_ENABLED,
} from "../data/pricingTypes";
import type { BillingCycle } from "../data/pricingTypes";
import {
  DEFAULT_PRICING_AUDIENCE,
  resolveCopyScopeForAudience,
  resolveIndustryForAudience,
} from "../data/pricingAudience";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { publicPagesBrandUi } from "@/components/public/publicPagesBrandUi";
import { PricingControlsPanel } from "@/components/pricing/PricingControlsPanel";
import { PricingHero } from "@/components/pricing/PricingHero";
import { PricingCardsHotels } from "@/components/pricing/PricingCardsHotels";
import { PricingYearlyNotice } from "@/components/pricing/PricingYearlyNotice";
import { PricingTrialCta } from "@/components/pricing/PricingTrialCta";
import { usePublicMountProbe } from "@/lib/publicMountProbe";

export function PricingPage() {
  usePublicMountProbe("PricingPage");
  const { t } = useTranslation();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(DEFAULT_PRICING_UI_STATE.billingCycle);

  const copyScope = resolveCopyScopeForAudience(DEFAULT_PRICING_AUDIENCE);
  const industry = resolveIndustryForAudience(DEFAULT_PRICING_AUDIENCE);
  const showYearlyNotice = billingCycle === "yearly" && !YEARLY_BILLING_ENABLED;

  return (
    <PublicPageShell maxWidth="full" contentClassName="pb-0" className="bg-background">
      <main
        id="pricing"
        className="caretip-pricing-page caretip-pricing-page--wise scroll-mt-20"
        aria-label={t("staticPages.pricing.pageTitle")}
      >
        <PricingHero copyScope={copyScope} />

        <section
          id="pricing-plans"
          className="caretip-pricing-plans-wise"
          aria-label={t("staticPages.pricing.plansAria")}
        >
          <div className="caretip-pricing-page__inner caretip-pricing-page__inner--plans caretip-pricing-plans-wise__inner">
            <div className="caretip-pricing-controls-shell">
              <PricingControlsPanel
                billingCycle={billingCycle}
                onBillingCycleChange={setBillingCycle}
              />
              {showYearlyNotice ? <PricingYearlyNotice className="mt-3" /> : null}
            </div>

            <div className="caretip-pricing-cards-stage">
              <div className="caretip-pricing-cards-stage__glow" aria-hidden />
              <div className="caretip-pricing-cards-swap">
                <PricingCardsHotels
                  billingCycle={billingCycle}
                  industry={industry}
                  copyScope={copyScope}
                />
              </div>
            </div>

            <PricingTrialCta className="mx-auto max-w-3xl" billingCycle={billingCycle} />
          </div>
        </section>

        <section className="caretip-pricing-cta-wise" aria-labelledby="pricing-cta-title">
          <div className="caretip-pricing-cta-wise__inner">
            <h2 id="pricing-cta-title" className="caretip-pricing-cta-wise__title">
              {t("staticPages.pricing.ctaTitle")}
            </h2>
            <p className="caretip-pricing-cta-wise__body">{t("staticPages.pricing.ctaBody")}</p>
            <div className="caretip-pricing-cta-wise__actions">
              <Link to="/contact?intent=demo" className={publicPagesBrandUi.ctaButtonPrimary}>
                {t("nav.requestDemo")}
              </Link>
              <Link to="/signup" className={publicPagesBrandUi.ctaButtonSecondary}>
                {t("nav.becomePartner")}
              </Link>
            </div>
          </div>
        </section>
      </main>
    </PublicPageShell>
  );
}
