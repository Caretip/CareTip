import { cn } from "@/lib/utils";

/** Plus Jakarta headlines + Inter UI — scoped to onboarding */
export const onboardingDisplayFont =
  '"Plus Jakarta Sans", "Plus Jakarta Sans Fallback", ui-sans-serif, system-ui, sans-serif';

export const onboardingUiFont = "var(--font-inter)";

export const onboardingHeadline = cn(
  "text-balance font-bold tracking-tight text-foreground",
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
  "mb-2.5 block text-sm font-medium leading-snug text-foreground",
);

export const onboardingOptionalBadge = cn(
  "ml-2 inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground",
);

export const onboardingFieldHint = cn(
  "mt-2 text-xs leading-relaxed text-muted-foreground",
);

export const onboardingInput = cn(
  "h-12 w-full rounded-lg border border-border bg-background px-4",
  "text-[15px] font-normal text-foreground placeholder:text-muted-foreground",
  "transition-colors duration-150",
  "hover:border-foreground/25",
  "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
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

export const onboardingFormCard = cn(
  "rounded-lg border border-border/70 bg-card p-6",
  "sm:p-8",
);

export const onboardingSectionCard = cn(
  "rounded-lg border border-border/60 bg-muted/30 p-5",
);

export const onboardingSectionTitle = cn(
  "mb-4 flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground",
);

export const onboardingBackBtn = cn(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4",
  "text-sm font-medium text-muted-foreground transition-colors duration-150",
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
