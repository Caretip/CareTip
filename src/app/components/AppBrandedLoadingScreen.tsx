import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { traceGlobalOverlayMounted } from "../lib/globalAppLoadingTrace";
import { CareTipBrandedLoaderMark } from "./CareTipPageLoader";

export type AppBrandedLoadingScreenProps = {
  className?: string;
  /** Full-viewport fixed overlay (global manager). */
  fixed?: boolean;
  /**
   * Stage-specific tagline for intentional payment/onboarding waits.
   * Replaces the default “Getting things ready…” sentence — never a second line.
   */
  message?: string;
  /** When true, keep the default getting-ready tagline (ignore `message`). */
  suppressStatusMessage?: boolean;
  /** @deprecated Ignored — kept for call-site compatibility. */
  allowStartupFallback?: boolean;
  /** Fade-out when global overlay is dismissing. */
  exiting?: boolean;
};

/**
 * Application entry / intentional overlay — CareTip icon + a single tagline.
 * Stage-specific copy (checkout, onboarding setup, …) replaces the default
 * “Getting things ready…” tagline. Never render a second loading sentence.
 */
export function AppBrandedLoadingScreen({
  className,
  fixed = false,
  message,
  suppressStatusMessage = false,
  exiting = false,
}: AppBrandedLoadingScreenProps) {
  useEffect(() => {
    if (!fixed || exiting) return;
    traceGlobalOverlayMounted();
  }, [fixed, exiting]);

  const status = suppressStatusMessage ? undefined : message?.trim() || undefined;

  return (
    <div
      className={cn(
        "app-setup-loading app-branded-loader flex flex-col items-center justify-center gap-5 bg-background px-6",
        fixed ? "fixed inset-0 z-[9998]" : "min-h-[100dvh] w-full",
        fixed && !exiting && "app-setup-loading--instant",
        exiting && "app-setup-loading--exiting",
        className,
      )}
      role="status"
      aria-busy={!exiting}
      aria-live="polite"
    >
      <CareTipBrandedLoaderMark compact={false} tagline={status} />
    </div>
  );
}
