import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { traceGlobalOverlayMounted } from "../lib/globalAppLoadingTrace";
import { CareTipLoadingTitle } from "./CareTipPageLoader";

export type AppBrandedLoadingScreenProps = {
  className?: string;
  /** Full-viewport fixed overlay (global manager). */
  fixed?: boolean;
  /**
   * Optional status line — only for intentional payment/checkout waits.
   * Cold entry never shows copy.
   */
  message?: string;
  /** When true, never render status copy (cold boot / auth). */
  suppressStatusMessage?: boolean;
  /** @deprecated Ignored — kept for call-site compatibility. */
  allowStartupFallback?: boolean;
  /** Fade-out when global overlay is dismissing. */
  exiting?: boolean;
};

/**
 * Application entry / intentional overlay — CareTip icon with optional payment status.
 * No rotating messages, no “only a moment” filler.
 */
export function AppBrandedLoadingScreen({
  className,
  fixed = false,
  message,
  suppressStatusMessage = true,
  exiting = false,
}: AppBrandedLoadingScreenProps) {
  useEffect(() => {
    if (!fixed || exiting) return;
    traceGlobalOverlayMounted();
  }, [fixed, exiting]);

  const status = !suppressStatusMessage && message?.trim() ? message.trim() : null;

  return (
    <div
      className={cn(
        "app-setup-loading app-branded-loader flex flex-col items-center justify-center gap-5 bg-background px-6",
        fixed ? "fixed inset-0 z-[9998]" : "min-h-[100dvh] w-full",
        exiting && "app-setup-loading--exiting",
        className,
      )}
      role="status"
      aria-busy={!exiting}
      aria-label={status ?? "CareTip"}
      aria-live="polite"
    >
      <div className="app-branded-loader__mark" aria-hidden>
        <CareTipLoadingTitle compact className="app-branded-loader__title" />
      </div>
      {status ? (
        <p className="max-w-sm text-center text-sm font-medium text-foreground">{status}</p>
      ) : null}
    </div>
  );
}
