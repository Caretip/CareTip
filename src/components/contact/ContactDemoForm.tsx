import { Check } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CONTACT_INDUSTRIES } from "@/app/data/caretipIndustries";
import { submitDemoLead } from "@/app/lib/leadApi";
import { trackGoogleAdsConversion } from "@/app/lib/googleAdsConversion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { CONTACT_TEAM_SIZES, DEMO_BULLET_COUNT } from "@/components/contact/contactTypes";
import { ContactFlowBack } from "@/components/contact/ContactIntentChooser";
import { ContactFormStage } from "@/components/contact/ContactFormStage";
import { contactPageUi } from "@/components/contact/contactPageUi";
import { cn } from "@/lib/utils";

type ContactDemoFormProps = {
  onBack: () => void;
  onSwitchToSupport: () => void;
  className?: string;
  /** Optional plan interest from pricing page (`?intent=demo&plan=business`). */
  pricingPlan?: string | null;
};

type FormStatus = "idle" | "submitting" | "success" | "error";

export function ContactDemoForm({
  onBack,
  onSwitchToSupport,
  className,
  pricingPlan,
}: ContactDemoFormProps) {
  const { t } = useTranslation();
  const bullets = Array.from({ length: DEMO_BULLET_COUNT }, (_, i) =>
    t(`staticPages.contact.demo.bullets.${i}`),
  );
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [teamSize, setTeamSize] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting" || status === "success") return;

    const form = e.currentTarget;
    const data = new FormData(form);
    const fullName = String(data.get("fullName") ?? "").trim();
    const workEmail = String(data.get("workEmail") ?? "").trim();
    const businessName = String(data.get("businessName") ?? "").trim();
    const message = String(data.get("message") ?? "").trim();

    if (!fullName || !workEmail || !businessName || !businessType || !teamSize || !message) {
      setStatus("error");
      setErrorMessage(t("staticPages.contact.form.validation"));
      return;
    }

    setStatus("submitting");
    setErrorMessage("");

    const result = await submitDemoLead({
      fullName,
      workEmail,
      businessName,
      businessType,
      teamSize,
      message,
    });

    if (result.ok) {
      setStatus("success");
      trackGoogleAdsConversion("demo_lead_submitted");
      form.reset();
      setBusinessType("");
      setTeamSize("");
      return;
    }

    setStatus("error");
    setErrorMessage(result.message);
  }

  return (
    <div className={cn(contactPageUi.flow, "caretip-contact-enter", className)}>
      <ContactFlowBack onBack={onBack} />

      <div className={cn(contactPageUi.layout, "caretip-contact-layout--form")}>
        <aside className={cn(contactPageUi.flowAside, "caretip-contact-flow__aside--editorial")}>
          <h2 className={contactPageUi.flowTitle}>{t("staticPages.contact.demo.title")}</h2>
          <ul className={contactPageUi.flowList}>
            {bullets.map((item) => (
              <li key={item}>
                <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className={contactPageUi.flowAlt}>
            {t("staticPages.contact.demo.altPrompt")}{" "}
            <button type="button" className="caretip-contact-inline-link" onClick={onSwitchToSupport}>
              {t("staticPages.contact.intent.support.title")}
            </button>
          </p>
          {pricingPlan ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("staticPages.contact.demo.pricingPlanInterest", { plan: pricingPlan })}
            </p>
          ) : null}
          <p className="mt-4 text-sm">
            <Link to="/pricing" className="caretip-contact-inline-link font-semibold">
              {t("staticPages.contact.demo.viewPricing")}
            </Link>
          </p>
        </aside>

        <ContactFormStage variant="demo">
          {status === "success" ? (
            <div className="caretip-contact-form-status caretip-contact-form-status--success" role="status">
              <p className="caretip-contact-form-status__title">{t("staticPages.contact.form.successTitle")}</p>
              <p>{t("staticPages.contact.form.demoSuccess")}</p>
            </div>
          ) : (
            <form className={contactPageUi.flowForm} onSubmit={handleSubmit} noValidate>
              <div className={cn(contactPageUi.form, "caretip-contact-form--primary")}>
                <div className={contactPageUi.field}>
                  <label className={contactPageUi.label} htmlFor="contact-demo-name">
                    {t("staticPages.contact.demo.fields.fullName")}
                  </label>
                  <input
                    id="contact-demo-name"
                    name="fullName"
                    type="text"
                    autoComplete="name"
                    required
                    className={contactPageUi.input}
                    placeholder={t("staticPages.contact.demo.placeholders.fullName")}
                  />
                </div>

                <div className={contactPageUi.field}>
                  <label className={contactPageUi.label} htmlFor="contact-demo-email">
                    {t("staticPages.contact.demo.fields.workEmail")}
                  </label>
                  <input
                    id="contact-demo-email"
                    name="workEmail"
                    type="email"
                    autoComplete="email"
                    required
                    className={contactPageUi.input}
                    placeholder={t("staticPages.contact.demo.placeholders.workEmail")}
                  />
                </div>

                <div className={contactPageUi.field}>
                  <label className={contactPageUi.label} htmlFor="contact-demo-business">
                    {t("staticPages.contact.demo.fields.businessName")}
                  </label>
                  <input
                    id="contact-demo-business"
                    name="businessName"
                    type="text"
                    autoComplete="organization"
                    required
                    className={contactPageUi.input}
                    placeholder={t("staticPages.contact.demo.placeholders.businessName")}
                  />
                </div>

                <div className={contactPageUi.field}>
                  <label className={contactPageUi.label} htmlFor="contact-demo-business-type">
                    {t("staticPages.contact.demo.fields.businessType")}
                  </label>
                  <Select value={businessType} onValueChange={setBusinessType} required>
                    <SelectTrigger id="contact-demo-business-type" className="caretip-contact-select-trigger">
                      <SelectValue placeholder={t("staticPages.contact.demo.placeholders.businessType")} />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {CONTACT_INDUSTRIES.map((key) => (
                        <SelectItem key={key} value={key}>
                          {t(`staticPages.pricing.industry.${key}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className={contactPageUi.field}>
                  <label className={contactPageUi.label} htmlFor="contact-demo-team-size">
                    {t("staticPages.contact.demo.fields.teamSize")}
                  </label>
                  <Select value={teamSize} onValueChange={setTeamSize} required>
                    <SelectTrigger id="contact-demo-team-size" className="caretip-contact-select-trigger">
                      <SelectValue placeholder={t("staticPages.contact.demo.placeholders.teamSize")} />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {CONTACT_TEAM_SIZES.map((key) => (
                        <SelectItem key={key} value={key}>
                          {t(`staticPages.contact.demo.teamSizes.${key}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className={contactPageUi.field}>
                  <label className={contactPageUi.label} htmlFor="contact-demo-message">
                    {t("staticPages.contact.demo.fields.message")}
                  </label>
                  <textarea
                    id="contact-demo-message"
                    name="message"
                    rows={5}
                    required
                    className={contactPageUi.textarea}
                    placeholder={t("staticPages.contact.demo.placeholders.message")}
                  />
                </div>

                {status === "error" && errorMessage ? (
                  <p className="caretip-contact-form-status caretip-contact-form-status--error" role="alert">
                    {errorMessage}
                  </p>
                ) : null}

                <button type="submit" className={contactPageUi.submit} disabled={status === "submitting"}>
                  {status === "submitting"
                    ? t("staticPages.contact.form.submitting")
                    : t("staticPages.contact.demo.submit")}
                </button>
              </div>
            </form>
          )}
        </ContactFormStage>
      </div>
    </div>
  );
}
