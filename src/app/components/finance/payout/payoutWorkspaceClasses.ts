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
