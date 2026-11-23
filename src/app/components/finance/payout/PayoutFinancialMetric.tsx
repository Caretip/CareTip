import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PayoutFinancialMetric({
  label,
  value,
  hint,
  detail,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Extra content under the hint, e.g. pending release dates. */
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("caretip-payout-metric", className)}>
      <p className="caretip-payout-metric__label">{label}</p>
      <p className="caretip-payout-metric__value text-foreground">{value}</p>
      {hint ? <p className="caretip-payout-metric__hint">{hint}</p> : null}
      {detail}
    </div>
  );
}

export function PayoutFinancialMetricStrip({
  children,
  className,
  "aria-busy": ariaBusy,
}: {
  children: ReactNode;
  className?: string;
  "aria-busy"?: boolean;
}) {
  return (
    <div className={cn("caretip-payout-metric-strip", className)} aria-busy={ariaBusy}>
      {children}
    </div>
  );
}
