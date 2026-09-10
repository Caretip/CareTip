import { cn } from "@/lib/utils";
import type { FinanceStatusTone } from "./FinanceStatusDot";

const PILL: Record<FinanceStatusTone, string> = {
  success: "bg-emerald-600/10 text-emerald-800 dark:text-emerald-200",
  warning: "bg-amber-500/15 text-amber-900 dark:text-amber-200",
  danger: "bg-red-600/10 text-red-800 dark:text-red-200",
  neutral: "bg-muted text-muted-foreground",
};

export function FinanceStatusPill({
  tone,
  label,
  className,
}: {
  tone: FinanceStatusTone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide",
        PILL[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
