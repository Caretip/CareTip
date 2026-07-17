import { Link, useLocation } from "react-router";
import { ArrowRight, Clock, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getBusinessVerificationNoticeLabels,
  shouldSuppressLayoutVerificationBanner,
} from "../../lib/businessVerificationNotice";
import { useBusinessVerificationNotice } from "../../hooks/useBusinessVerificationNotice";
import { cn } from "@/lib/utils";

/**
 * Soft banner while platform onboarding review is pending or rejected.
 * KYC status does not trigger this banner — see dashboard status bar "Coming soon".
 */
export function VerificationPendingBanner({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { show, rejected } = useBusinessVerificationNotice();

  if (!show || shouldSuppressLayoutVerificationBanner(pathname)) {
    return null;
  }

  const labels = getBusinessVerificationNoticeLabels(t, rejected);

  return (
    <div
      className={cn(
        "business-verification-bar relative z-20 border-b bg-white px-4 py-3 dark:bg-zinc-950",
        rejected ? "border-destructive/20" : "border-border/80",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn(
              "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
              rejected
                ? "border-destructive/20 bg-destructive/5 text-destructive"
                : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
            )}
            aria-hidden
          >
            {rejected ? <ShieldAlert className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-tight text-foreground">{labels.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-[13px]">
              {labels.description}
            </p>
          </div>
        </div>
        <Link
          to="/awaiting-approval"
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-muted sm:self-center"
        >
          {labels.cta}
          <ArrowRight className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
