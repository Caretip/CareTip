/** Shared empty-state layout — dashboards, tables, and panels. */
export const emptyStateUi = {
  wrap:
    "caretip-empty-state flex flex-col items-center justify-center px-4 py-10 text-center sm:px-6 sm:py-12 md:py-14",
  icon:
    "caretip-empty-state__icon mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border/80 bg-muted/40 text-muted-foreground shadow-sm",
  title: "caretip-empty-state__title font-sans text-card-title font-semibold tracking-tight text-foreground",
  description:
    "caretip-empty-state__description mt-2 max-w-sm font-sans text-small-body text-muted-foreground text-pretty",
  action: "caretip-empty-state__action mt-6",
  compact: "caretip-empty-state--compact !py-8 sm:!py-10",
} as const;
