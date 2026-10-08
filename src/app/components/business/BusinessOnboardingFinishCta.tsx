import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { onboardingFinishBtn } from "./businessOnboardingUi";
import { BusinessOnboardingNavFooter } from "./BusinessOnboardingNavFooter";

type BusinessOnboardingFinishCtaProps = {
  busy: boolean;
  disabled: boolean;
  onFinish: () => void;
  onBack: () => void;
  layout?: "split" | "publish-only";
};

export function BusinessOnboardingFinishCta({
  busy,
  disabled,
  onFinish,
  onBack,
  layout = "split",
}: BusinessOnboardingFinishCtaProps) {
  const { t } = useTranslation();

  const publishOnly = layout === "publish-only";

  return (
    <div className="business-onboarding-finish-cta space-y-5">
      {publishOnly ? (
        <p className="business-onboarding-finish-cta__status">
          <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {t("business.onboarding.finalStep.guestPageReady")}
        </p>
      ) : null}

      <BusinessOnboardingNavFooter
        primaryClassName={cn(onboardingFinishBtn, publishOnly && "w-full sm:w-full sm:min-w-0")}
        primaryLabel={
          busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("business.onboarding.actions.publishing")}
            </>
          ) : (
            t("business.onboarding.actions.finish")
          )
        }
        onPrimary={onFinish}
        onBack={onBack}
        showBack={!publishOnly}
        busy={busy}
        disabled={disabled}
        showArrow={!busy}
        backLabel={t("business.onboarding.actions.back")}
      />

      {!publishOnly ? (
        <p className="business-onboarding-finish-cta__footnote">{t("business.onboarding.finalStep.publishHint")}</p>
      ) : null}
    </div>
  );
}
