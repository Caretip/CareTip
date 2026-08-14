import { Loader2, Rocket } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { onboardingFinishBtn } from "./businessOnboardingUi";
import { BusinessOnboardingNavFooter } from "./BusinessOnboardingNavFooter";

type BusinessOnboardingFinishCtaProps = {
  busy: boolean;
  disabled: boolean;
  onFinish: () => void;
  onBack: () => void;
};

export function BusinessOnboardingFinishCta({
  busy,
  disabled,
  onFinish,
  onBack,
}: BusinessOnboardingFinishCtaProps) {
  const { t } = useTranslation();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
      className="business-onboarding-finish-cta space-y-6"
    >
      <div className="business-onboarding-finish-cta__copy">
        <p className="business-onboarding-finish-cta__title">{t("business.onboarding.finalStep.readyTitle")}</p>
        <p className="business-onboarding-finish-cta__message">{t("business.onboarding.finalStep.readyMessage")}</p>
        <p className="business-onboarding-finish-cta__footnote">{t("business.onboarding.finalStep.publishHint")}</p>
        <p className="business-onboarding-finish-cta__footnote">{t("business.onboarding.finalStep.stripeNextHint")}</p>
      </div>

      <BusinessOnboardingNavFooter
        primaryLabel={
          busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("business.onboarding.actions.publishing")}
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4 shrink-0" aria-hidden />
              {t("business.onboarding.actions.finish")}
            </>
          )
        }
        onPrimary={onFinish}
        onBack={onBack}
        showBack
        busy={busy}
        disabled={disabled}
        showArrow={false}
        backLabel={t("business.onboarding.actions.back")}
        primaryClassName={onboardingFinishBtn}
      />
    </motion.div>
  );
}
