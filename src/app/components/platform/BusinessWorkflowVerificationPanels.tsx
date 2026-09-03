import { useTranslation } from "react-i18next";
import { CheckCircle, ShieldCheck, XCircle } from "lucide-react";
import { Link } from "react-router";
import type {
  OnboardingVerificationStatus,
  PlatformBusinessRow,
  PlatformOnboardingVerificationAction,
} from "../../lib/api";
import { MVP_KYC_ADMIN_MANAGEMENT_ENABLED } from "../../lib/mvpVerificationPolicy";
import { PLATFORM_BUSINESS_BASE } from "./platformAdminNav";
import { cn } from "@/lib/utils";
import { platformUi } from "./platformDashboardUi";

function onboardingStatusLabel(
  status: OnboardingVerificationStatus | undefined,
  t: (key: string) => string,
): { label: string; tone: "success" | "warn" | "danger" | "muted" } {
  switch (status) {
    case "approved":
      return { label: t("admin.businessDetailPage.onboardingStatus.approved"), tone: "success" };
    case "rejected":
      return { label: t("admin.businessDetailPage.onboardingStatus.rejected"), tone: "danger" };
    case "submitted":
      return { label: t("admin.businessDetailPage.onboardingStatus.submitted"), tone: "warn" };
    case "draft":
    default:
      return { label: t("admin.businessDetailPage.onboardingStatus.draft"), tone: "muted" };
  }
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warn" | "danger" | "muted";
}) {
  const className =
    tone === "success"
      ? "inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-1 text-sm font-medium text-success-foreground"
      : tone === "danger"
        ? "inline-flex items-center gap-1 text-sm font-medium text-red-600 dark:text-red-400"
        : tone === "warn"
          ? "text-sm font-medium text-amber-600 dark:text-amber-400"
          : "text-sm font-medium text-muted-foreground";

  const Icon = tone === "success" ? CheckCircle : tone === "danger" ? XCircle : ShieldCheck;

  return (
    <span className={className}>
      <Icon className="h-4 w-4" /> {label}
    </span>
  );
}

type BusinessWorkflowVerificationPanelsProps = {
  row: PlatformBusinessRow;
  onOnboardingAction: (action: PlatformOnboardingVerificationAction) => void;
  onKycAction?: (action: never) => void;
  onReviewDocuments?: () => void;
};

export function BusinessWorkflowVerificationPanels({
  row,
  onOnboardingAction,
}: BusinessWorkflowVerificationPanelsProps) {
  const { t } = useTranslation();
  const onboarding = onboardingStatusLabel(row.onboardingVerificationStatus, t);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border/80 bg-muted/10 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("admin.businessDetailPage.sectionOnboarding")}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("admin.businessDetailPage.sectionOnboardingDesc")}
            </p>
          </div>
          <StatusBadge label={onboarding.label} tone={onboarding.tone} />
        </div>
        <div className="flex flex-wrap gap-2">
          {row.onboardingVerificationStatus !== "approved" ? (
            <button
              type="button"
              onClick={() => onOnboardingAction("approved")}
              className={cn(platformUi.btnPrimary, "px-3 py-2 text-sm")}
            >
              {t("admin.businessDetailPage.approveOnboarding")}
            </button>
          ) : null}
          {row.onboardingVerificationStatus === "submitted" ? (
            <button
              type="button"
              onClick={() => onOnboardingAction("rejected")}
              className="text-sm font-medium px-3 py-2 rounded-lg border border-destructive text-destructive hover:bg-destructive/10"
            >
              {t("admin.businessDetailPage.rejectOnboarding")}
            </button>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-border/70 bg-card p-5 text-center sm:p-6">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-muted">
          <ShieldCheck className="h-5 w-5 text-foreground" aria-hidden />
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          {t("admin.kycComingSoon.badge")}
        </span>
        <h3 className="mt-3 text-sm font-semibold text-foreground">{t("admin.kycComingSoon.title")}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("admin.kycComingSoon.body")}</p>
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          {t("common.comingSoonInDevelopment")}
        </p>
        {!MVP_KYC_ADMIN_MANAGEMENT_ENABLED ? (
          <Link
            to={`${PLATFORM_BUSINESS_BASE}/kyc-verification`}
            className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
          >
            {t("admin.kycComingSoon.learnMore")}
          </Link>
        ) : null}
      </section>
    </div>
  );
}
