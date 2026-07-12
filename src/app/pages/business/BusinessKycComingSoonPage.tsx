import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Sparkles } from "lucide-react";
import { useRequireAuth } from "../../hooks/useRequireAuth";

/** KYC is not yet exposed to business managers — informational only. */
export function BusinessKycComingSoonPage() {
  const { t } = useTranslation();
  useRequireAuth();

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-12 sm:py-16">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
          <ShieldCheck className="h-8 w-8 text-primary" aria-hidden />
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.08] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
          <Sparkles className="h-3 w-3" aria-hidden />
          {t("business.kyc.comingSoon.badge")}
        </span>

        <h1 className="mt-5 font-hero-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t("business.kyc.comingSoon.title")}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
          {t("business.kyc.comingSoon.body")}
        </p>
        <p className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
          {t("common.comingSoonInDevelopment")}
        </p>

        <div className="mt-8 flex flex-col justify-center gap-2.5 sm:flex-row">
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("business.kyc.comingSoon.backDashboard")}
          </Link>
          <Link
            to="/awaiting-approval"
            className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60"
          >
            {t("business.kyc.comingSoon.onboardingStatus")}
          </Link>
        </div>
      </div>
    </div>
  );
}
