/**
 * Public customer tipping journey — premium fintech-style presentation tokens.
 * Presentation only — no flow or payment logic.
 */
import "@/styles/bundles/customer.css";

import { cn } from "@/lib/utils";
import {
  caretipBtnPrimary,
  caretipBtnPrimaryFull,
  caretipBtnSecondary,
  caretipBtnSecondaryFull,
} from "@/lib/caretipButtonSystem";

/** Shared premium card surface */
const premiumCard =
  "overflow-hidden rounded-[1.125rem] border border-black/[0.06] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)] dark:border-white/10 dark:bg-card";

export const customerFlowUi = {
  /** Root shell — warm neutral canvas */
  page: "customer-flow min-h-screen bg-[#f7f6f3] dark:bg-background",
  pageWithBottomCta: "customer-flow min-h-screen bg-[#f7f6f3] pb-28 dark:bg-background sm:pb-32",

  stickyHeader:
    "sticky top-0 z-20 border-b border-black/[0.06] bg-white/92 backdrop-blur-xl supports-[backdrop-filter]:bg-white/88 dark:border-white/10 dark:bg-background/92 shadow-[0_4px_24px_-18px_rgba(15,23,42,0.08)]",

  /** @deprecated Prefer CustomerJourneyHeader — kept for gradual migration. */
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

  /** Flat page-surface footer — not a card. */
  customerJourneyAttribution:
    "flex w-full flex-col items-center justify-center gap-2 px-1 py-2 text-center sm:flex-row sm:gap-2.5",
  customerJourneyAttributionCompact:
    "inline-flex items-center justify-center gap-2 text-center",
  customerJourneyAttributionLabel: "text-xs font-medium leading-snug text-muted-foreground/80 sm:text-[0.8125rem]",
  customerJourneyAttributionFooter:
    "caretip-container mx-auto max-w-xl pb-8 pt-1 sm:pb-10",

  /** @deprecated Legacy title stack — use customerJourneyVenueName + stepTitle. */
  customerJourneyContent: "min-w-0 pt-4",
  customerJourneyTitle:
    "customer-journey-title text-balance text-lg font-semibold leading-tight tracking-tight text-foreground sm:text-xl",
  customerJourneySubtitle: "mt-4 text-sm leading-snug text-muted-foreground sm:text-[0.9375rem]",

  headline:
    "min-w-0 truncate text-base font-semibold tracking-tight text-foreground sm:text-lg",
  subline: "text-xs leading-snug text-muted-foreground sm:text-[0.8125rem]",

  backButton:
    "inline-flex shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/80 px-2.5 py-2 text-sm font-semibold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.03)] transition-[transform,background-color,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_4px_14px_rgba(0,0,0,0.06)] active:translate-y-0 disabled:opacity-40 dark:border-white/10 dark:bg-card/80 sm:px-3",

  main: "caretip-container mx-auto max-w-xl space-y-5 py-5 sm:space-y-5 sm:py-8",
  mainCompact: "caretip-container mx-auto max-w-xl space-y-4 py-4 sm:space-y-4 sm:py-7",

  fixedBottomBar:
    "fixed bottom-0 left-0 right-0 z-30 border-t border-black/[0.06] bg-white/92 backdrop-blur-md supports-[backdrop-filter]:bg-white/88 dark:border-white/10 dark:bg-background/95 shadow-[0_-12px_40px_-20px_rgba(15,23,42,0.1)]",
  /** Centers journey CTAs on desktop; full width on mobile. */
  fixedBottomInner:
    "caretip-container mx-auto flex max-w-xl justify-center px-4 py-3.5 sm:px-6 sm:py-4",
  /** Wrap fixed-bottom or inline primary actions — mobile full width, desktop capped. */
  journeyCtaStack: "flex w-full max-w-sm flex-col gap-3",

  card: premiumCard,

  cardMuted: cn(
    premiumCard,
    "border-black/[0.05] bg-[#fafaf8] shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:bg-muted/20",
  ),

  cardAccentWash: cn(
    premiumCard,
    "border-primary/18 bg-gradient-to-br from-primary/[0.07] via-white to-[#fff8f2] shadow-[0_10px_32px_rgba(233,120,28,0.08)] dark:from-primary/[0.1] dark:via-card dark:to-card",
  ),

  cardShadcn: cn(premiumCard, "border-black/[0.06]"),

  cardSearchLight: cn(
    premiumCard,
    "border-black/[0.04] bg-[#fcfcfb] shadow-[0_4px_18px_rgba(0,0,0,0.025)] dark:bg-card/60",
  ),

  cardHeaderPadding: "px-5 pb-2.5 pt-5 sm:px-6 sm:pb-3 sm:pt-5",
  cardTitle: "text-[0.9375rem] font-semibold tracking-tight text-foreground sm:text-base",
  cardDesc: "text-sm leading-relaxed text-muted-foreground",

  /** Employee picker grid tile */
  employeeCard:
    "customer-flow-employee-card flex w-full flex-col items-center gap-3 rounded-[1.125rem] border border-black/[0.06] bg-white p-4 text-center shadow-[0_8px_30px_rgba(0,0,0,0.04)] transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_14px_36px_rgba(0,0,0,0.08)] active:scale-[0.98] sm:gap-3.5 sm:p-5 dark:border-white/10 dark:bg-card",
  employeeCardSelected:
    "border-primary bg-primary/[0.06] shadow-[0_12px_32px_rgba(233,120,28,0.12)] ring-2 ring-primary/20",
  employeeAvatar:
    "h-[5.5rem] w-[5.5rem] ring-[3px] ring-primary/15 sm:h-24 sm:w-24 sm:ring-4 sm:ring-primary/18",

  /** Compact employee row on tip amount / payment */
  employeeSummaryCard: cn(premiumCard, "customer-flow-employee-summary"),
  employeeSummaryAvatar:
    "h-[4.25rem] w-[4.25rem] shrink-0 ring-[3px] ring-primary/20 shadow-[0_4px_16px_rgba(233,120,28,0.12)] sm:h-[4.5rem] sm:w-[4.5rem]",

  selectableTile:
    "min-h-[6.25rem] rounded-[1.125rem] border-2 p-4 text-left transition-[transform,border-color,box-shadow,background-color] duration-150 ease-out motion-reduce:transition-none sm:min-h-[6.75rem]",
  selectableIdle:
    "border-black/[0.08] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)] hover:-translate-y-0.5 hover:border-primary/28 hover:shadow-[0_12px_32px_rgba(0,0,0,0.07)] dark:border-white/10 dark:bg-card",
  selectableOn:
    "border-primary bg-primary/[0.08] shadow-[0_12px_32px_rgba(233,120,28,0.14)] ring-2 ring-primary/15 -translate-y-0.5",

  tipPresetTile:
    "customer-flow-tip-preset flex min-h-[5.75rem] flex-col justify-center rounded-[1.125rem] border-2 p-3.5 text-left transition-[transform,border-color,box-shadow,background-color] duration-150 ease-out sm:min-h-[6.5rem] sm:p-4",
  tipPresetIdle:
    "border-black/[0.08] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)] hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_14px_36px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-card",
  tipPresetOn:
    "border-primary bg-primary/[0.08] shadow-[0_14px_36px_rgba(233,120,28,0.16)] ring-2 ring-primary/15 -translate-y-0.5",

  inputField:
    "w-full rounded-[1.125rem] border border-black/[0.08] bg-white px-4 py-3.5 text-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] placeholder:text-muted-foreground transition-[border-color,box-shadow] duration-150 focus-visible:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-white/10 dark:bg-card",

  inputAmount:
    "w-full rounded-[1.125rem] border-2 border-black/[0.08] bg-white py-4 pl-11 pr-4 text-3xl font-bold tabular-nums text-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] transition-[border-color,box-shadow] duration-150 focus-visible:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-white/10 dark:bg-card",

  dashedCustomTrigger:
    "w-full rounded-[1.125rem] border-2 border-dashed border-black/[0.1] bg-[#fafaf8] py-6 transition-[border-color,background-color,transform] duration-150 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/[0.03] dark:border-white/15 dark:bg-muted/15",

  btnPrimaryLg: cn(caretipBtnPrimary, "w-full sm:max-w-sm"),
  btnSecondaryLg: cn(caretipBtnSecondary, "w-full sm:max-w-sm"),
  btnAccentLg: cn(caretipBtnPrimary, "w-full sm:max-w-sm", "customer-flow-pay-cta"),

  /** Amount review — light surface, not a heavy nested card stack. */
  paymentSummary:
    "customer-flow-payment-summary overflow-hidden rounded-2xl border border-black/[0.05] bg-white/80 dark:border-white/10 dark:bg-card/60",
  paymentAmountDisplay:
    "text-[1.875rem] font-bold tabular-nums tracking-tight text-foreground sm:text-[2.25rem]",
  paymentAmountLabel: "text-sm font-medium text-muted-foreground",

  paymentMethodsBlock: "space-y-3",
  paymentMethodsTitle: "text-[0.9375rem] font-semibold tracking-tight text-foreground sm:text-base",

  paymentMethodRow:
    "customer-flow-payment-method flex w-full min-h-[3.75rem] items-center gap-3.5 rounded-2xl border border-black/[0.06] bg-white px-3.5 py-3 text-left sm:min-h-[4rem] sm:gap-4 sm:px-4 dark:border-white/10 dark:bg-card",
  paymentMethodOn: "border-primary/35 bg-primary/[0.04] ring-1 ring-primary/10",
  paymentMethodOff: "",

  trustCard: cn(premiumCard, "customer-flow-trust border-emerald-600/10 bg-gradient-to-br from-emerald-50/80 via-white to-white dark:from-emerald-950/20 dark:via-card dark:to-card"),

  /** Single concise Stripe/security line — not a card. */
  stripeNote: "text-center text-sm leading-snug text-muted-foreground",

  selectedAmountRow:
    "flex items-center justify-between gap-3 px-1 py-1",

  stateCenter:
    "flex min-h-[min(100dvh,48rem)] flex-col items-center justify-center px-4 py-12 text-center",
  stateError: "mb-2 max-w-md text-sm font-medium text-destructive",

  starButton:
    "customer-flow-star inline-flex min-h-[3.25rem] min-w-[3.25rem] items-center justify-center rounded-2xl p-1.5 transition-[transform,background-color] duration-150 hover:-translate-y-0.5 hover:bg-primary/[0.08] sm:min-h-[3.5rem] sm:min-w-[3.5rem]",
  starButtonActive: "bg-primary/[0.1] ring-2 ring-primary/15",

  tagPill:
    "rounded-full px-4 py-2.5 text-sm font-semibold ring-1 ring-inset transition-[transform,background-color,box-shadow] duration-150 sm:min-h-[2.75rem] hover:-translate-y-0.5",
  tagPillIdle:
    "bg-white text-foreground ring-black/[0.08] shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:bg-[#fafaf8] dark:bg-card dark:ring-white/10",
  tagPillOn:
    "bg-primary text-primary-foreground ring-primary/25 shadow-[0_6px_18px_rgba(233,120,28,0.22)]",

  skipAction:
    "flex min-h-[2.75rem] w-full items-center justify-center rounded-xl text-sm font-medium text-muted-foreground/90 transition-colors duration-150 hover:text-foreground",

  /** Post-completion actions — narrow, centered (not full-bleed commitment CTAs). */
  completionActions: "mx-auto flex w-full max-w-sm flex-col items-stretch gap-3",
  completionPrimaryBtn: cn(caretipBtnPrimary, "w-full"),
  completionSecondaryBtn: cn(caretipBtnSecondary, "w-full"),
  completionTextAction:
    "inline-flex min-h-[2.75rem] items-center justify-center rounded-xl px-4 text-sm font-medium text-muted-foreground/90 transition-colors duration-150 hover:text-foreground",

  successIconWrap:
    "customer-flow-success-icon mx-auto mb-6 flex size-[5.25rem] items-center justify-center rounded-full bg-gradient-to-br from-primary/15 via-primary/8 to-transparent ring-[10px] ring-primary/[0.07] sm:size-[5.5rem]",
  completionCard: cn(
    premiumCard,
    "customer-flow-completion border-primary/15 bg-gradient-to-b from-white via-white to-primary/[0.04] dark:from-card dark:via-card dark:to-primary/[0.06]",
  ),
} as const;
