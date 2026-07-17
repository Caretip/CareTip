import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { GlobalAppLoadingHold } from "./GlobalAppLoadingHold";
import { LoadingSpinner } from "./ui/loading-spinner";
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
      alt="CareTip"
      width={compact ? 48 : 72}
      height={compact ? 48 : 72}
      decoding="async"
      className={cn(
        "select-none object-contain",
        compact ? "h-12 w-12" : "h-[4.5rem] w-[4.5rem] sm:h-[5rem] sm:w-[5rem]",
        className,
      )}
      draggable={false}
    />
  );
}

/** Shared logo + orbit spinner used by all branded loading surfaces. */
export function CareTipBrandedLoaderMark({
  compact = true,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("app-branded-loader__mark", className)} aria-hidden>
      <CareTipLoadingTitle compact={compact} className="app-branded-loader__title" />
      <span className="app-branded-loader__spinner" />
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
   * compact — tables, overlays, modals (smaller title + md spinner).
   * wait — full-viewport wait (QR resolve, guards, data hydration).
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
  const spinnerSize = variant === "compact" ? "md" : "lg";

  useAppLoadingRegistration(
    registrationKey ?? `caretip-page-loader:${autoKey}`,
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    isFullScreen && !softNav,
    keepProgressCopy ? resolvedMessage : undefined,
  );

  const variantClass =
    variant === "fullscreen"
      ? "flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6"
      : variant === "wait"
        ? "flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6"
        : variant === "section"
          ? "flex flex-col items-center justify-center gap-6 py-16 px-4"
          : "flex flex-col items-center justify-center gap-4";

  /* Cold entry: stay under the global CareTip overlay. */
  if (isFullScreen && !softNav) {
    return <GlobalAppLoadingHold className={className} />;
  }

  /* Soft SPA: tip/payment keep progress copy; dashboards get icon + orbit spinner. */
  if (isFullScreen && softNav && !keepProgressCopy) {
    return (
      <div
        className={cn(
          "app-branded-loader flex min-h-[40vh] flex-col items-center justify-center bg-background px-6",
          className,
        )}
        role="status"
        aria-busy="true"
        aria-label="CareTip"
      >
        <CareTipBrandedLoaderMark />
      </div>
    );
  }

  return (
    <div
      className={cn(variantClass, className)}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      {keepProgressCopy ? null : (
        <CareTipBrandedLoaderMark compact={variant === "compact" || isFullScreen} />
      )}
      <div className="flex flex-col items-center gap-3">
        {keepProgressCopy ? <LoadingSpinner size={spinnerSize} /> : null}
        {keepProgressCopy && resolvedMessage ? (
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            {resolvedMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
