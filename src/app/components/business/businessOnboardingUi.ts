import { cn } from "@/lib/utils";

/** Plus Jakarta headlines + Inter UI — scoped to onboarding */
export const onboardingDisplayFont =
  '"Plus Jakarta Sans", "Plus Jakarta Sans Fallback", ui-sans-serif, system-ui, sans-serif';

export const onboardingUiFont = "var(--font-inter)";

export const onboardingHeadline = cn(
  "text-balance font-bold tracking-tight text-zinc-900 dark:text-zinc-50",
  "text-[clamp(1.875rem,5vw,2.625rem)] leading-[1.1]",
);

export const onboardingSubhead = cn(
  "max-w-xl text-[15px] leading-relaxed text-zinc-500 sm:text-base dark:text-zinc-400",
);

export const onboardingStepTitle = cn(
  "font-bold tracking-tight text-zinc-900 dark:text-zinc-50",
  "text-xl sm:text-[1.375rem] leading-snug",
);

export const onboardingStepHint = cn(
  "mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400",
);

export const onboardingLabel = cn(
  "mb-2.5 block text-sm font-medium leading-snug text-zinc-700 dark:text-zinc-300",
);

export const onboardingOptionalBadge = cn(
  "ml-2 inline-flex rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500",
  "dark:bg-zinc-800 dark:text-zinc-400",
);

export const onboardingFieldHint = cn(
  "mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400",
);

export const onboardingInput = cn(
  "h-12 w-full rounded-xl border border-zinc-200/90 bg-white px-4",
  "text-[15px] font-normal text-zinc-900 placeholder:text-zinc-500",
  "transition-all duration-200 ease-out",
  "hover:border-zinc-300 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
  "focus:border-orange-500 focus:outline-none focus:ring-4 focus:ring-orange-500/10 focus:shadow-[0_0_0_1px_rgba(249,115,22,0.35)]",
  "disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-700 disabled:opacity-100",
  "dark:border-zinc-700/90 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-400",
  "dark:hover:border-zinc-600",
  "dark:focus:border-orange-500 dark:focus:ring-orange-500/15",
  "dark:disabled:bg-zinc-900 dark:disabled:text-zinc-300",
);

export const onboardingSelect = cn(
  onboardingInput,
  "business-onboarding-select cursor-pointer appearance-none bg-no-repeat pr-11",
);

export const onboardingFileInput = cn(
  onboardingInput,
  "h-auto py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0",
  "file:bg-orange-500/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-orange-600",
  "dark:file:bg-orange-500/15 dark:file:text-orange-400",
);

export const onboardingFormCard = cn(
  "rounded-2xl border border-zinc-200/70 bg-white/90 p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-12px_rgba(0,0,0,0.08)]",
  "sm:p-8 dark:border-zinc-800/80 dark:bg-zinc-950/50 dark:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_20px_40px_-24px_rgba(0,0,0,0.5)]",
);

export const onboardingSectionCard = cn(
  "rounded-xl border border-zinc-200/60 bg-zinc-50/50 p-5",
  "dark:border-zinc-800/70 dark:bg-zinc-900/30",
);

export const onboardingSectionTitle = cn(
  "mb-4 flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100",
);

export const onboardingBackBtn = cn(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4",
  "text-sm font-medium text-zinc-600 transition-all duration-200",
  "hover:text-zinc-900 hover:bg-zinc-100/80",
  "disabled:pointer-events-none disabled:opacity-30",
  "dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100",
);

export const onboardingContinueBtn = cn(
  "caretip-btn-primary inline-flex min-h-11 items-center justify-center gap-2",
  "rounded-xl px-6 text-[15px] font-semibold tracking-[0.01em]",
  "shadow-[0_8px_24px_-8px_rgba(234,88,12,0.45)]",
  "transition-all duration-200 ease-out",
  "hover:shadow-[0_12px_28px_-8px_rgba(234,88,12,0.5)] hover:brightness-[1.02]",
  "active:scale-[0.98]",
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100",
);

export const onboardingFinishBtn = cn(
  onboardingContinueBtn,
  "text-[15px] shadow-[0_12px_32px_-10px_rgba(234,88,12,0.55)]",
  "hover:shadow-[0_16px_36px_-10px_rgba(234,88,12,0.6)]",
);

export const onboardingTrustItem = cn(
  "text-xs font-normal leading-relaxed text-zinc-500 dark:text-zinc-500",
);
