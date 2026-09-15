import { useTranslation } from "react-i18next";
import type { EmployeePayoutConnectionState } from "../../../lib/api";
import { cn } from "@/lib/utils";

type IndicatorKey = "connected" | "not_connected" | "action_required";

function indicatorKey(state: EmployeePayoutConnectionState | undefined): IndicatorKey {
  if (state === "connected") return "connected";
  if (state === "not_connected" || state == null) return "not_connected";
  return "action_required";
}

const DOT: Record<IndicatorKey, string> = {
  connected: "bg-emerald-500",
  not_connected: "bg-neutral-400 dark:bg-neutral-500",
  action_required: "bg-amber-500",
};

export function StaffPayoutConnectBadge({
  state,
}: {
  state: EmployeePayoutConnectionState | undefined;
}) {
  const { t } = useTranslation();
  const key = indicatorKey(state);
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-xs font-normal leading-tight text-muted-foreground">
      <span className={cn("inline-block size-1.5 shrink-0 rounded-full", DOT[key])} aria-hidden />
      {t(`business.staffPage.payoutIndicator.${key}`)}
    </p>
  );
}
