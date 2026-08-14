import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { GlobalAppLoadingHold } from "./GlobalAppLoadingHold";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../context/AppLoadingManager";
import {
  resolveAppLoadingContextMessage,
  type AppLoadingContext,
} from "../lib/appLoadingContexts";
import { isAppShellInteractive } from "../lib/appShellLifecycle";

/** Branded CareTip mark for loading states — app icon (constrained space). */
export function CareTipLoadingTitle({
  compact,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <img
      src="/brand/caretip-app-icon.svg"
      alt=""
      width={compact ? 48 : 80}
      height={compact ? 48 : 80}
      decoding="async"
      className={cn(
        "select-none object-contain",
        compact ? "h-12 w-12" : "h-16 w-16 sm:h-20 sm:w-20",
        className,
      )}
      draggable={false}
    />
  );
}

/**
 * Shared logo + progress cue used by all branded CareTip loading surfaces.
 * App-level layout: icon → progress bar → one loading sentence.
 * Never pair this sentence with a second line of copy on the same screen.
 */
export function CareTipBrandedLoaderMark({
  compact = true,
  className,
  showTagline,
  tagline: taglineOverride,
}: {
  compact?: boolean;
  className?: string;
  /** Defaults to true when not compact (startup / auth shells). */
  showTagline?: boolean;
  /**
   * Overrides the default “getting ready” sentence when a more specific
   * user-facing stage is active. One tagline only.
   */
  tagline?: string;
}) {
  const { t } = useTranslation();
  const withTagline = showTagline ?? !compact;
  const tagline = taglineOverride?.trim() || t("common.gettingReady");

  return (
    <div
      className={cn(
        "app-branded-loader__mark",
        compact && "app-branded-loader__mark--compact",
        className,
      )}
    >
      <div className="app-branded-loader__icon-wrap" aria-hidden>
        <CareTipLoadingTitle compact={compact} className="app-branded-loader__title" />
      </div>
      <span className="app-branded-loader__track" aria-hidden>
        <span className="app-branded-loader__indeterminate" />
      </span>
      {withTagline ? (
        <p className="app-branded-loader__tagline">{tagline}</p>
      ) : null}
    </div>
  );
}

const TIP_PROGRESS_CONTEXTS = new Set<AppLoadingContext>([
  "tipPage",
  "findingRecipient",
  "checkout",
  "stripeRedirect",
  "stripeReturn",
  "finishing",
  "receipt",
]);

export type CareTipPageLoaderProps = {
  message?: string;
  /** Action-aware copy when `message` is omitted. */
  context?: AppLoadingContext;
  className?: string;
  /** Stable key for global overlay registration (fullscreen / wait). */
  registrationKey?: string;
  /**
   * fullscreen — full-viewport (cold entry under global overlay; soft nav = icon only).
   * section — in-page blocks (lists, settings body).
   * compact — tables, overlays, modals (smaller title + bar).
   * wait — full-viewport wait (QR resolve, guards).
   */
  variant?: "fullscreen" | "section" | "compact" | "wait";
};

export function CareTipPageLoader({
  message,
  context,
  className,
  registrationKey,
  variant = "fullscreen",
}: CareTipPageLoaderProps) {
  const { t } = useTranslation();
  const autoKey = useId();
  const softNav = isAppShellInteractive();
  const isFullScreen = variant === "wait" || variant === "fullscreen";
  const keepProgressCopy =
    Boolean(message) || (context != null && TIP_PROGRESS_CONTEXTS.has(context));
  const resolvedMessage =
    message ?? (context ? resolveAppLoadingContextMessage(context, t) : undefined);

  useAppLoadingRegistration(
    registrationKey ?? `caretip-page-loader:${autoKey}`,
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    isFullScreen && !softNav,
    keepProgressCopy ? resolvedMessage : undefined,
  );

  const variantClass =
    variant === "fullscreen" || variant === "wait"
      ? "flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6"
      : variant === "section"
        ? "flex flex-col items-center justify-center py-16 px-4"
        : "flex flex-col items-center justify-center";

  /* Cold entry: stay under the global CareTip overlay. */
  if (isFullScreen && !softNav) {
    return <GlobalAppLoadingHold className={className} />;
  }

  const tagline = keepProgressCopy ? resolvedMessage : undefined;

  return (
    <div
      className={cn("app-branded-loader", variantClass, className)}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <CareTipBrandedLoaderMark
        compact={!isFullScreen}
        tagline={tagline}
        showTagline={keepProgressCopy || isFullScreen}
      />
    </div>
  );
}
