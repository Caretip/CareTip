import { cn } from "@/lib/utils";

export type FinanceStatusTone = "success" | "warning" | "neutral" | "danger";

const DOT: Record<FinanceStatusTone, string> = {
  success: "bg-emerald-600 dark:bg-emerald-400",
  warning: "bg-amber-500 dark:bg-amber-400",
  danger: "bg-red-600 dark:bg-red-400",
  neutral: "bg-muted-foreground/50",
};

export function FinanceStatusDot({
  tone,
  label,
  className,
}: {
  tone: FinanceStatusTone;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} aria-hidden />
      {label}
    </span>
  );
}
