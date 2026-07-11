import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContactIntent } from "@/components/contact/contactTypes";
import { ContactSocialProof } from "@/components/contact/ContactSocialProof";
import { PublicPageHeroCard } from "@/components/public/PublicPageHeroCard";
import { contactPageUi } from "@/components/contact/contactPageUi";
import { cn } from "@/lib/utils";

type ContactIntentChooserProps = {
  onSelect: (intent: Exclude<ContactIntent, "choose">) => void;
  className?: string;
};

export function ContactIntentChooser({ onSelect, className }: ContactIntentChooserProps) {
  const { t } = useTranslation();

  const options = [
    {
      id: "demo" as const,
      title: t("staticPages.contact.intent.demo.title"),
      body: t("staticPages.contact.intent.demo.description"),
      featured: true,
    },
    {
      id: "support" as const,
      title: t("staticPages.contact.intent.support.title"),
      body: t("staticPages.contact.intent.support.description"),
      featured: false,
    },
  ];

  return (
    <div className={cn("caretip-contact-chooser", className)}>
      <div className={contactPageUi.layout}>
        <PublicPageHeroCard innerClassName="caretip-contact-intro-hero-card__inner">
          <header className={contactPageUi.intro}>
            <p className="caretip-contact-eyebrow">{t("staticPages.contact.eyebrow")}</p>
            <h1 className={contactPageUi.headline}>{t("staticPages.contact.headline")}</h1>
            <p className={contactPageUi.subhead}>{t("staticPages.contact.supportingText")}</p>
          </header>
        </PublicPageHeroCard>

        <div className={contactPageUi.cards} role="list">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="listitem"
              className={cn(
                contactPageUi.card,
                option.featured && "caretip-contact-intent-card--primary",
              )}
              onClick={() => onSelect(option.id)}
            >
              <span className={contactPageUi.cardTitle}>{option.title}</span>
              <span className={contactPageUi.cardBody}>{option.body}</span>
            </button>
          ))}
        </div>
      </div>

      <ContactSocialProof />
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
