import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import type { EmployeeAnalyticsBundle } from "../../lib/api";
import { resolveBusinessTimezone } from "../../lib/businessVenueTime";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import {
  deriveEmployeeTransferStatus,
  type EmployeeTransferStatusTone,
} from "./employeeTransferStatusPresentation";

type Props = {
  reconciliation: EmployeeAnalyticsBundle["reconciliation"];
  businessTimezone?: string;
  lastFetchedAt: number | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  className?: string;
};

function toneStyles(tone: EmployeeTransferStatusTone): string {
  switch (tone) {
    case "positive":
      return "border-emerald-500/25 bg-emerald-500/5";
    case "warning":
      return "border-amber-500/30 bg-amber-500/5";
    case "neutral":
    default:
      return "border-border bg-muted/30";
  }
}

function ToneIcon({ tone }: { tone: EmployeeTransferStatusTone }) {
  switch (tone) {
    case "positive":
      return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />;
    case "warning":
      return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />;
    case "neutral":
    default:
      return <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
}

export function EmployeeTransferStatusCard({
  reconciliation,
  businessTimezone,
  lastFetchedAt,
  refreshing = false,
  onRefresh,
  className,
}: Props) {
  const { t, i18n } = useTranslation();
  const view = useMemo(
    () => deriveEmployeeTransferStatus(reconciliation),
    [reconciliation],
  );

  const locale = i18n.resolvedLanguage ?? "en";
  const message = view.messageParams
    ? t(view.messageKey, view.messageParams)
    : t(view.messageKey);

  const formatShortTime = (msOrIso: number | string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: resolveBusinessTimezone(businessTimezone),
      timeStyle: "short",
    }).format(typeof msOrIso === "number" ? new Date(msOrIso) : new Date(msOrIso));

  const lastCheckedLabel =
    lastFetchedAt != null
      ? t("employee.analytics.transferStatus.lastChecked", {
          time: formatShortTime(lastFetchedAt),
        })
      : null;

  const confirmedAtLabel =
    view.kind === "transfer_confirmed" && view.confirmedTransferAt
      ? t("employee.analytics.transferStatus.confirmedAt", {
          time: formatShortTime(view.confirmedTransferAt),
        })
      : null;

  return (
    <div
      className={cn(
        "employee-transfer-status flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
        toneStyles(view.tone),
        className,
      )}
      data-transfer-status={view.kind}
    >
      <ToneIcon tone={view.tone} />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{t(view.titleKey)}</p>
        <p className="text-muted-foreground break-words">{message}</p>
        {confirmedAtLabel ? (
          <p className="mt-1 text-xs text-muted-foreground break-words">{confirmedAtLabel}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {lastCheckedLabel ? (
            <p className="text-xs text-muted-foreground tabular-nums">{lastCheckedLabel}</p>
          ) : null}
          {onRefresh ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-0 py-0 text-xs text-primary hover:bg-transparent"
              onClick={onRefresh}
              disabled={refreshing}
              aria-busy={refreshing || undefined}
            >
              <RefreshCw
                className={cn("mr-1 inline h-3 w-3", refreshing && "animate-spin")}
                aria-hidden
              />
              {refreshing
                ? t("employee.analytics.transferStatus.refreshing")
                : t("employee.analytics.transferStatus.refreshStatus")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
