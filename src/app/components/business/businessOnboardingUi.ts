import { cn } from "@/lib/utils";

export const onboardingDisplayFont = "inherit";

export const onboardingUiFont = "var(--font-inter)";

export const onboardingHeadline = cn(
  "text-balance font-bold tracking-[-0.032em] text-foreground",
  "text-[clamp(1.875rem,5vw,2.625rem)] leading-[1.1]",
);

export const onboardingSubhead = cn(
  "max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base",
);

export const onboardingStepTitle = cn(
  "font-bold tracking-tight text-foreground",
  "text-xl sm:text-[1.375rem] leading-snug",
);

export const onboardingStepHint = cn(
  "mt-2 text-sm leading-relaxed text-muted-foreground",
);

export const onboardingLabel = cn(
  "mb-2 block text-[0.8125rem] font-semibold text-foreground",
);

export const onboardingSectionKicker = cn(
  "text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted-foreground",
);

export const onboardingSectionHeading = cn(
  "mt-1 text-lg font-semibold tracking-tight text-foreground sm:text-xl",
);

export const onboardingOptionalBadge = cn(
  "ml-2 inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground",
);

export const onboardingRequiredMark = "text-destructive";

export const onboardingFieldHint = cn(
  "mt-2 text-xs leading-relaxed text-muted-foreground",
);

export const onboardingInput = cn(
  "h-[3.25rem] w-full rounded-[0.875rem] border border-border/60 bg-[#faf7f2] px-4 dark:bg-background",
  "text-[15px] font-normal text-foreground placeholder:text-muted-foreground",
  "transition-colors duration-150",
  "hover:border-foreground/25",
  "focus:border-primary focus:bg-background focus:outline-none focus:ring-[3px] focus:ring-primary/20",
  "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
);

export const onboardingSelect = cn(
  onboardingInput,
  "business-onboarding-select cursor-pointer appearance-none bg-no-repeat pr-11",
);

export const onboardingFileInput = cn(
  onboardingInput,
  "h-auto py-2.5 text-sm file:mr-3 file:rounded-md file:border-0",
  "file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground",
);

/** @deprecated Prefer flat page layout — kept for any legacy imports */
export const onboardingFormCard = "min-w-0";

/** @deprecated Use spacing + onboardingSectionKicker instead */
export const onboardingSectionCard = "space-y-5";

/** @deprecated */
export const onboardingSectionTitle = onboardingSectionKicker;

export const onboardingBackBtn = cn(
  "inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-[0.875rem] px-4",
  "text-sm font-semibold text-foreground transition-colors duration-150",
  "hover:text-foreground hover:bg-muted/80",
  "disabled:pointer-events-none disabled:opacity-30",
);

export const onboardingContinueBtn = cn(
  "caretip-btn-primary inline-flex min-h-11 items-center justify-center gap-2",
  "rounded-lg px-6 text-[15px] font-semibold",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

export const onboardingFinishBtn = cn(
  onboardingContinueBtn,
  "text-[15px]",
);

export const onboardingTrustItem = cn(
  "text-xs font-normal leading-relaxed text-muted-foreground",
);
