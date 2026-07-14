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

/** Text-only “CareTip” mark for loading states (no logo image). */
export function CareTipLoadingTitle({
  compact,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <h1
      className={cn(
        "select-none font-sans font-bold leading-none tracking-tight",
        compact
          ? "text-2xl sm:text-3xl"
          : "text-[clamp(2rem,8vw,3.25rem)]",
        className
      )}
      style={{
        textRendering: "geometricPrecision",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <span className="text-primary">Care</span>
      <span className="text-neutral-600 dark:text-neutral-400">Tip</span>
    </h1>
  );
}

export type CareTipPageLoaderProps = {
  message?: string;
  /** Action-aware copy when `message` is omitted. */
  context?: AppLoadingContext;
  className?: string;
  /** Stable key for global overlay registration (fullscreen / wait). */
  registrationKey?: string;
  /**
   * fullscreen — full-viewport branded (dashboards / rare full-page module loads).
   * section — in-page blocks (lists, settings body).
   * compact — tables, overlays, modals (smaller title + md spinner).
   * wait — full-viewport branded wait (QR resolve, guards, data hydration).
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
  const resolvedMessage =
    message ?? (context ? resolveAppLoadingContextMessage(context, t) : undefined);
  const spinnerSize = variant === "compact" ? "md" : "lg";

  useAppLoadingRegistration(
    registrationKey ?? `caretip-page-loader:${autoKey}`,
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    isFullScreen && !softNav,
    resolvedMessage,
  );

  const variantClass =
    variant === "fullscreen"
      ? "flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6"
      : variant === "wait"
        ? "flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6"
        : variant === "section"
          ? "flex flex-col items-center justify-center gap-6 py-16 px-4"
          : "flex flex-col items-center justify-center gap-4";

  /* Cold entry: stay under the global CareTip overlay. Soft SPA: local wait only. */
  if (isFullScreen && !softNav) {
    return <GlobalAppLoadingHold className={className} />;
  }

  return (
    <div
      className={cn(variantClass, className)}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <CareTipLoadingTitle compact={variant === "compact" || isFullScreen} />
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner size={spinnerSize} />
        {resolvedMessage ? (
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            {resolvedMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
