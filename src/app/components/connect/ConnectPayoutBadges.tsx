import { useTranslation } from "react-i18next";
import type { ConnectPayoutReconciliationStatus, ConnectPayoutStatus } from "../../lib/api";
import { reconStatusI18nKey, payoutStatusI18nKey } from "../../lib/connectPayoutDisplay";
import { cn } from "@/lib/utils";

function statusDotClass(status: ConnectPayoutStatus | string): string {
  if (status === "paid") return "bg-emerald-700 dark:bg-emerald-400";
  if (status === "failed") return "bg-red-700 dark:bg-red-400";
  if (status === "canceled") return "bg-neutral-500";
  if (status === "unknown") return "bg-neutral-400";
  return "bg-amber-700 dark:bg-amber-400";
}

function statusTextClass(status: ConnectPayoutStatus | string): string {
  if (status === "paid") return "font-semibold text-foreground";
  if (status === "failed") return "font-semibold text-red-800 dark:text-red-200";
  if (status === "canceled") return "font-medium text-muted-foreground";
  if (status === "unknown") return "font-medium text-muted-foreground";
  return "font-semibold text-foreground";
}

export function payoutStatusClass(status: ConnectPayoutStatus | string): string {
  return statusTextClass(status);
}

export function reconStatusClass(status: ConnectPayoutReconciliationStatus | string | undefined): string {
  if (status === "complete") return "font-medium text-foreground";
  if (status === "failed") return "font-medium text-red-800 dark:text-red-200";
  if (status === "partial") return "font-medium text-foreground";
  return "font-medium text-muted-foreground";
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
    <span className={cn("inline-flex items-center gap-2 text-sm", statusTextClass(status), className)}>
      <span className={cn("size-2 shrink-0 rounded-full", statusDotClass(status))} aria-hidden />
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
    <span className={cn("inline-flex text-sm", reconStatusClass(status), className)}>
      <span className="sr-only">{t("business.billing.payouts.colReconciliation")}: </span>
      {label}
      {count}
    </span>
  );
}
