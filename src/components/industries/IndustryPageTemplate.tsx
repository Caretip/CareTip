import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import {
  Lock,
  Scale,
  CreditCard,
  QrCode,
  Smartphone,
  Wallet,
  Rocket,
  Heart,
  Sparkles,
  Puzzle,
  Zap,
  ShieldCheck,
  Smile,
  BarChart3,
  Star,
  UserPlus,
  MapPin,
  Users,
  Feather,
  BanknoteX,
  ScanLine,
  LayoutDashboard,
  Tag,
  PartyPopper,
  IdCard,
  HeartHandshake,
  Landmark,
  Badge,
  MessageCircle,
  Activity,
} from "lucide-react";
import type { IndustryPageId } from "@/app/data/industryPages";
import { INDUSTRY_MEDIA } from "@/app/data/industryMedia";
import { IndustryHeroFloatBadges } from "@/components/industries/IndustryHeroFloatBadges";
import { IndustryHeroMedia } from "@/components/industries/IndustryHeroMedia";
import { FaqAccordionItem } from "@/components/public/faq/FaqAccordionItem";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { publicPagesBrandUi } from "@/components/public/publicPagesBrandUi";
import { warmAllIndustryHeroesIdle } from "@/lib/industryHeroAssets";
import { cn } from "@/lib/utils";

/** Process-step icons matched to each industry’s three flow points. */
const INDUSTRY_STEP_ICONS: Record<IndustryPageId, readonly [LucideIcon, LucideIcon, LucideIcon]> = {
  gastronomy: [QrCode, ScanLine, Wallet],
  hotels: [Tag, ScanLine, LayoutDashboard],
  logistics: [Tag, Smartphone, PartyPopper],
  midwives: [IdCard, HeartHandshake, Landmark],
  fairs: [Badge, MessageCircle, Activity],
  "field-service": [QrCode, CreditCard, Wallet],
};

/** Benefit icons matched to each industry’s three benefit points. */
const INDUSTRY_BENEFIT_ICONS: Record<IndustryPageId, readonly [LucideIcon, LucideIcon, LucideIcon]> = {
  gastronomy: [Rocket, Heart, Scale],
  hotels: [Sparkles, Puzzle, Scale],
  logistics: [Zap, BanknoteX, ShieldCheck],
  midwives: [Smile, ShieldCheck, Smartphone],
  fairs: [BarChart3, Star, UserPlus],
  "field-service": [MapPin, Users, Feather],
};

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

  useEffect(() => {
    setOpenFaq(0);
  }, [industryId]);

  useEffect(() => {
    warmAllIndustryHeroesIdle(industryId);
  }, [industryId]);

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

  const stepIcons = INDUSTRY_STEP_ICONS[industryId];
  const benefitIcons = INDUSTRY_BENEFIT_ICONS[industryId];
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
                <IndustryHeroMedia
                  key={industryId}
                  industryId={industryId}
                  alt={t(`${prefix}.heroAlt`)}
                />
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
                const Icon = stepIcons[index] ?? QrCode;
                return (
                  <li key={step.n} className="caretip-industry-page__step">
                    <span className="caretip-industry-page__step-icon" aria-hidden>
                      <Icon strokeWidth={1.75} />
                    </span>
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
              <picture key={`${industryId}-benefits`}>
                <source srcSet={media.benefits.avif} type="image/avif" />
                <source srcSet={media.benefits.webp} type="image/webp" />
                <img
                  src={media.benefits.webp}
                  alt={t(`${prefix}.benefitsAlt`)}
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
                  const Icon = benefitIcons[index] ?? Sparkles;
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
