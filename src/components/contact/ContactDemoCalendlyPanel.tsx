import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { RequestDemoCta } from "@/app/components/RequestDemoCta";
import { openCareTipCalendlyPopup } from "@/app/lib/calendly";
import { ContactFlowBack } from "@/components/contact/ContactIntentChooser";
import { contactPageUi } from "@/components/contact/contactPageUi";
import { publicPagesBrandUi } from "@/components/public/publicPagesBrandUi";

type ContactDemoCalendlyPanelProps = {
  onBack: () => void;
};

/** Demo contact path — opens Calendly scheduling instead of a lead form. */
export function ContactDemoCalendlyPanel({ onBack }: ContactDemoCalendlyPanelProps) {
  const { t } = useTranslation();
  const openedRef = useRef(false);

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    void openCareTipCalendlyPopup();
  }, []);

  return (
    <div className="caretip-contact-demo-calendly">
      <ContactFlowBack onBack={onBack} />
      <header className={contactPageUi.intro}>
        <h1 className={contactPageUi.headline}>{t("staticPages.contact.demo.calendlyTitle")}</h1>
        <p className={contactPageUi.subhead}>{t("staticPages.contact.demo.calendlyBody")}</p>
      </header>
      <div className="mt-8">
        <RequestDemoCta className={publicPagesBrandUi.ctaButtonPrimary}>
          {t("nav.requestDemo")}
        </RequestDemoCta>
      </div>
    </div>
  );
}
