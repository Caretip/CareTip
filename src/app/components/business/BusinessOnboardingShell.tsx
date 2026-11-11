import { Link } from "react-router";
import { Check } from "lucide-react";
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

export function BusinessOnboardingRail({ step }: { step: OnboardingStep }) {
  const { t } = useTranslation();

  return (
    <div className="business-onboarding-rail">
      <div className="business-onboarding-rail__inner">
        <header className="business-onboarding-rail__top">
          <Link to="/" className="business-onboarding-rail__logo">
            <CareTipLogo size="auth" align="center" />
          </Link>
          <p className="business-onboarding-rail__count">
            {t("business.onboarding.formStepLabel", { current: step, total: TOTAL_STEPS })}
          </p>
        </header>

        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-valuenow={step}
          aria-valuetext={t(STEP_META[step - 1].labelKey)}
          aria-label={t("business.onboarding.progressAria")}
        >
          <div className="business-onboarding-segments" aria-hidden>
            {STEP_META.map(({ step: stepNum }) => (
              <span
                key={stepNum}
                className={cn(
                  "business-onboarding-segments__bar",
                  stepNum <= step && "business-onboarding-segments__bar--on",
                )}
              />
            ))}
          </div>

          <ol className="business-onboarding-steps" aria-hidden>
            {STEP_META.map(({ step: stepNum, labelKey }) => {
              const completed = stepNum < step;
              const current = stepNum === step;

              return (
                <li
                  key={stepNum}
                  className={cn(
                    "business-onboarding-steps__item",
                    completed && "business-onboarding-steps__item--completed",
                    current && "business-onboarding-steps__item--current",
                  )}
                >
                  <span className="business-onboarding-steps__marker">
                    {completed ? (
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                    ) : (
                      <span className="business-onboarding-steps__num">{stepNum}</span>
                    )}
                  </span>
                  <span className="business-onboarding-steps__label">{t(labelKey)}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="business-onboarding-rail__foot">
          <BusinessOnboardingFootnote />
        </div>
      </div>
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
