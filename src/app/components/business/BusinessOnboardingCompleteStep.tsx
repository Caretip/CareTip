import { Check, Clock, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  onboardingContinueBtn,
  onboardingDisplayFont,
  onboardingHeadline,
  onboardingSubhead,
} from "./businessOnboardingUi";

type BusinessOnboardingCompleteStepProps = {
  busy: boolean;
  onGoToDashboard: () => void;
};

export function BusinessOnboardingCompleteStep({ busy, onGoToDashboard }: BusinessOnboardingCompleteStepProps) {
  const { t } = useTranslation();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="business-onboarding-complete mx-auto w-full max-w-xl"
    >
      <div className="business-onboarding-complete__icon-wrap" aria-hidden>
        <span className="business-onboarding-complete__icon-ring">
          <Check className="h-7 w-7 text-primary" strokeWidth={2.5} />
        </span>
      </div>

      <header className="mt-8 space-y-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
          {t("business.onboarding.completeStep.eyebrow")}
        </p>
        <h1
          id="onboarding-page-title"
          className={cn(onboardingHeadline, "!text-[clamp(1.75rem,4.5vw,2.5rem)]")}
          style={{ fontFamily: onboardingDisplayFont }}
        >
          {t("business.onboarding.completeStep.headline")}
        </h1>
        <p className={cn(onboardingSubhead, "mx-auto")}>{t("business.onboarding.completeStep.subhead")}</p>
      </header>

      <div
        className="business-onboarding-complete__status mt-10"
        role="status"
        aria-live="polite"
      >
        <div className="business-onboarding-complete__status-badge">
          <Clock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
          <span>{t("business.onboarding.completeStep.reviewBadge")}</span>
        </div>
        <p className="business-onboarding-complete__status-title">
          {t("business.onboarding.completeStep.reviewTitle")}
        </p>
        <p className="business-onboarding-complete__status-body">
          {t("business.onboarding.completeStep.reviewBody")}
        </p>
        <p className="business-onboarding-complete__status-qr">
          {t("business.onboarding.completeStep.qrNotice")}
        </p>
      </div>

      <div className="mt-10 flex flex-col items-stretch gap-3 sm:items-center">
        <button
          type="button"
          onClick={onGoToDashboard}
          disabled={busy}
          aria-busy={busy}
          className={cn(onboardingContinueBtn, "w-full sm:min-w-[14rem] sm:w-auto")}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("business.onboarding.actions.openingDashboard")}
            </>
          ) : (
            t("business.onboarding.actions.goToDashboard")
          )}
        </button>
      </div>
    </motion.div>
  );
}
