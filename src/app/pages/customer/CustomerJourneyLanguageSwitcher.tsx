import { memo, useCallback, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { LanguageSelectDropdown } from "@/components/i18n/LanguageSwitcher";
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
 * EN / DE selector for the public guest tipping journey (template-style dropdown).
 */
export const CustomerJourneyLanguageSwitcher = memo(function CustomerJourneyLanguageSwitcher({
  className,
}: CustomerJourneyLanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const active = resolveAppLanguageFromCode(i18n.language || i18n.resolvedLanguage);
  const [pending, setPending] = useState<AppLanguage | null>(null);
  const [open, setOpen] = useState(false);
  const display = pending ?? active;

  useLayoutEffect(() => {
    void prefetchCustomerJourneyLocaleBundles();
  }, []);

  const select = useCallback(
    (lng: AppLanguage) => {
      if (lng === display) {
        setOpen(false);
        return;
      }
      setPending(lng);
      void (async () => {
        try {
          await ensureLocaleBundle(lng);
          await changeCustomerJourneyLanguage(lng);
          setOpen(false);
        } finally {
          setPending(null);
        }
      })();
    },
    [display],
  );

  return (
    <LanguageSelectDropdown
      displayLang={display}
      open={open}
      onOpenChange={setOpen}
      onSelect={select}
      variant="header"
      className={cn("customer-journey-lang-switch", className)}
      ariaLabel={t("nav.language")}
    />
  );
});
