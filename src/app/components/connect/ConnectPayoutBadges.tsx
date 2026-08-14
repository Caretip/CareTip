import { useTranslation } from "react-i18next";
import type { ConnectPayoutReconciliationStatus, ConnectPayoutStatus } from "../../lib/api";
import { reconStatusI18nKey, payoutStatusI18nKey } from "../../lib/connectPayoutDisplay";
import { cn } from "@/lib/utils";

export function payoutStatusClass(status: ConnectPayoutStatus | string): string {
  if (status === "paid") return "bg-success/15 text-success dark:bg-success/25";
  if (status === "failed" || status === "canceled") {
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  }
  if (status === "unknown") return "bg-muted text-muted-foreground";
  return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
}

export function reconStatusClass(status: ConnectPayoutReconciliationStatus | string | undefined): string {
  if (status === "complete") return "bg-success/15 text-success dark:bg-success/25";
  if (status === "failed") return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  if (status === "partial") return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
  return "bg-muted text-muted-foreground";
}

export function ConnectPayoutStatusBadge({
  status,
  className,
}: {
  status: ConnectPayoutStatus | string;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = t(payoutStatusI18nKey(status), { defaultValue: status });
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        payoutStatusClass(status),
        className,
      )}
    >
      <span className="sr-only">{t("business.billing.payouts.colStatus")}: </span>
      {label}
    </span>
  );
}

export function ConnectPayoutReconBadge({
  status,
  lineCount,
  className,
}: {
  status: ConnectPayoutReconciliationStatus | string | undefined;
  lineCount?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = t(reconStatusI18nKey(status), { defaultValue: status ?? "pending" });
  const count = lineCount && lineCount > 0 ? ` · ${lineCount}` : "";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        reconStatusClass(status),
        className,
      )}
    >
      <span className="sr-only">{t("business.billing.payouts.colReconciliation")}: </span>
      {label}
      {count}
    </span>
  );
}
