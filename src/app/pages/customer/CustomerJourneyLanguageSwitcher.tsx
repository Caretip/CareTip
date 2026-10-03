import { memo, useCallback, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  changeCustomerJourneyLanguage,
  ensureLocaleBundle,
  prefetchCustomerJourneyLocaleBundles,
  resolveAppLanguageFromCode,
  type AppLanguage,
} from "@/i18n/i18n";

type CustomerJourneyLanguageSwitcherProps = {
  className?: string;
};

/**
 * EN / DE toggle for the public guest tipping journey.
 * Persists via the shared i18n localStorage key; does not change account settings unless logged in.
 */
export const CustomerJourneyLanguageSwitcher = memo(function CustomerJourneyLanguageSwitcher({
  className,
}: CustomerJourneyLanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const active = resolveAppLanguageFromCode(i18n.language || i18n.resolvedLanguage);
  const [pending, setPending] = useState<AppLanguage | null>(null);
  const display = pending ?? active;

  useLayoutEffect(() => {
    void prefetchCustomerJourneyLocaleBundles();
  }, []);

  const select = useCallback(
    (lng: AppLanguage) => {
      if (lng === display) return;
      setPending(lng);
      void (async () => {
        try {
          await ensureLocaleBundle(lng);
          await changeCustomerJourneyLanguage(lng);
        } finally {
          setPending(null);
        }
      })();
    },
    [display],
  );

  const baseBtn =
    "touch-manipulation inline-flex min-h-10 min-w-[2.75rem] flex-1 items-center justify-center rounded-lg px-3 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-9";

  return (
    <div
      className={cn("customer-journey-lang-switch shrink-0", className)}
      role="group"
      aria-label={t("nav.language")}
    >
      <button
        type="button"
        className={cn(
          baseBtn,
          display === "en"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        )}
        aria-pressed={display === "en"}
        onClick={() => select("en")}
      >
        EN
      </button>
      <button
        type="button"
        className={cn(
          baseBtn,
          display === "de"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        )}
        aria-pressed={display === "de"}
        onClick={() => select("de")}
      >
        DE
      </button>
    </div>
  );
});
