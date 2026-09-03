/**
 * Public customer tipping journey — conversion-first presentation tokens.
 * Presentation only — no flow or payment logic.
 */
import "@/styles/bundles/customer.css";

import { cn } from "@/lib/utils";
import {
  caretipBtnPrimary,
  caretipBtnSecondary,
} from "@/lib/caretipButtonSystem";

const quietSurface =
  "overflow-hidden rounded-lg border border-border/70 bg-card";

export const customerFlowUi = {
  page: "customer-flow min-h-screen bg-background",
  pageWithBottomCta: "customer-flow min-h-screen bg-background pb-28 sm:pb-32",

  stickyHeader:
    "sticky top-0 z-20 border-b border-border/70 bg-background/95",

  headerInner:
    "caretip-container flex min-w-0 items-center gap-3 py-3.5 sm:gap-4 sm:py-4",

  customerJourneyHeader: "caretip-container customer-journey-header pt-6 pb-4 sm:pt-6 sm:pb-4",
  customerJourneyToolbar:
    "customer-journey-toolbar mb-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2",
  customerJourneyToolbarSide: "flex min-w-0 items-center",
  customerJourneyVenueRow: "flex min-w-0 items-center gap-3 sm:gap-3.5",
  customerJourneyVenueName:
    "customer-journey-venue-name text-balance text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-[1.375rem]",
  customerJourneyVenueTagline:
    "mt-0.5 text-xs font-medium leading-snug text-muted-foreground/85 sm:text-[0.8125rem]",
  customerJourneyVenueContext: "mt-1 text-xs leading-snug text-muted-foreground sm:text-[0.8125rem]",
  customerJourneyStepTitle: "mt-4 text-sm font-medium leading-snug text-foreground/90 sm:text-[0.9375rem]",
  customerJourneyEmployee: "mt-2 text-sm font-semibold leading-snug text-foreground sm:text-[0.9375rem]",
  customerJourneyTrustWrap: "mt-2.5 sm:mt-3",
  customerJourneyTrust:
    "inline-flex max-w-full items-center gap-1.5 text-xs font-normal leading-snug text-muted-foreground/70",

  customerJourneyAttribution:
    "flex w-full flex-col items-center justify-center gap-2 px-1 py-2 text-center sm:flex-row sm:gap-2.5",
  customerJourneyAttributionCompact:
    "inline-flex items-center justify-center gap-2 text-center",
  customerJourneyAttributionLabel: "text-xs font-medium leading-snug text-muted-foreground/80 sm:text-[0.8125rem]",
  customerJourneyAttributionFooter:
    "caretip-container mx-auto max-w-xl pb-8 pt-1 sm:pb-10",

  customerJourneyContent: "min-w-0 pt-4",
  customerJourneyTitle:
    "customer-journey-title text-balance text-lg font-semibold leading-tight tracking-tight text-foreground sm:text-xl",
  customerJourneySubtitle: "mt-4 text-sm leading-snug text-muted-foreground sm:text-[0.9375rem]",

  headline:
    "min-w-0 truncate text-base font-semibold tracking-tight text-foreground sm:text-lg",
  subline: "text-xs leading-snug text-muted-foreground sm:text-[0.8125rem]",

  backButton:
    "inline-flex shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background px-2.5 py-2 text-sm font-semibold text-foreground sm:px-3",

  main: "caretip-container mx-auto max-w-xl space-y-5 py-5 sm:space-y-5 sm:py-8",
  mainCompact: "caretip-container mx-auto max-w-xl space-y-4 py-4 sm:space-y-4 sm:py-7",

  fixedBottomBar:
    "fixed bottom-0 left-0 right-0 z-30 border-t border-border/70 bg-background/96",
  fixedBottomInner:
    "caretip-container mx-auto flex max-w-xl justify-center px-4 py-3.5 sm:px-6 sm:py-4",
  journeyCtaStack: "flex w-full max-w-sm flex-col gap-3",

  card: quietSurface,

  cardMuted: cn(quietSurface, "bg-muted/30"),

  cardAccentWash: quietSurface,

  cardShadcn: quietSurface,

  cardSearchLight: cn(quietSurface, "bg-muted/20"),

  cardHeaderPadding: "px-5 pb-2.5 pt-5 sm:px-6 sm:pb-3 sm:pt-5",
  cardTitle: "text-[0.9375rem] font-semibold tracking-tight text-foreground sm:text-base",
  cardDesc: "text-sm leading-relaxed text-muted-foreground",

  employeeCard:
    "customer-flow-employee-card flex w-full flex-col items-center gap-3 rounded-lg border border-border/70 bg-card p-4 text-center sm:gap-3.5 sm:p-5",
  employeeCardSelected:
    "border-primary bg-primary/[0.06] ring-1 ring-primary/25",
  employeeAvatar:
    "h-[5.5rem] w-[5.5rem] ring-[3px] ring-border sm:h-24 sm:w-24",

  employeeSummaryCard: cn(quietSurface, "customer-flow-employee-summary"),
  employeeSummaryAvatar:
    "h-[4.25rem] w-[4.25rem] shrink-0 ring-[3px] ring-border sm:h-[4.5rem] sm:w-[4.5rem]",

  selectableTile:
    "min-h-[6.25rem] rounded-lg border p-4 text-left sm:min-h-[6.75rem]",
  selectableIdle:
    "border-border/70 bg-card hover:border-foreground/25 dark:bg-card",
  selectableOn:
    "border-primary bg-primary/[0.06] ring-1 ring-primary/20",

  tipPresetTile:
    "customer-flow-tip-preset flex min-h-[4.75rem] flex-col justify-center rounded-lg border p-3.5 text-left sm:min-h-[5.25rem] sm:p-4",
  tipPresetIdle:
    "border-border/70 bg-card hover:border-foreground/25",
  tipPresetOn:
    "border-primary bg-primary/[0.06] ring-1 ring-primary/20",

  inputField:
    "w-full rounded-lg border border-border bg-background px-4 py-3.5 text-foreground placeholder:text-muted-foreground focus-visible:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",

  inputAmount:
    "w-full rounded-lg border border-border bg-background py-4 pl-11 pr-4 text-3xl font-bold tabular-nums text-foreground placeholder:text-muted-foreground focus-visible:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",

  dashedCustomTrigger:
    "w-full rounded-lg border border-dashed border-border bg-muted/20 py-6 hover:border-primary/35",

  btnPrimaryLg: cn(caretipBtnPrimary, "w-full sm:max-w-sm"),
  btnSecondaryLg: cn(caretipBtnSecondary, "w-full sm:max-w-sm"),
  btnAccentLg: cn(caretipBtnPrimary, "w-full sm:max-w-sm", "customer-flow-pay-cta"),

  paymentSummary:
    "customer-flow-payment-summary overflow-hidden rounded-lg border border-border/70 bg-card",
  paymentAmountDisplay:
    "text-[1.875rem] font-bold tabular-nums tracking-tight text-foreground sm:text-[2.25rem]",
  paymentAmountLabel: "text-sm font-medium text-muted-foreground",

  paymentMethodsBlock: "space-y-3",
  paymentMethodsTitle: "text-[0.9375rem] font-semibold tracking-tight text-foreground sm:text-base",

  paymentMethodRow:
    "customer-flow-payment-method flex w-full min-h-[3.75rem] items-center gap-3.5 rounded-lg border border-border/70 bg-card px-3.5 py-3 text-left sm:min-h-[4rem] sm:gap-4 sm:px-4",
  paymentMethodOn: "border-primary/40 bg-primary/[0.04] ring-1 ring-primary/15",
  paymentMethodOff: "",

  trustCard: cn(quietSurface, "customer-flow-trust"),

  stripeNote: "text-center text-sm leading-snug text-muted-foreground",

  selectedAmountRow:
    "flex items-center justify-between gap-3 px-1 py-1",

  stateCenter:
    "flex min-h-[min(100dvh,48rem)] flex-col items-center justify-center px-4 py-12 text-center",
  stateError: "mb-2 max-w-md text-sm font-medium text-destructive",

  starButton:
    "customer-flow-star inline-flex min-h-[3.25rem] min-w-[3.25rem] items-center justify-center rounded-lg p-1.5 hover:bg-muted sm:min-h-[3.5rem] sm:min-w-[3.5rem]",
  starButtonActive: "bg-primary/[0.08] ring-1 ring-primary/20",

  tagPill:
    "rounded-md px-4 py-2.5 text-sm font-semibold ring-1 ring-inset sm:min-h-[2.75rem]",
  tagPillIdle:
    "bg-card text-foreground ring-border/80",
  tagPillOn:
    "bg-primary text-primary-foreground ring-primary/25",

  skipAction:
    "flex min-h-[2.75rem] w-full items-center justify-center rounded-lg text-sm font-medium text-muted-foreground/90 hover:text-foreground",

  completionActions: "mx-auto flex w-full max-w-sm flex-col items-stretch gap-3",
  completionPrimaryBtn: cn(caretipBtnPrimary, "w-full"),
  completionSecondaryBtn: cn(caretipBtnSecondary, "w-full"),
  completionTextAction:
    "inline-flex min-h-[2.75rem] items-center justify-center rounded-lg px-4 text-sm font-medium text-muted-foreground/90 hover:text-foreground",

  successIconWrap:
    "customer-flow-success-icon mx-auto mb-6 flex size-[4.5rem] items-center justify-center rounded-full bg-primary/12 sm:size-[5rem]",
  completionCard: quietSurface,
} as const;
