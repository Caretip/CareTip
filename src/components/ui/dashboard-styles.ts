import { cn } from "@/lib/utils";

/**
 * Dashboard style tokens.
 * Goal: consistent, premium UI without changing layout/data flow.
 */

// General panels/containers (non-metric cards).
export const DASH_PANEL_BASE = "rounded-xl bg-white";

// Stat/metric cards only.
export const DASH_STAT_CARD_BASE =
  "rounded-xl bg-white border border-black/[0.06] shadow-sm p-6";

export const DASH_SECTION_SPACING = "mt-8 mb-8";
export const DASH_GRID_GAP = "gap-4 sm:gap-6";

export const DASH_ICON_WRAP =
  "flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary";

export const DASH_BADGE =
  "inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white px-3 py-1 text-xs font-semibold text-foreground";

export const DASH_EMPTY_STATE =
  "flex flex-col items-center justify-center text-center text-gray-500";
export const DASH_EMPTY_ICON = "mb-3 h-9 w-9 opacity-20";

export const DASH_BTN_PRIMARY =
  "bg-primary text-primary-foreground shadow-[0_6px_18px_rgba(235,153,44,0.28)] hover:shadow-[0_8px_22px_rgba(235,153,44,0.32)] hover:bg-primary/90";
export const DASH_BTN_SECONDARY =
  "border-black/[0.10] bg-white text-foreground hover:bg-muted";

export function dashPanel(className?: string) {
  return cn(DASH_PANEL_BASE, className);
}

export function dashStatCard(className?: string) {
  return cn(DASH_STAT_CARD_BASE, className);
}

