import { Link } from "react-router";
import { ShieldCheck, Sparkles } from "lucide-react";
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
      <div className="flex min-h-[50vh] items-center justify-center rounded-2xl border border-border/80 bg-card px-6 py-14 shadow-sm sm:px-10">
        <div className="mx-auto flex max-w-lg flex-col items-center text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
            <ShieldCheck className="h-8 w-8 text-primary" aria-hidden />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.08] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
            <Sparkles className="h-3 w-3" aria-hidden />
            {t("admin.kycComingSoon.badge")}
          </span>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
            {t("admin.kycComingSoon.body")}
          </p>
          <p className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
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
