import { Link } from "react-router";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PlatformPage, PlatformPageHeader } from "../../components/platform/PlatformPageChrome";
import { PLATFORM_BUSINESS_BASE } from "../../components/platform/platformAdminNav";

/** Platform admin — KYC management reserved for a future release. */
export function PlatformKycComingSoonPage() {
  const { t } = useTranslation();

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={ShieldCheck}
        title={t("admin.kycComingSoon.title")}
        subtitle={t("admin.kycComingSoon.subtitle")}
      />
      <div className="flex min-h-[50vh] items-center justify-center rounded-lg border border-border/70 bg-card px-6 py-14 sm:px-10">
        <div className="mx-auto flex max-w-lg flex-col items-center text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
            <ShieldCheck className="h-8 w-8 text-foreground" aria-hidden />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {t("admin.kycComingSoon.badge")}
          </span>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
            {t("admin.kycComingSoon.body")}
          </p>
          <p className="mt-4 text-xs font-medium text-muted-foreground">
            {t("common.comingSoonInDevelopment")}
          </p>
          <Link
            to={`${PLATFORM_BUSINESS_BASE}/onboarding-verification`}
            className="mt-7 text-sm font-semibold text-primary transition-colors hover:underline"
          >
            {t("admin.kycComingSoon.onboardingLink")}
          </Link>
        </div>
      </div>
    </PlatformPage>
  );
}
