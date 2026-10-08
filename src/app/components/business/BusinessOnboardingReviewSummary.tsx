import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BusinessLogoMark } from "./BusinessLogoMark";
import { cn } from "@/lib/utils";
import { BUSINESS_TYPE_I18N } from "../../lib/businessVenueOptions";

type BusinessOnboardingReviewSummaryProps = {
  legalBusinessName: string;
  businessType: string;
  registeredAddress: string;
  contactPhone: string;
  website: string;
  logoPreviewUrl: string | null;
  className?: string;
};

function ReviewBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="business-onboarding-review-block">
      <h3 className="business-onboarding-review-block__title">{title}</h3>
      <div className="business-onboarding-review-block__body">{children}</div>
    </section>
  );
}

function ReviewLine({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="business-onboarding-review-line">
      <p className="business-onboarding-review-line__label">{label}</p>
      <p className={cn("business-onboarding-review-line__value", muted && "business-onboarding-review-line__value--muted")}>
        {value}
      </p>
    </div>
  );
}

export function BusinessOnboardingReviewSummary({
  legalBusinessName,
  businessType,
  registeredAddress,
  contactPhone,
  website,
  logoPreviewUrl,
  className,
}: BusinessOnboardingReviewSummaryProps) {
  const { t } = useTranslation();

  const typeLabel = businessType.trim()
    ? BUSINESS_TYPE_I18N[businessType]
      ? t(BUSINESS_TYPE_I18N[businessType])
      : businessType
    : t("business.onboarding.fields.optional");

  const optional = t("business.onboarding.fields.optional");
  const displayName = legalBusinessName.trim() || t("business.onboarding.preview.placeholderVenueName");

  return (
    <div className={cn("business-onboarding-review-summary", className)}>
      <ReviewBlock title={t("business.onboarding.review.sections.businessInfo")}>
        <p className="business-onboarding-review-summary__lead">{displayName}</p>
        <p className="business-onboarding-review-summary__sub">{typeLabel}</p>
        <ReviewLine
          label={t("business.onboarding.fields.address")}
          value={registeredAddress.trim() || optional}
          muted={!registeredAddress.trim()}
        />
        <ReviewLine
          label={t("business.onboarding.fields.phone")}
          value={contactPhone.trim() || optional}
          muted={!contactPhone.trim()}
        />
        {website.trim() ? (
          <ReviewLine label={t("business.onboarding.fields.website")} value={website.trim()} />
        ) : null}
      </ReviewBlock>

      <ReviewBlock title={t("business.onboarding.review.sections.branding")}>
        <div className="flex items-center gap-3">
          <BusinessLogoMark logoPathOrUrl={logoPreviewUrl} businessName={displayName} size="sm" />
          <div className="min-w-0">
            <p className="business-onboarding-review-line__label">{t("business.onboarding.review.brandingLabel")}</p>
            <p className="business-onboarding-review-line__value">
              {logoPreviewUrl
                ? t("business.onboarding.review.logoAdded")
                : t("business.onboarding.review.logoSkipped")}
            </p>
          </div>
        </div>
      </ReviewBlock>
    </div>
  );
}
