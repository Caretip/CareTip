import "@/styles/bundles/onboarding.css";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertCircle, Clock } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { BusinessOnboardingRail } from "../../components/business/BusinessOnboardingShell";
import { onboardingHeadline, onboardingSubhead } from "../../components/business/businessOnboardingUi";
import { cn } from "@/lib/utils";

/** Informational page — not a dashboard gate. Managers can open the dashboard while onboarding is reviewed. */
export function BusinessAwaitingApprovalPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const status = user?.onboardingVerificationStatus;
  const isRejected = status === "rejected";

  return (
    <div className="business-onboarding-page business-onboarding-layout flex min-h-screen flex-col">
      <BusinessOnboardingRail step={3} />

      <main className="business-onboarding-main flex-1">
        <div className="business-onboarding-shell business-onboarding-awaiting w-full">
          <span
            className={cn(
              "business-onboarding-awaiting__badge",
              isRejected && "business-onboarding-awaiting__badge--rejected",
            )}
          >
            {isRejected ? (
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            {isRejected
              ? t("business.awaitingApproval.badgeRejected")
              : t("business.awaitingApproval.badgePending")}
          </span>

          <h1 className={cn(onboardingHeadline, "mt-5")}>
            {isRejected
              ? t("business.awaitingApproval.titleRejected")
              : t("business.awaitingApproval.titlePending")}
          </h1>

          <p className={cn(onboardingSubhead, "mt-3")}>
            {isRejected
              ? t("business.awaitingApproval.descRejected")
              : t("business.awaitingApproval.descPending")}
          </p>

          {!isRejected ? (
            <p className="business-onboarding-awaiting__note">
              {t("business.awaitingApproval.limitedFeaturesNote")}
            </p>
          ) : null}

          <div className="business-onboarding-awaiting__actions">
            <Link to="/dashboard" className="caretip-btn-primary inline-flex items-center justify-center px-5 text-[15px] font-semibold">
              {t("business.awaitingApproval.goToDashboard")}
            </Link>
            <Link to="/dashboard/settings" className="business-onboarding-awaiting__secondary">
              {isRejected
                ? t("business.awaitingApproval.reviewProfile")
                : t("business.awaitingApproval.viewVerificationStatus")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
