import { Clock, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  CARETIP_INFO_EMAIL,
  CARETIP_INFO_MAILTO,
  CARETIP_SUPPORT_EMAIL,
  CARETIP_SUPPORT_MAILTO,
} from "@/app/lib/caretipContactEmails";

type ContactReassurancePanelProps = {
  variant: "demo" | "support";
  className?: string;
};

export function ContactReassurancePanel({ variant, className }: ContactReassurancePanelProps) {
  const { t } = useTranslation();
  const prefix = `staticPages.contact.reassurance.${variant}`;
  const email = variant === "support" ? CARETIP_SUPPORT_EMAIL : CARETIP_INFO_EMAIL;
  const mailto = variant === "support" ? CARETIP_SUPPORT_MAILTO : CARETIP_INFO_MAILTO;

  return (
    <aside className={cn("caretip-contact-reassurance", className)} aria-label={t(`${prefix}.aria`)}>
      <h3 className="caretip-contact-reassurance__title">{t(`${prefix}.title`)}</h3>
      <p className="caretip-contact-reassurance__body">{t(`${prefix}.body`)}</p>
      <p className="caretip-contact-reassurance__team">{t(`${prefix}.team`)}</p>
      <a className="caretip-contact-reassurance__email" href={mailto}>
        <Mail className="size-4 shrink-0" aria-hidden />
        {email}
      </a>
      <p className="caretip-contact-reassurance__sla">
        <Clock className="size-3.5 shrink-0" aria-hidden />
        {t(`${prefix}.responseTime`)}
      </p>
    </aside>
  );
}
