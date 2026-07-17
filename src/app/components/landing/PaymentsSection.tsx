import { useTranslation } from "react-i18next";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { PaymentsAcceptedMarks } from "./PaymentsAcceptedMarks";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { cn } from "@/lib/utils";

/**
 * Payment infrastructure trust strip — heading + accepted methods + Powered by Stripe.
 */
export function PaymentsSection() {
  const { t } = useTranslation();
  const title = t("landing.paymentsTrust.title");

  return (
    <section
      id="payments-trust"
      aria-labelledby="payments-trust-heading"
      className={cn(
        landingUi.section,
        landingUi.landingSurface,
        "caretip-payments-trust caretip-payments-trust--marks relative overflow-hidden",
      )}
    >
      <div className="caretip-payments-trust__inner relative mx-auto flex w-full flex-col items-center px-4 text-center sm:px-6">
        <LandingReveal className="caretip-payments-trust__content flex w-full flex-col items-center">
          {landingCopyVisible(title) ? (
            <h2
              id="payments-trust-heading"
              className={cn(landingUi.sectionTitle, "caretip-payments-trust__title text-balance")}
            >
              {title}
            </h2>
          ) : null}

          <PaymentsAcceptedMarks
            className="caretip-payments-trust__marks"
            methodsAria={t("landing.paymentsTrust.methodsAria")}
            stripeAria={t("landing.paymentsTrust.stripeBadge")}
          />
        </LandingReveal>
      </div>
    </section>
  );
}
