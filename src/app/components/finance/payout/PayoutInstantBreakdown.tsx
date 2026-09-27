import { cn } from "@/lib/utils";

export function PayoutInstantBreakdown({
  grossLabel,
  grossValue,
  feeLabel,
  feeValue,
  netLabel,
  netValue,
  showFee,
  className,
}: {
  grossLabel: string;
  grossValue: string;
  feeLabel: string;
  feeValue: string;
  netLabel: string;
  netValue: string;
  showFee: boolean;
  className?: string;
}) {
  return (
    <div className={cn("caretip-payout-breakdown", className)}>
      <div className="caretip-payout-breakdown__row">
        <span className="min-w-0 text-muted-foreground">{grossLabel}</span>
        <span className="shrink-0 tabular-nums text-foreground">{grossValue}</span>
      </div>
      {showFee ? (
        <div className="caretip-payout-breakdown__row">
          <span className="min-w-0 text-muted-foreground">{feeLabel}</span>
          <span className="shrink-0 tabular-nums text-red-700 dark:text-red-300">−{feeValue}</span>
        </div>
      ) : null}
      <div className={cn("caretip-payout-breakdown__row", "caretip-payout-breakdown__net")}>
        <span className="min-w-0">{netLabel}</span>
        <span className="shrink-0 tabular-nums">{netValue}</span>
      </div>
    </div>
  );
}
