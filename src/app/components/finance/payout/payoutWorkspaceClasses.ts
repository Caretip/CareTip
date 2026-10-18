import { cn } from "@/lib/utils";

export const payoutWorkspaceRoot = "caretip-payout-workspace";

export function payoutWorkspacePanelClass(className?: string) {
  return cn("caretip-payout-panel", className);
}

export function payoutWorkspacePanelPadding(className?: string) {
  return cn("p-4 sm:p-5", className);
}

export function payoutWorkspaceLedgerToolbar(className?: string) {
  return cn("caretip-payout-ledger-toolbar", className);
}

/** Two-up frequency choices. Selected state uses the brand accent and radio semantics. */
export const payoutScheduleOptionGrid =
  "grid grid-cols-2 gap-2 text-left";

export const payoutScheduleOptionButton =
  "min-h-11 rounded-md border px-3 py-2 text-left text-sm font-semibold leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

export function payoutScheduleOptionState(selected: boolean) {
  return selected
    ? "border-primary bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary))]"
    : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground";
}
