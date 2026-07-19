import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CONTACT_TRUST_KEYS } from "@/components/contact/contactTypes";
import { cn } from "@/lib/utils";

type ContactTrustRowProps = {
  className?: string;
};

export function ContactTrustRow({ className }: ContactTrustRowProps) {
  const { t } = useTranslation();

  return (
    <ul
      className={cn("caretip-contact-trust", className)}
      aria-label={t("staticPages.contact.trust.aria")}
    >
      {CONTACT_TRUST_KEYS.map((key) => (
        <li key={key} className="caretip-contact-trust__item">
          <Check className="caretip-contact-trust__icon" strokeWidth={2.75} aria-hidden />
          <span>{t(`staticPages.contact.trust.${key}`)}</span>
        </li>
      ))}
    </ul>
  );
}
