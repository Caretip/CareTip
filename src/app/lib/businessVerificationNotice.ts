import type { TFunction } from "i18next";
import type { OnboardingVerificationStatus } from "./api";
import type { User } from "../hooks/useAuth";

/** Business dashboard home — inline onboarding review card; layout banner is suppressed here. */
export const BUSINESS_VERIFICATION_INLINE_ROUTE = "/dashboard";

export type BusinessVerificationNoticeState = {
  show: boolean;
  rejected: boolean;
  pending: boolean;
};

type NoticeUser = Pick<User, "role" | "impersonation" | "onboardingVerificationStatus"> | null | undefined;

function isOnboardingReviewPending(status: OnboardingVerificationStatus | undefined): boolean {
  return status === "submitted";
}

/** Onboarding review banner only — KYC does not trigger layout notices. */
export function resolveBusinessVerificationNoticeState(
  user: NoticeUser,
): BusinessVerificationNoticeState {
  if (!user || user.role !== "business" || user.impersonation) {
    return { show: false, rejected: false, pending: false };
  }

  const status = user.onboardingVerificationStatus;
  const rejected = status === "rejected";
  const pending = isOnboardingReviewPending(status);
  return {
    show: pending || rejected,
    rejected,
    pending,
  };
}

/** Routes that already own the verification UX — suppress the layout banner. */
export function shouldSuppressLayoutVerificationBanner(pathname: string): boolean {
  return pathname === "/awaiting-approval" || pathname.startsWith("/awaiting-approval/");
}

export function getBusinessVerificationNoticeLabels(t: TFunction, rejected: boolean) {
  return {
    title: rejected
      ? t("business.dashboard.onboardingReviewBannerRejectedTitle")
      : t("business.dashboard.onboardingReviewBannerTitle"),
    description: rejected
      ? t("business.dashboard.onboardingReviewBannerRejectedDesc")
      : t("business.dashboard.onboardingReviewBannerDesc"),
    cta: t("business.dashboard.onboardingReviewBannerCta"),
  };
}
