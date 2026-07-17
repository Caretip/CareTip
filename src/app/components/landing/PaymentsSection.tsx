import { useTranslation } from "react-i18next";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { PaymentsStripeBadge } from "./PaymentsStripeBadge";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { cn } from "@/lib/utils";

/**
 * Minimal payment trust strip — Stripe badge + one security sentence.
 */
export function PaymentsSection() {
  const { t } = useTranslation();
  const title = t("landing.paymentsTrust.title");
  const body = t("landing.paymentsTrust.body");

  return (
    <section
      id="payments-trust"
      className={cn(
        landingUi.section,
        landingUi.landingSurface,
        "caretip-payments-trust caretip-payments-trust--compact relative overflow-hidden",
      )}
    >
      <div className="relative mx-auto flex max-w-2xl flex-col items-center px-4 text-center sm:px-6">
        <LandingReveal className="flex w-full flex-col items-center gap-5 sm:gap-6">
          {landingCopyVisible(title) ? (
            <h2 className={cn(landingUi.sectionTitle, "max-w-[22ch] text-balance")}>{title}</h2>
          ) : null}

          <PaymentsStripeBadge label={t("landing.paymentsTrust.stripeBadge")} />

          {landingCopyVisible(body) ? (
            <p className={cn(landingUi.sectionSubtitle, "mx-auto max-w-xl text-pretty")}>{body}</p>
          ) : null}
        </LandingReveal>
      </div>
    </section>
  );
}
