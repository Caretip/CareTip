/**
 * Global CTA tokens — aligned with landing hero/section buttons (mobile + desktop).
 */
import { cn } from "@/lib/utils";

const caretipBtnBase = [
  "inline-flex shrink-0 touch-manipulation items-center justify-center gap-2",
  "whitespace-nowrap rounded-lg font-sans !leading-none tracking-tight",
  "transition-[box-shadow,background-color,border-color,opacity] duration-200 ease-out",
  "active:opacity-[0.96]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e9781c]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "disabled:pointer-events-none disabled:opacity-50",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0",
].join(" ");

/** Mobile: h-11 px-7 · Desktop (lg+): h-12 px-8 · 15px bold */
export const caretipBtnSizePrimary =
  "h-11 min-h-11 px-7 text-[0.9375rem] font-bold lg:h-12 lg:min-h-12 lg:px-8";

/** Secondary — same heights, slightly less horizontal padding */
export const caretipBtnSizeSecondary =
  "h-11 min-h-11 px-6 text-[0.9375rem] font-semibold lg:h-12 lg:min-h-12 lg:px-6";

/** Nav / compact toolbar */
export const caretipBtnSizeCompact = "h-10 min-h-10 px-4 text-sm font-bold";

export const caretipBtnPrimary = cn("caretip-btn-primary", caretipBtnBase, caretipBtnSizePrimary, "text-white");

export const caretipBtnPrimaryCompact = cn(
  "caretip-btn-primary caretip-btn-primary--compact",
  caretipBtnBase,
  caretipBtnSizeCompact,
  "text-white",
);

export const caretipBtnSecondary = cn(
  "caretip-btn-secondary",
  caretipBtnBase,
  caretipBtnSizeSecondary,
  "border border-neutral-300/80 bg-white text-neutral-700",
  "shadow-[0_1px_3px_rgba(17,17,17,0.05)]",
  "hover:border-neutral-400/90 hover:bg-neutral-50 hover:text-neutral-900",
  "hover:shadow-[0_2px_8px_rgba(17,17,17,0.07)]",
  "dark:border-neutral-600/90 dark:bg-neutral-900/55 dark:text-neutral-200",
  "dark:hover:border-neutral-500 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-50",
);

/** Ghost / tertiary — no border, muted fill on hover */
export const caretipBtnGhost = cn(
  "caretip-btn-ghost",
  caretipBtnBase,
  caretipBtnSizeSecondary,
  "border border-transparent bg-transparent text-foreground",
  "hover:border-neutral-200/80 hover:bg-neutral-100 hover:text-neutral-900",
  "dark:hover:border-neutral-700/80 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-50",
);

/** Full-width primary (customer flows, auth submit) */
export const caretipBtnPrimaryFull = cn(caretipBtnPrimary, "w-full");

export const caretipBtnSecondaryFull = cn(caretipBtnSecondary, "w-full");

/** Legacy landing class alias */
export const caretipCtaPrimary = caretipBtnPrimary;
export const caretipCtaPrimaryCompact = caretipBtnPrimaryCompact;
