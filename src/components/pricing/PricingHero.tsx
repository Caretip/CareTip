import { Gift, Lock, Shield, Sparkles, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PricingCopyScope } from "@/app/data/pricingCopy";
import { PublicPageBackLink } from "@/components/public/PublicPageBackLink";
import { PublicPageHeroCard } from "@/components/public/PublicPageHeroCard";
import { cn } from "@/lib/utils";

const FEATURE_KEYS = ["stripe", "ready", "gdpr", "trial"] as const;

const FEATURE_ICONS = {
  stripe: Shield,
  ready: Zap,
  gdpr: Lock,
  trial: Gift,
} as const;

const TRUST_ROW_KEYS = ["noHiddenFees", "cancelAnytime", "secureOnboarding", "trustedPayments"] as const;

type PricingHeroProps = {
  copyScope?: PricingCopyScope;
  className?: string;
};

export function PricingHero({ copyScope, className }: PricingHeroProps) {
  const { t } = useTranslation();
  const scope = copyScope ?? "staticPages.pricing.audience.general";
  const heroNs = "staticPages.pricing.hero";

  return (
    <section className={cn("caretip-pricing-hero-v2", className)} aria-labelledby="pricing-hero-title">
      <div className="caretip-pricing-hero-v2__glow" aria-hidden />
      <div className="caretip-pricing-hero-v2__inner">
        <PublicPageBackLink className="caretip-pricing-hero-v2__back mx-auto w-fit" />

        <PublicPageHeroCard innerClassName="caretip-pricing-hero-v2__card-inner">
        <div className="caretip-pricing-hero-v2__badge caretip-pricing-hero-v2__anim">
          <Sparkles className="size-3.5 shrink-0" aria-hidden />
          <span>{t(`${heroNs}.badge`, { defaultValue: t("staticPages.pricing.hero.badge") })}</span>
        </div>

        <h1 id="pricing-hero-title" className="caretip-pricing-hero-v2__title caretip-pricing-hero-v2__anim">
          {t("staticPages.pricing.pageTitle")}
        </h1>

        <p className="caretip-pricing-hero-v2__subtitle caretip-pricing-hero-v2__anim">
          {t(`${scope}.pageSubtitle`, {
            defaultValue: t("staticPages.pricing.pageSubtitle"),
          })}
        </p>

        <ul
          className="caretip-pricing-hero-v2__features caretip-pricing-hero-v2__features--flat"
          aria-label={t(`${heroNs}.featuresAria`)}
        >
          {FEATURE_KEYS.map((key, index) => {
            const Icon = FEATURE_ICONS[key];
            return (
              <li
                key={key}
                className="caretip-pricing-hero-v2__feature caretip-pricing-hero-v2__anim"
                style={{ animationDelay: `${120 + index * 55}ms` }}
              >
                <span className="caretip-pricing-hero-v2__feature-icon" aria-hidden>
                  <Icon className="size-[1.125rem]" strokeWidth={2.1} />
                </span>
                <div className="min-w-0 text-left">
                  <p className="caretip-pricing-hero-v2__feature-title">
                    {t(`${heroNs}.features.${key}.title`)}
                  </p>
                  <p className="caretip-pricing-hero-v2__feature-body">
                    {t(`${heroNs}.features.${key}.body`)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <ul
          className="caretip-pricing-hero-v2__trust caretip-pricing-hero-v2__anim"
          style={{ animationDelay: "340ms" }}
          aria-label={t(`${heroNs}.trustRow.aria`)}
        >
          {TRUST_ROW_KEYS.map((key) => (
            <li key={key} className="caretip-pricing-hero-v2__trust-item">
              <span className="caretip-pricing-hero-v2__trust-check" aria-hidden>
                ✓
              </span>
              <span>{t(`${heroNs}.trustRow.${key}`)}</span>
            </li>
          ))}
        </ul>
        </PublicPageHeroCard>
      </div>
    </section>
  );
}
