/**
 * Shared layout tokens for public marketing pages — aligned with landing rhythm.
 */
import { caretipBtnPrimary } from "@/lib/caretipButtonSystem";

export const publicPageUi = {
  page:
    "caretip-public-page caretip-marketing-page relative min-h-[100dvh] w-full min-w-0 overflow-x-hidden bg-background font-sans",
  shell: "relative z-10 min-w-0",
  main:
    "mx-auto w-full min-w-0 max-w-[100rem] px-4 pb-16 pt-[calc(4.75rem+env(safe-area-inset-top,0px))] sm:px-6 sm:pb-20 lg:px-8 lg:pb-24 lg:pt-[calc(5.25rem+env(safe-area-inset-top,0px))]",
  backLink:
    "caretip-public-back-link group inline-flex w-fit cursor-pointer items-center gap-2 rounded-md py-0.5 text-sm font-semibold text-muted-foreground underline-offset-[0.2em] transition-[color,transform] duration-200 ease-out hover:-translate-x-0.5 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  header: "caretip-public-page-header space-y-5 sm:space-y-6",
  title: "font-hero-display text-section-title font-bold text-foreground",
  subtitle:
    "caretip-marketing-lead max-w-[min(100%,36rem)] text-body-copy leading-[1.72] text-muted-foreground sm:max-w-[min(100%,38rem)]",
  sectionGap: "mt-12 sm:mt-16 lg:mt-20",
  card:
    "caretip-marketing-card rounded-lg border border-border/80 bg-card",
  cardPad: "p-6 sm:p-7",
  insetPanel:
    "rounded-xl border border-border/70 bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground",
  sectionTitle: "font-hero-display text-section-title font-bold text-foreground",
  cardInteractive:
    "transition-[border-color] duration-200 hover:border-foreground/25",
  mutedBand:
    "rounded-lg border border-border/50 bg-secondary/40 px-1 py-6 sm:px-2 sm:py-8",
  ctaPanel:
    "rounded-lg border border-border/80 bg-card p-6 text-center sm:p-8",
  ctaPrimary: `${caretipBtnPrimary} no-underline`,
  trustChip:
    "inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground",
  trustChipDot: "h-1.5 w-1.5 shrink-0 rounded-full bg-primary",
  proseWrap: "mx-auto max-w-4xl",
  wideWrap: "mx-auto max-w-5xl",
  pricingWrap: "mx-auto max-w-7xl",
  /** Shared marketing section typography */
  marketingSectionTitle:
    "caretip-public-marketing-section-title text-[clamp(1.35rem,3vw,1.85rem)] font-semibold tracking-[-0.02em] text-foreground",
  marketingSectionSubtitle:
    "caretip-public-marketing-section-subtitle text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]",
  /** Legal / policy pages */
  legalProse:
    "caretip-legal-prose prose max-w-none text-muted-foreground prose-headings:font-hero-display prose-headings:font-bold prose-headings:tracking-[-0.02em] prose-headings:text-foreground prose-p:leading-relaxed prose-li:leading-relaxed prose-strong:text-foreground",
  legalFooter: "border-t border-border/80 pt-6 not-prose",
  legalFooterText: "text-sm text-muted-foreground",
  legalFooterStrong: "font-semibold text-foreground",
  legalInsetTitle: "mb-2 text-lg font-semibold text-foreground",
  miniCard: "rounded-lg border border-border/70 bg-card p-3 text-center",
  miniCardTitle: "mb-1 text-xs font-semibold text-foreground",
  miniCardSubtitle: "text-xs text-muted-foreground",
} as const;
