import { Gift, Lock, Shield, Sparkles, Zap } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PricingCopyScope } from "@/app/data/pricingCopy";
import { PublicPageBackLink } from "@/components/public/PublicPageBackLink";
import { PublicPageHeroCard } from "@/components/public/PublicPageHeroCard";
import { publicPageUi } from "@/components/public/publicPageUi";
import { cn } from "@/lib/utils";

const FEATURE_KEYS = ["stripe", "ready", "gdpr", "trial"] as const;

const FEATURE_ICONS = {
  stripe: Shield,
  ready: Zap,
  gdpr: Lock,
  trial: Gift,
} as const;

const TRUST_ROW_KEYS = ["noHiddenFees", "cancelAnytime", "secureOnboarding", "trustedPayments"] as const;

function splitHeroSubtitle(text: string): { lead: string; body: string } {
  const match = text.match(/^(.+?[.!?])\s+(.+)$/s);
  if (!match) {
    return { lead: text, body: "" };
  }

  return { lead: match[1], body: match[2] };
}

type PricingHeroProps = {
  copyScope?: PricingCopyScope;
  className?: string;
};

export function PricingHero({ copyScope, className }: PricingHeroProps) {
  const { t } = useTranslation();
  const scope = copyScope ?? "staticPages.pricing.audience.general";
  const heroNs = "staticPages.pricing.hero";

  const pageSubtitle = t(`${scope}.pageSubtitle`, {
    defaultValue: t("staticPages.pricing.pageSubtitle"),
  });
  const { lead, body } = useMemo(() => splitHeroSubtitle(pageSubtitle), [pageSubtitle]);

  return (
    <>
      <section className={cn("caretip-pricing-hero-wise", className)} aria-labelledby="pricing-hero-title">
        <PublicPageBackLink className="caretip-pricing-hero-wise__back" />

        <div className="caretip-pricing-hero-wise__badge">
          <Sparkles className="size-3.5 shrink-0" aria-hidden />
          <span>{t(`${heroNs}.badge`, { defaultValue: t("staticPages.pricing.hero.badge") })}</span>
        </div>

        <PublicPageHeroCard innerClassName="caretip-pricing-hero-wise__shell caretip-pricing-hero-wise__inner">
          <h1
            id="pricing-hero-title"
            className={cn(publicPageUi.title, "caretip-pricing-hero-wise__title")}
          >
            {t("staticPages.pricing.pageTitle")}
          </h1>
          <p className="caretip-pricing-hero-wise__lead">{lead}</p>
          {body ? <p className="caretip-pricing-hero-wise__body">{body}</p> : null}
        </PublicPageHeroCard>
      </section>

      <section className="caretip-pricing-highlights" aria-label={t(`${heroNs}.featuresAria`)}>
        <div className="caretip-pricing-page__inner">
          <ul className="caretip-pricing-highlights__grid">
            {FEATURE_KEYS.map((key) => {
              const Icon = FEATURE_ICONS[key];
              return (
                <li key={key} className="caretip-pricing-highlights__item">
                  <span className="caretip-pricing-highlights__icon" aria-hidden>
                    <Icon className="size-[1.125rem]" strokeWidth={2.1} />
                  </span>
                  <div className="min-w-0 text-left">
                    <p className="caretip-pricing-highlights__title">{t(`${heroNs}.features.${key}.title`)}</p>
                    <p className="caretip-pricing-highlights__body">{t(`${heroNs}.features.${key}.body`)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="caretip-pricing-trust" aria-label={t(`${heroNs}.trustRow.aria`)}>
        <div className="caretip-pricing-page__inner caretip-pricing-trust__inner">
          <ul className="caretip-pricing-trust__grid">
            {TRUST_ROW_KEYS.map((key) => (
              <li key={key} className="caretip-pricing-trust__item">
                <span className="caretip-pricing-trust__check" aria-hidden>
                  ✓
                </span>
                <span>{t(`${heroNs}.trustRow.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
