import { useCallback, useEffect, useState } from "react";
import { Rocket, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBusinessGuidelines } from "@/app/contexts/BusinessGuidelinesContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "caretip-quick-start-banner-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Temporary full-width Quick Start Guide banner at the top of the business dashboard.
 * Dismiss persists permanently per browser via localStorage.
 */
export function QuickStartGuideBanner({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { openGuidelines } = useBusinessGuidelines();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        "business-quick-start-banner relative w-full border-b border-orange-200/70",
        "bg-[linear-gradient(180deg,rgb(255_247_237)_0%,rgb(255_251_245)_100%)]",
        "dark:border-orange-900/40 dark:bg-[linear-gradient(180deg,rgb(67_32_11_/_0.35)_0%,rgb(24_24_27)_100%)]",
        className,
      )}
      role="region"
      aria-label={t("business.dashboard.quickStartBannerTitle")}
    >
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-3.5 sm:items-center sm:gap-4 sm:px-6 lg:px-8">
        <span
          className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-orange-200/80 bg-white text-orange-600 shadow-sm dark:border-orange-800/50 dark:bg-zinc-900 dark:text-orange-300"
          aria-hidden
        >
          <Rocket className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1 pr-8 sm:pr-2">
          <p className="text-sm font-semibold tracking-tight text-foreground">
            {t("business.dashboard.quickStartBannerTitle")}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-[13px]">
            {t("business.dashboard.quickStartBannerBody")}
          </p>
          <div className="mt-2.5">
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg bg-[#e9781c] px-3 text-xs font-semibold text-white hover:bg-[#d96a14]"
              onClick={openGuidelines}
            >
              {t("business.dashboard.quickStartBannerCta")}
            </Button>
          </div>
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-orange-100/80 hover:text-foreground dark:hover:bg-zinc-800 sm:static sm:shrink-0"
          aria-label={t("business.dashboard.quickStartBannerDismiss")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
