import { Check, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContactFlowBack } from "@/components/contact/ContactIntentChooser";
import { ContactTrustRow } from "@/components/contact/ContactTrustRow";
import { SALES_BULLET_COUNT } from "@/components/contact/contactTypes";
import { contactPageUi } from "@/components/contact/contactPageUi";
import { cn } from "@/lib/utils";

type ContactSalesPanelProps = {
  onBack: () => void;
  onSwitchToDemo: () => void;
  onSwitchToSupport: () => void;
  className?: string;
};

/**
 * Sales & partnerships contact stage — editorial panel (no form; mailto sales).
 * Keeps existing demo/support forms untouched.
 */
export function ContactSalesPanel({
  onBack,
  onSwitchToDemo,
  onSwitchToSupport,
  className,
}: ContactSalesPanelProps) {
  const { t } = useTranslation();
  const bullets = Array.from({ length: SALES_BULLET_COUNT }, (_, i) =>
    t(`staticPages.contact.sales.bullets.${i}`),
  );
  const email = t("staticPages.contact.sales.email");

  return (
    <div className={cn(contactPageUi.flow, "caretip-contact-enter", className)}>
      <ContactFlowBack onBack={onBack} />

      <div className={cn(contactPageUi.layout, "caretip-contact-layout--form")}>
        <aside className={cn(contactPageUi.flowAside, "caretip-contact-flow__aside--editorial")}>
          <h2 className={contactPageUi.flowTitle}>{t("staticPages.contact.sales.title")}</h2>
          <ul className={contactPageUi.flowList}>
            {bullets.map((item) => (
              <li key={item}>
                <Check className="caretip-feature-check shrink-0" strokeWidth={2.75} aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className={contactPageUi.flowAlt}>
            {t("staticPages.contact.sales.altDemo")}{" "}
            <button type="button" className="caretip-contact-inline-link" onClick={onSwitchToDemo}>
              {t("staticPages.contact.intent.demo.title")}
            </button>
          </p>
          <p className={contactPageUi.flowAlt}>
            {t("staticPages.contact.sales.altSupport")}{" "}
            <button type="button" className="caretip-contact-inline-link" onClick={onSwitchToSupport}>
              {t("staticPages.contact.intent.support.title")}
            </button>
          </p>
        </aside>

        <div className="caretip-contact-form-stage">
          <ContactTrustRow />
          <div className="caretip-contact-sales-panel">
            <h3 className="caretip-contact-sales-panel__title">
              {t("staticPages.contact.sales.panelTitle")}
            </h3>
            <p className="caretip-contact-sales-panel__body">
              {t("staticPages.contact.sales.panelBody")}
            </p>
            <a className="caretip-contact-sales-panel__email" href={`mailto:${email}`}>
              <Mail className="size-4 shrink-0" aria-hidden />
              {email}
            </a>
            <p className="caretip-contact-sales-panel__sla">
              {t("staticPages.contact.sales.responseTime")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
