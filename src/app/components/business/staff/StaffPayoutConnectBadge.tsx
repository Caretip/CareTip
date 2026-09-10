import { useTranslation } from "react-i18next";
import type { EmployeePayoutConnectionState } from "../../lib/api";
import { cn } from "@/lib/utils";

const TONE: Record<EmployeePayoutConnectionState, string> = {
  connected:
    "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-100 dark:ring-emerald-800/60",
  setup_required:
    "bg-amber-50 text-amber-950 ring-1 ring-amber-200/80 dark:bg-amber-950/35 dark:text-amber-100 dark:ring-amber-800/50",
  action_required:
    "bg-amber-50 text-amber-950 ring-1 ring-amber-200/80 dark:bg-amber-950/35 dark:text-amber-100 dark:ring-amber-800/50",
  restricted:
    "bg-red-50 text-red-900 ring-1 ring-red-200/80 dark:bg-red-950/40 dark:text-red-100 dark:ring-red-800/60",
  not_connected:
    "bg-muted text-muted-foreground ring-1 ring-border",
};

export function StaffPayoutConnectBadge({
  state,
}: {
  state: EmployeePayoutConnectionState | undefined;
}) {
  const { t } = useTranslation();
  const key = state ?? "not_connected";
  return (
    <span
      className={cn(
        "mt-1 inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-medium leading-tight",
        TONE[key],
      )}
    >
      {t("business.staffPage.payoutAccount")}: {t(`business.staffPage.payoutState.${key}`)}
    </span>
  );
}
