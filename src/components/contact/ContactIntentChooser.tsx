import { ArrowLeft, ArrowRight, CalendarDays, Check, Handshake, LifeBuoy } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContactIntent } from "@/components/contact/contactTypes";
import { CONTACT_TRUST_KEYS } from "@/components/contact/contactTypes";
import { contactPageUi } from "@/components/contact/contactPageUi";
import { cn } from "@/lib/utils";

type ContactIntentChooserProps = {
  onSelect: (intent: Exclude<ContactIntent, "choose">) => void;
  className?: string;
};

const SERVICE_OPTIONS = [
  {
    id: "demo" as const,
    icon: CalendarDays,
    titleKey: "staticPages.contact.intent.demo.title",
    bodyKey: "staticPages.contact.intent.demo.description",
  },
  {
    id: "support" as const,
    icon: LifeBuoy,
    titleKey: "staticPages.contact.intent.support.title",
    bodyKey: "staticPages.contact.intent.support.description",
  },
  {
    id: "sales" as const,
    icon: Handshake,
    titleKey: "staticPages.contact.intent.sales.title",
    bodyKey: "staticPages.contact.intent.sales.description",
  },
] as const;

export function ContactIntentChooser({ onSelect, className }: ContactIntentChooserProps) {
  const { t } = useTranslation();

  return (
    <div className={cn("caretip-contact-chooser", className)}>
      <header className={contactPageUi.intro}>
        <div className="caretip-contact-reveal caretip-contact-reveal--1">
          <p className="caretip-contact-eyebrow">{t("staticPages.contact.eyebrow")}</p>
          <h1 className={contactPageUi.headline}>{t("staticPages.contact.headline")}</h1>
        </div>
        <p className={cn(contactPageUi.subhead, "caretip-contact-reveal caretip-contact-reveal--2")}>
          {t("staticPages.contact.supportingText")}
        </p>
      </header>

      <div
        className="caretip-contact-hero-rule caretip-contact-reveal caretip-contact-reveal--3"
        aria-hidden
      />

      <ul
        className="caretip-contact-hero-trust caretip-contact-reveal caretip-contact-reveal--4"
        aria-label={t("staticPages.contact.trust.aria")}
      >
        {CONTACT_TRUST_KEYS.map((key) => (
          <li key={key} className="caretip-contact-hero-trust__item">
            <Check className="caretip-contact-hero-trust__icon" strokeWidth={2} aria-hidden />
            <span>{t(`staticPages.contact.trust.${key}`)}</span>
          </li>
        ))}
      </ul>

      <section className="caretip-contact-services" aria-label={t("staticPages.contact.servicesAria")}>
        <ul className={contactPageUi.cards}>
          {SERVICE_OPTIONS.map((option, index) => {
            const Icon = option.icon;
            return (
              <li
                key={option.id}
                className={cn(
                  "caretip-contact-reveal",
                  `caretip-contact-reveal--service-${index + 1}`,
                )}
              >
                <button
                  type="button"
                  className={contactPageUi.card}
                  onClick={() => onSelect(option.id)}
                >
                  <span className="caretip-contact-service__icon" aria-hidden>
                    <Icon className="size-[1.125rem]" strokeWidth={1.75} />
                  </span>
                  <span className="caretip-contact-service__copy">
                    <span className={contactPageUi.cardTitle}>{t(option.titleKey)}</span>
                    <span className={contactPageUi.cardBody}>{t(option.bodyKey)}</span>
                  </span>
                  <span className="caretip-contact-service__arrow" aria-hidden>
                    <ArrowRight className="size-4" strokeWidth={1.75} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

type ContactFlowBackProps = {
  onBack: () => void;
};

export function ContactFlowBack({ onBack }: ContactFlowBackProps) {
  const { t } = useTranslation();

  return (
    <button type="button" className={contactPageUi.back} onClick={onBack}>
      <ArrowLeft className="size-4 shrink-0" aria-hidden />
      {t("staticPages.contact.backToChooser")}
    </button>
  );
}
