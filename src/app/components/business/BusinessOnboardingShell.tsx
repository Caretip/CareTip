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
  { step: 3 as OnboardingStep, labelKey: "business.onboarding.steps.setupComplete" },
] as const;

export function BusinessOnboardingHeader({ step }: { step: OnboardingStep }) {
  const { t } = useTranslation();

  return (
    <header className="business-onboarding-header">
      <Link
        to="/"
        className="inline-flex shrink-0 rounded-md transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <CareTipLogo size="auth" align="center" />
      </Link>
      <p className="business-onboarding-header__step hidden text-sm font-medium text-muted-foreground sm:block">
        {t("business.onboarding.formStepLabel", { current: step, total: TOTAL_STEPS })}
      </p>
    </header>
  );
}

type BusinessOnboardingProgressHeaderProps = {
  step: OnboardingStep;
};

export function BusinessOnboardingProgressHeader({ step }: BusinessOnboardingProgressHeaderProps) {
  const { t } = useTranslation();
  const progressPct = Math.round((step / TOTAL_STEPS) * 100);
  const currentLabel = t(STEP_META[step - 1].labelKey);

  return (
    <div
      className="business-onboarding-progress"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={TOTAL_STEPS}
      aria-valuenow={step}
      aria-label={t("business.onboarding.progressAria")}
    >
      <div className="business-onboarding-progress__mobile sm:hidden">
        <p className="text-sm font-medium text-muted-foreground">
          {t("business.onboarding.formStepLabel", { current: step, total: TOTAL_STEPS })}
        </p>
        <div className="business-onboarding-progress__bar" aria-hidden>
          <span className="business-onboarding-progress__bar-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="text-base font-semibold tracking-tight text-foreground">{currentLabel}</p>
      </div>

      <ol className="business-onboarding-stepper hidden sm:flex" aria-hidden>
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
              {index > 0 ? (
                <motion.span
                  className="business-onboarding-stepper__connector"
                  initial={false}
                  animate={{
                    opacity: completed ? 1 : 0.28,
                  }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  aria-hidden
                />
              ) : null}
              <div className="business-onboarding-stepper__row">
                <span
                  className={cn(
                    "business-onboarding-stepper__marker",
                    completed && "business-onboarding-stepper__marker--completed",
                    current && "business-onboarding-stepper__marker--current",
                  )}
                >
                  {completed ? (
                    <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <span>{stepNum}</span>
                  )}
                </span>
                <span className="business-onboarding-stepper__label">{t(labelKey)}</span>
              </div>
              {current ? <span className="business-onboarding-stepper__active-line" aria-hidden /> : null}
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
    <div className="business-onboarding-trust flex flex-wrap items-center justify-center gap-x-5 gap-y-2 lg:justify-start">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center gap-2 text-xs leading-relaxed text-muted-foreground"
        >
          <span className="h-1 w-1 rounded-full bg-primary/60" aria-hidden />
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
