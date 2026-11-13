import { useTranslation } from "react-i18next";
import type { KycVerificationStatus, OnboardingVerificationStatus, PlatformBusinessOperationalStatus } from "../../lib/api";
import { kycStatusLabel, onboardingStatusLabel } from "../../lib/verificationWorkflowUi";
import { cn } from "@/lib/utils";

type ChipTone = "success" | "warn" | "danger" | "muted";

function toneClass(tone: ChipTone): string {
  switch (tone) {
    case "success":
      return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200";
    case "danger":
      return "bg-destructive/15 text-red-700 dark:text-destructive";
    case "warn":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function onboardingTone(status: OnboardingVerificationStatus | null | undefined): ChipTone {
  switch (status ?? "draft") {
    case "approved":
      return "success";
    case "rejected":
      return "danger";
    case "submitted":
      return "warn";
    default:
      return "muted";
  }
}

function kycTone(status: KycVerificationStatus | null | undefined): ChipTone {
  switch (status ?? "not_started") {
    case "verified":
      return "success";
    case "rejected":
      return "danger";
    case "pending_review":
    case "awaiting_upload":
      return "warn";
    default:
      return "muted";
  }
}

export function OnboardingVerificationStatusChip({
  status,
  className,
}: {
  status: OnboardingVerificationStatus | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
        toneClass(onboardingTone(status)),
        className,
      )}
    >
      {onboardingStatusLabel(status, t)}
    </span>
  );
}

export function KycVerificationStatusChip({
  status,
  className,
}: {
  status: KycVerificationStatus | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
        toneClass(kycTone(status)),
        className,
      )}
    >
      {kycStatusLabel(status, t)}
    </span>
  );
}

function operationalTone(status: PlatformBusinessOperationalStatus | null | undefined): ChipTone {
  switch (status ?? "active") {
    case "active":
      return "success";
    case "suspended":
      return "warn";
    case "inactive":
      return "danger";
    default:
      return "muted";
  }
}

export function BusinessOperationalStatusChip({
  status,
  className,
}: {
  status: PlatformBusinessOperationalStatus | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const key =
    status === "suspended"
      ? "admin.allBusinessesPage.operationalStatus.suspended"
      : status === "inactive"
        ? "admin.allBusinessesPage.operationalStatus.inactive"
        : "admin.allBusinessesPage.operationalStatus.active";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
        toneClass(operationalTone(status)),
        className,
      )}
    >
      {t(key)}
    </span>
  );
}
