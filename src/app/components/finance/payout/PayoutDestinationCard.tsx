import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PayoutDestinationCard({
  sectionTitle,
  methodLabel,
  defaultBadgeLabel,
  maskedDisplay,
  ariaLabel,
  changeAction,
  className,
}: {
  sectionTitle?: string;
  methodLabel: string;
  defaultBadgeLabel: string;
  maskedDisplay: string;
  ariaLabel: string;
  changeAction?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("caretip-payout-destination", className)} aria-label={ariaLabel}>
      {sectionTitle ? (
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{sectionTitle}</p>
      ) : null}
      <div className={cn("flex min-w-0 flex-wrap items-start justify-between gap-2", sectionTitle ? "mt-2" : "")}>
        <p className="min-w-0 text-sm font-medium text-foreground">{methodLabel}</p>
        <span
          className="shrink-0 rounded-md border border-border/80 bg-background px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {defaultBadgeLabel}
        </span>
      </div>
      <p className="caretip-payout-destination__masked text-foreground">{maskedDisplay}</p>
      {changeAction ? <div className="mt-3 min-w-0">{changeAction}</div> : null}
    </div>
  );
}
