import { Link } from "react-router";
import { Circle, Clock, QrCode, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { UpgradeCta } from "../subscription/UpgradeCta";
import {
  resolveQrStudioVerificationPhase,
  type QrStudioVerificationPhase,
} from "@/app/lib/businessVerificationCapabilities";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type QrStudioAccessBlockReason = "subscription" | "verification" | "both";

type QrStudioAccessPanelProps = {
  reason: QrStudioAccessBlockReason;
  onboardingVerificationStatus?: import("../../lib/api").OnboardingVerificationStatus;
  className?: string;
};

const ONBOARDING_STATUS_PATH = "/awaiting-approval";

function VerificationAccessPanel({
  phase,
  className,
}: {
  phase: QrStudioVerificationPhase;
  className?: string;
}) {
  const { t } = useTranslation();

  if (phase === "in_review") {
    return (
      <section
        className={cn(
          "relative mx-auto w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-amber-200/80 bg-gradient-to-br from-amber-50/90 via-card to-orange-50/40 p-8 text-center shadow-[0_10px_36px_-14px_rgba(217,119,6,0.18)] sm:p-10 dark:border-amber-800/40 dark:from-amber-950/35 dark:to-stone-950/20",
          className,
        )}
        aria-labelledby="qr-studio-access-verification-title"
      >
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center" aria-hidden>
          <span className="absolute inset-0 animate-pulse rounded-full bg-amber-400/15" />
          <span className="absolute inset-2 rounded-full border border-amber-300/40 bg-amber-100/50 dark:border-amber-700/40 dark:bg-amber-950/40" />
          <Clock className="relative h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>

        <span className="mt-5 inline-flex items-center gap-2 rounded-full border border-amber-300/60 bg-amber-100/80 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/50 dark:text-amber-100">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
          {t("business.qrStudio.access.verificationInReviewBadge")}
        </span>

        <h2
          id="qr-studio-access-verification-title"
          className="mt-4 text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
        >
          {t("business.qrStudio.access.verificationInReviewTitle")}
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
          {t("business.qrStudio.access.verificationInReviewBody")}
        </p>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground/90">
          {t("business.qrStudio.access.verificationInReviewLimitedAccess")}
        </p>

        <div className="mt-6">
          <Button
            asChild
            className="min-h-11 border-amber-600/20 bg-amber-600 px-6 text-white hover:bg-amber-600/90"
          >
            <Link to={ONBOARDING_STATUS_PATH}>
              {t("business.qrStudio.access.viewVerificationStatus")}
            </Link>
          </Button>
        </div>

        <p className="mx-auto mt-4 max-w-md text-xs leading-relaxed text-muted-foreground">
          {t("business.qrStudio.access.verificationInReviewSupportBefore")}{" "}
          <Link
            to="/dashboard/support"
            className="font-medium text-foreground underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-200"
          >
            {t("business.qrStudio.access.verificationInReviewSupportLink")}
          </Link>{" "}
          {t("business.qrStudio.access.verificationInReviewSupportAfter")}
        </p>
      </section>
    );
  }

  if (phase === "rejected") {
    return (
      <section
        className={cn(
          "relative mx-auto w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-destructive/20 bg-card p-8 text-center shadow-[0_10px_36px_-14px_rgba(15,23,42,0.1)] sm:p-10",
          className,
        )}
        aria-labelledby="qr-studio-access-verification-title"
      >
        <XCircle className="mx-auto h-12 w-12 text-destructive/80" aria-hidden />
        <h2
          id="qr-studio-access-verification-title"
          className="mt-5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
        >
          {t("business.qrStudio.access.verificationRejectedTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("business.qrStudio.access.verificationRejectedBody")}
        </p>
        <div className="mt-6">
          <Button asChild className="min-h-11 px-6">
            <Link to={ONBOARDING_STATUS_PATH}>{t("business.qrStudio.access.viewVerificationStatus")}</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "relative mx-auto w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-border/70 bg-card p-8 text-center shadow-[0_10px_36px_-14px_rgba(15,23,42,0.1)] sm:p-10",
        className,
      )}
      aria-labelledby="qr-studio-access-verification-title"
    >
      <ShieldCheck className="mx-auto h-12 w-12 text-primary/75" aria-hidden />
      <h2
        id="qr-studio-access-verification-title"
        className="mt-5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
      >
        {t("business.qrStudio.access.verificationTitle")}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {t("business.qrStudio.access.verificationBody")}
      </p>
      <div className="mt-6">
        <Button asChild className="min-h-11 px-6">
          <Link to={ONBOARDING_STATUS_PATH}>{t("business.qrStudio.access.continueVerification")}</Link>
        </Button>
      </div>
    </section>
  );
}

export function QrStudioAccessPanel({ reason, onboardingVerificationStatus, className }: QrStudioAccessPanelProps) {
  const { t } = useTranslation();
  const verificationPhase = resolveQrStudioVerificationPhase(onboardingVerificationStatus);

  if (reason === "subscription") {
    return (
      <section
        className={cn(
          "relative mx-auto w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-primary/12 bg-gradient-to-br from-primary/[0.06] via-card to-stone-50/80 p-8 text-center shadow-[0_12px_40px_-16px_rgba(15,23,42,0.12)] sm:p-10",
          className,
        )}
        aria-labelledby="qr-studio-access-subscription-title"
      >
        <QrCode className="mx-auto h-12 w-12 text-primary/70" aria-hidden />
        <h2
          id="qr-studio-access-subscription-title"
          className="mt-5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
        >
          {t("business.qrStudio.access.subscriptionTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("business.qrStudio.access.subscriptionBody")}
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <UpgradeCta featureKey="employeeQr" className="min-h-11" />
          <Link
            to="/dashboard/billing/subscription"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50"
          >
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            {t("business.qrStudio.access.viewPlans")}
          </Link>
        </div>
      </section>
    );
  }

  if (reason === "verification") {
    return <VerificationAccessPanel phase={verificationPhase} className={className} />;
  }

  const verificationChecklistLabel =
    verificationPhase === "in_review"
      ? t("business.qrStudio.access.checklist.verificationInReview")
      : verificationPhase === "rejected"
        ? t("business.qrStudio.access.checklist.verificationRejected")
        : t("business.qrStudio.access.checklist.verification");

  const steps = [
    { key: "subscription", label: t("business.qrStudio.access.checklist.subscription") },
    { key: "verification", label: verificationChecklistLabel },
    { key: "generate", label: t("business.qrStudio.access.checklist.generate") },
  ] as const;

  return (
    <section
      className={cn(
        "relative mx-auto w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-primary/12 bg-gradient-to-br from-primary/[0.05] via-card to-stone-50/80 p-8 shadow-[0_12px_40px_-16px_rgba(15,23,42,0.12)] sm:p-10",
        className,
      )}
      aria-labelledby="qr-studio-access-checklist-title"
    >
      <h2
        id="qr-studio-access-checklist-title"
        className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
      >
        {t("business.qrStudio.access.checklistTitle")}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t("business.qrStudio.access.checklistBody")}
      </p>
      <ol className="mt-6 space-y-3 text-left">
        {steps.map((step, index) => (
          <li
            key={step.key}
            className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/80 px-4 py-3"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {index + 1}
            </span>
            <span className="text-sm font-medium text-foreground">{step.label}</span>
            <Circle className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
          </li>
        ))}
      </ol>
      <div className="mt-6 space-y-4 border-t border-border/60 pt-6">
        <UpgradeCta featureKey="employeeQr" className="w-full sm:w-auto" />
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild variant="outline" className="min-h-11">
            <Link to={ONBOARDING_STATUS_PATH}>
              {verificationPhase === "in_review"
                ? t("business.qrStudio.access.viewVerificationStatus")
                : t("business.qrStudio.access.continueVerification")}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export function resolveQrStudioAccessBlock(
  canUseProductionQr: boolean,
): QrStudioAccessBlockReason | null {
  if (!canUseProductionQr) return "verification";
  return null;
}
