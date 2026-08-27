import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { submitSupportLead } from "@/app/lib/leadApi";
import { buildCaretipMailto, CARETIP_SUPPORT_EMAIL } from "@/app/lib/caretipContactEmails";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { CONTACT_SUPPORT_CATEGORIES } from "@/components/contact/contactTypes";
import { ContactFlowBack } from "@/components/contact/ContactIntentChooser";
import { ContactFormStage } from "@/components/contact/ContactFormStage";
import { contactPageUi } from "@/components/contact/contactPageUi";
import { cn } from "@/lib/utils";

type ContactSupportFormProps = {
  onBack: () => void;
  onSwitchToDemo: () => void;
  className?: string;
};

type FormStatus = "idle" | "submitting" | "success" | "error";

export function ContactSupportForm({ onBack, onSwitchToDemo, className }: ContactSupportFormProps) {
  const { t } = useTranslation();
  const bullets = [0, 1, 2].map((i) => t(`staticPages.contact.support.bullets.${i}`));
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fallbackMailto, setFallbackMailto] = useState<string | null>(null);
  const [category, setCategory] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting" || status === "success") return;

    const form = e.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const message = String(data.get("message") ?? "").trim();

    if (!name || !email || !category || !message) {
      setStatus("error");
      setErrorMessage(t("staticPages.contact.form.validation"));
      setFallbackMailto(null);
      return;
    }

    setStatus("submitting");
    setErrorMessage("");
    setFallbackMailto(null);

    const result = await submitSupportLead({ name, email, category, message });

    if (result.ok) {
      setStatus("success");
      form.reset();
      setCategory("");
      return;
    }

    // Do not auto-open mailto — that can feel like delivery succeeded.
    setFallbackMailto(
      buildCaretipMailto({
        mailbox: "support",
        subject: `CareTip support — ${category}`,
        body: [`Name: ${name}`, `Email: ${email}`, `Category: ${category}`, "", message].join("\n"),
      }),
    );
    setStatus("error");
    setErrorMessage(
      result.message.includes(CARETIP_SUPPORT_EMAIL)
        ? result.message
        : `${t("staticPages.contact.form.notDelivered")} ${CARETIP_SUPPORT_EMAIL}.`,
    );
  }

  return (
    <div className={cn(contactPageUi.flow, "caretip-contact-enter", className)}>
      <ContactFlowBack onBack={onBack} />

      <div className={cn(contactPageUi.layout, "caretip-contact-layout--form")}>
        <aside className={cn(contactPageUi.flowAside, "caretip-contact-flow__aside--editorial")}>
          <h2 className={contactPageUi.flowTitle}>{t("staticPages.contact.support.title")}</h2>
          <ul className={contactPageUi.flowList}>
            {bullets.map((item) => (
              <li key={item}>
                <Check className="caretip-feature-check shrink-0" strokeWidth={2.75} aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className={contactPageUi.flowAlt}>
            {t("staticPages.contact.support.altPrompt")}{" "}
            <button type="button" className="caretip-contact-inline-link" onClick={onSwitchToDemo}>
              {t("staticPages.contact.intent.demo.title")}
            </button>
          </p>
        </aside>

        <ContactFormStage variant="support">
          {status === "success" ? (
            <div className="caretip-contact-form-status caretip-contact-form-status--success" role="status">
              <p className="caretip-contact-form-status__title">{t("staticPages.contact.form.successTitle")}</p>
              <p>{t("staticPages.contact.form.supportSuccess")}</p>
            </div>
          ) : (
            <form className={contactPageUi.flowForm} onSubmit={handleSubmit} noValidate>
              <div className={cn(contactPageUi.form, "caretip-contact-form--primary")}>
                <div className={contactPageUi.field}>
                  <label className={contactPageUi.label} htmlFor="contact-support-name">
                    {t("staticPages.contact.support.fields.name")}
                  </label>
                  <input
                    id="contact-support-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    className={contactPageUi.input}
                    placeholder={t("staticPages.contact.support.placeholders.name")}
                  />
                </div>

                <div className={contactPageUi.field}>
                  <label className={contactPageUi.label} htmlFor="contact-support-email">
                    {t("staticPages.contact.support.fields.email")}
                  </label>
                  <input
                    id="contact-support-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className={contactPageUi.input}
                    placeholder={t("staticPages.contact.support.placeholders.email")}
                  />
                </div>

                <div className={contactPageUi.field}>
                  <label className={contactPageUi.label} htmlFor="contact-support-category">
                    {t("staticPages.contact.support.fields.category")}
                  </label>
                  <Select value={category} onValueChange={setCategory} required>
                    <SelectTrigger id="contact-support-category" className="caretip-contact-select-trigger">
                      <SelectValue placeholder={t("staticPages.contact.support.placeholders.category")} />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {CONTACT_SUPPORT_CATEGORIES.map((key) => (
                        <SelectItem key={key} value={key}>
                          {t(`staticPages.contact.support.categories.${key}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className={contactPageUi.field}>
                  <label className={contactPageUi.label} htmlFor="contact-support-message">
                    {t("staticPages.contact.support.fields.message")}
                  </label>
                  <textarea
                    id="contact-support-message"
                    name="message"
                    rows={5}
                    required
                    className={contactPageUi.textarea}
                    placeholder={t("staticPages.contact.support.placeholders.message")}
                  />
                </div>

                {status === "error" && errorMessage ? (
                  <div className="caretip-contact-form-status caretip-contact-form-status--error" role="alert">
                    <p>{errorMessage}</p>
                    {fallbackMailto ? (
                      <p className="mt-2">
                        <a className="caretip-contact-inline-link font-semibold" href={fallbackMailto}>
                          {t("staticPages.contact.form.emailFallbackLink")} ({CARETIP_SUPPORT_EMAIL})
                        </a>
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <button type="submit" className={contactPageUi.submit} disabled={status === "submitting"}>
                  {status === "submitting"
                    ? t("staticPages.contact.form.submitting")
                    : t("staticPages.contact.support.submit")}
                </button>
              </div>
            </form>
          )}
        </ContactFormStage>
      </div>
    </div>
  );
}
