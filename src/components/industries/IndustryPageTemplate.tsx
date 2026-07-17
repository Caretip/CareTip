import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Lock,
  Scale,
  CreditCard,
  QrCode,
  Smartphone,
  Wallet,
  Sparkles,
  Eye,
  HeartHandshake,
} from "lucide-react";
import type { IndustryPageId } from "@/app/data/industryPages";
import { INDUSTRY_MEDIA } from "@/app/data/industryMedia";
import { IndustryHeroFloatBadges } from "@/components/industries/IndustryHeroFloatBadges";
import { FaqAccordionItem } from "@/components/public/faq/FaqAccordionItem";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { publicPagesBrandUi } from "@/components/public/publicPagesBrandUi";
import { cn } from "@/lib/utils";

const STEP_ICONS = [QrCode, Smartphone, Wallet] as const;
const BENEFIT_ICONS = [Sparkles, Eye, HeartHandshake] as const;
const TRUST_ICONS = [Lock, Scale, CreditCard] as const;

type IndustryPageTemplateProps = {
  industryId: IndustryPageId;
};

/**
 * Master industry landing layout — identical structure for every industry.
 * Only headline, copy, images, benefits, FAQs, and float labels change.
 */
export function IndustryPageTemplate({ industryId }: IndustryPageTemplateProps) {
  const { t } = useTranslation();
  const prefix = `industries.pages.${industryId}`;
  const media = INDUSTRY_MEDIA[industryId];
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const steps = useMemo(
    () =>
      ([1, 2, 3] as const).map((n) => ({
        n,
        title: t(`${prefix}.steps.s${n}Title`),
        body: t(`${prefix}.steps.s${n}Body`),
      })),
    [prefix, t],
  );

  const benefits = useMemo(
    () =>
      ([1, 2, 3] as const).map((n) => ({
        n,
        title: t(`${prefix}.benefits.b${n}Title`),
        body: t(`${prefix}.benefits.b${n}Body`),
      })),
    [prefix, t],
  );

  const faqs = useMemo(
    () =>
      ([1, 2] as const).map((n) => ({
        q: t(`${prefix}.faq.q${n}`),
        a: t(`${prefix}.faq.a${n}`),
      })),
    [prefix, t],
  );

  const trustKeys = ["gdpr", "tax", "stripe"] as const;

  return (
    <PublicPageShell maxWidth="full" contentClassName="pb-0" className="bg-background">
      <main
        id={`industry-${industryId}`}
        className="caretip-industry-page"
        aria-label={t(`${prefix}.pageAria`)}
      >
        <section className="caretip-industry-page__hero" aria-labelledby="industry-hero-title">
          <div className="caretip-industry-page__inner caretip-industry-page__hero-grid">
            <div className="caretip-industry-page__hero-copy">
              <p className="caretip-industry-page__eyebrow">{t(`${prefix}.eyebrow`)}</p>
              <h1 id="industry-hero-title" className="caretip-industry-page__headline">
                {t(`${prefix}.headline`)}
              </h1>
              <p className="caretip-industry-page__subhead">{t(`${prefix}.subhead`)}</p>
              <Link
                to="/signup"
                className={cn(publicPagesBrandUi.ctaButtonPrimary, "caretip-industry-page__cta")}
              >
                {t(`${prefix}.cta`)}
              </Link>
            </div>
            <div className="caretip-industry-page__hero-media-wrap">
              <div className="caretip-industry-page__hero-media">
                <picture>
                  <source srcSet={media.hero.avif} type="image/avif" />
                  <source srcSet={media.hero.webp} type="image/webp" />
                  <img
                    src={media.hero.webp}
                    alt={t(`${prefix}.heroAlt`)}
                    width={720}
                    height={540}
                    decoding="async"
                    className="caretip-industry-page__hero-img"
                  />
                </picture>
              </div>
              <IndustryHeroFloatBadges industryId={industryId} />
            </div>
          </div>
        </section>

        <section className="caretip-industry-page__steps" aria-labelledby="industry-steps-title">
          <div className="caretip-industry-page__inner">
            <h2 id="industry-steps-title" className="caretip-industry-page__section-title">
              {t(`${prefix}.stepsTitle`)}
            </h2>
            <ol className="caretip-industry-page__steps-grid">
              {steps.map((step, index) => {
                const Icon = STEP_ICONS[index] ?? QrCode;
                return (
                  <li key={step.n} className="caretip-industry-page__step">
                    <span className="caretip-industry-page__step-icon" aria-hidden>
                      <Icon strokeWidth={1.75} />
                    </span>
                    <p className="caretip-industry-page__step-num">{step.n}</p>
                    <h3 className="caretip-industry-page__step-title">{step.title}</h3>
                    <p className="caretip-industry-page__step-body">{step.body}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section className="caretip-industry-page__benefits" aria-labelledby="industry-benefits-title">
          <div className="caretip-industry-page__inner caretip-industry-page__benefits-grid">
            <div className="caretip-industry-page__benefits-media">
              <picture>
                <source srcSet={media.benefits.avif} type="image/avif" />
                <source srcSet={media.benefits.webp} type="image/webp" />
                <img
                  src={media.benefits.webp}
                  alt={t(`${prefix}.benefitsAlt`)}
                  width={640}
                  height={520}
                  loading="lazy"
                  decoding="async"
                  className="caretip-industry-page__benefits-img"
                />
              </picture>
            </div>
            <div className="caretip-industry-page__benefits-copy">
              <p className="caretip-industry-page__benefits-eyebrow">
                {t("industries.shared.benefitsEyebrow")}
              </p>
              <h2 id="industry-benefits-title" className="caretip-industry-page__benefits-title">
                {t(`${prefix}.benefitsTitle`)}
              </h2>
              <ul className="caretip-industry-page__benefits-list">
                {benefits.map((benefit, index) => {
                  const Icon = BENEFIT_ICONS[index] ?? Sparkles;
                  return (
                    <li key={benefit.n} className="caretip-industry-page__benefit">
                      <span className="caretip-industry-page__benefit-icon" aria-hidden>
                        <Icon strokeWidth={1.75} />
                      </span>
                      <div>
                        <h3 className="caretip-industry-page__benefit-title">{benefit.title}</h3>
                        <p className="caretip-industry-page__benefit-body">{benefit.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>

        <section className="caretip-industry-page__faq" aria-labelledby="industry-faq-title">
          <div className="caretip-industry-page__inner">
            <h2 id="industry-faq-title" className="caretip-industry-page__section-title">
              {t("industries.shared.faqTitle")}
            </h2>
            <div className="caretip-industry-page__faq-list">
              {faqs.map((item, index) => (
                <FaqAccordionItem
                  key={item.q}
                  question={item.q}
                  answer={item.a}
                  isOpen={openFaq === index}
                  onToggle={() => setOpenFaq((prev) => (prev === index ? null : index))}
                />
              ))}
            </div>
            <ul className="caretip-industry-page__trust" aria-label={t("industries.shared.trustAria")}>
              {trustKeys.map((key, index) => {
                const Icon = TRUST_ICONS[index] ?? Lock;
                return (
                  <li key={key} className="caretip-industry-page__trust-item">
                    <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                    <span>{t(`industries.shared.trust.${key}`)}</span>
                  </li>
                );
              })}
            </ul>

            <div className="caretip-industry-page__final-cta">
              <h3 className="caretip-industry-page__final-cta-title">
                {t("industries.shared.finalCtaTitle")}
              </h3>
              <p className="caretip-industry-page__final-cta-body">
                {t("industries.shared.finalCtaBody")}
              </p>
              <div className="caretip-industry-page__final-cta-actions">
                <Link
                  to="/signup"
                  className={cn(publicPagesBrandUi.ctaButtonPrimary, "caretip-industry-page__cta")}
                >
                  {t("industries.shared.finalCtaButton")}
                </Link>
                <Link to="/pricing" className="caretip-industry-page__final-cta-secondary">
                  {t("industries.shared.finalCtaSecondary")}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </PublicPageShell>
  );
}
