import { Link } from "react-router";
import { Check } from "lucide-react";
import { motion } from "motion/react";
import { CareTipLogo } from "../CareTipLogo";
import type { OnboardingStep } from "./BusinessOnboardingProgress";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const TOTAL_STEPS = 3;

const STEP_META = [
  { step: 1 as OnboardingStep, labelKey: "business.onboarding.steps.businessDetails" },
  { step: 2 as OnboardingStep, labelKey: "business.onboarding.steps.brandingSetup" },
  { step: 3 as OnboardingStep, labelKey: "business.onboarding.steps.reviewPublish" },
] as const;

export function BusinessOnboardingHeader() {
  return (
    <header className="business-onboarding-header">
      <Link
        to="/"
        className="inline-flex shrink-0 rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <CareTipLogo size="auth" align="center" />
      </Link>
    </header>
  );
}

type BusinessOnboardingProgressHeaderProps = {
  step: OnboardingStep;
};

export function BusinessOnboardingProgressHeader({ step }: BusinessOnboardingProgressHeaderProps) {
  const { t } = useTranslation();
  const isFinal = step === TOTAL_STEPS;

  return (
    <div
      className="business-onboarding-progress space-y-5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={TOTAL_STEPS}
      aria-valuenow={step}
      aria-label={t("business.onboarding.progressAria")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">
          {t("business.onboarding.formStepLabel", { current: step, total: TOTAL_STEPS })}
        </p>
        {isFinal ? (
          <span className="text-xs font-medium text-muted-foreground">
            {t("business.onboarding.finalStep.badge")}
          </span>
        ) : null}
      </div>

      <ol className="business-onboarding-stepper" aria-hidden>
        {STEP_META.map(({ step: stepNum, labelKey }, index) => {
          const completed = stepNum < step;
          const current = stepNum === step;
          const upcoming = stepNum > step;

          return (
            <li
              key={stepNum}
              className={cn(
                "business-onboarding-stepper__item",
                completed && "business-onboarding-stepper__item--completed",
                current && "business-onboarding-stepper__item--current",
                upcoming && "business-onboarding-stepper__item--upcoming",
              )}
            >
              <div className="business-onboarding-stepper__track">
                {index > 0 ? (
                  <motion.span
                    className="business-onboarding-stepper__connector"
                    initial={false}
                    animate={{
                      scaleX: completed || current ? 1 : 0,
                      opacity: completed || current ? 1 : 0.35,
                    }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    style={{ transformOrigin: "left center" }}
                  />
                ) : null}
                <span
                  className={cn(
                    "business-onboarding-stepper__dot",
                    completed && "business-onboarding-stepper__dot--completed",
                    current && "business-onboarding-stepper__dot--current",
                  )}
                >
                  {completed ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <span>{stepNum}</span>
                  )}
                </span>
              </div>
              <span className="business-onboarding-stepper__label">{t(labelKey)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function BusinessOnboardingFootnote() {
  const { t } = useTranslation();
  const items = [
    t("business.onboarding.trust.secure"),
    t("business.onboarding.trust.fast"),
    t("business.onboarding.trust.editable"),
  ];

  return (
    <div className="business-onboarding-trust flex flex-wrap items-center justify-center gap-x-4 gap-y-2 lg:justify-start">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center gap-1.5 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500"
        >
          <span className="h-1 w-1 rounded-full bg-orange-500/70" aria-hidden />
          {item}
        </span>
      ))}
    </div>
  );
}

/** @deprecated Use BusinessOnboardingProgressHeader */
export function BusinessOnboardingStepBars({ step }: { step: OnboardingStep }) {
  return <BusinessOnboardingProgressHeader step={step} />;
}
