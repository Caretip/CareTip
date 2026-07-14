import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { traceGlobalOverlayMounted } from "../lib/globalAppLoadingTrace";
import { CareTipLoadingTitle } from "./CareTipPageLoader";

export type AppBrandedLoadingScreenProps = {
  className?: string;
  /** Full-viewport fixed overlay (global manager). */
  fixed?: boolean;
  message?: string;
  /** When true and message is empty, show cold-start copy (app-boot only). */
  allowStartupFallback?: boolean;
  /** Fade-out when global overlay is dismissing. */
  exiting?: boolean;
};

/**
 * Global CareTip loader — branded mark, warm pulse, workspace copy.
 * Soft navigations / auth transitions only. Cold URL boot uses `#caretip-html-boot`.
 */
export function AppBrandedLoadingScreen({
  className,
  fixed = false,
  message,
  allowStartupFallback = false,
  exiting = false,
}: AppBrandedLoadingScreenProps) {
  const { t } = useTranslation();
  const resolvedMessage =
    message ?? (allowStartupFallback ? t("common.loading.starting") : undefined);

  useEffect(() => {
    if (!fixed || exiting) return;
    traceGlobalOverlayMounted();
  }, [fixed, exiting]);

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
      aria-live="polite"
    >
      <div className="app-branded-loader__mark" aria-hidden>
        <CareTipLoadingTitle compact className="app-branded-loader__title" />
      </div>
      <div className="flex max-w-sm flex-col items-center gap-1 text-center">
        {resolvedMessage ? (
          <p className="text-sm font-medium text-foreground">{resolvedMessage}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("common.onlyAMoment")}</p>
      </div>
    </div>
  );
}
