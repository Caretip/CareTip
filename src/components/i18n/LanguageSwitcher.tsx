import { useState, useCallback, memo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { patchMyAccountSettings, hasClientAccessToken } from "@/app/lib/api";
import {
  changeAppLanguage,
  prefetchAlternateLocaleBundle,
  resolveAppLanguageFromCode,
  type AppLanguage,
} from "@/i18n/i18n";
import "@/styles/caretip-language-select.css";
import { LanguageFlag } from "./LanguageFlag";

type LanguageSwitcherProps = {
  className?: string;
  /** Header: light surface. Inline: footer / dark band. Drawer: full-width mobile nav row. Dashboard: semantic tokens. */
  variant?: "header" | "inline" | "drawer" | "dashboard";
};

const LANGUAGE_OPTIONS: {
  code: AppLanguage;
  labelKey: "nav.languageEnglish" | "nav.languageGerman";
}[] = [
  { code: "en", labelKey: "nav.languageEnglish" },
  { code: "de", labelKey: "nav.languageGerman" },
];

function optionFor(code: AppLanguage) {
  return LANGUAGE_OPTIONS.find((o) => o.code === code) ?? LANGUAGE_OPTIONS[0]!;
}

type LanguageSelectDropdownProps = {
  displayLang: AppLanguage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (lng: AppLanguage) => void;
  variant: LanguageSwitcherProps["variant"];
  className?: string;
  ariaLabel: string;
};

export const LanguageSelectDropdown = memo(function LanguageSelectDropdown({
  displayLang,
  open,
  onOpenChange,
  onSelect,
  variant = "header",
  className,
  ariaLabel,
}: LanguageSelectDropdownProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const active = optionFor(displayLang);
  const inactiveOptions = LANGUAGE_OPTIONS.filter((o) => o.code !== displayLang);

  const variantClass =
    variant === "inline"
      ? "caretip-lang-select--inline"
      : variant === "dashboard" || variant === "drawer"
        ? ""
        : "caretip-lang-select--header";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "caretip-lang-select",
        variantClass,
        open && "caretip-lang-select--open",
        className?.includes("caretip-public-nav__lang-compact") && "caretip-lang-select--compact",
        className?.includes("caretip-lang-select--utility") && "caretip-lang-select--utility",
        className,
      )}
      data-mobile-nav-toolbar-menu-open={variant === "drawer" && open ? "true" : undefined}
    >
      <button
        type="button"
        className="caretip-lang-select__trigger touch-manipulation"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => onOpenChange(!open)}
      >
        <LanguageFlag language={active.code} className="caretip-lang-select__flag" />
        <span className="caretip-lang-select__label truncate">{t(active.labelKey)}</span>
        {open ? (
          <ChevronUp className="caretip-lang-select__chevron" aria-hidden strokeWidth={2.5} />
        ) : (
          <ChevronDown className="caretip-lang-select__chevron" aria-hidden strokeWidth={2.5} />
        )}
      </button>
      {open && inactiveOptions.length > 0 ? (
        <div className="caretip-lang-select__panel" role="listbox" aria-label={ariaLabel}>
          {inactiveOptions.map((opt) => (
            <button
              key={opt.code}
              type="button"
              role="option"
              aria-selected={false}
              className="caretip-lang-select__row"
              onClick={() => onSelect(opt.code)}
            >
              <LanguageFlag language={opt.code} className="caretip-lang-select__flag" />
              <span className="caretip-lang-select__label">{t(opt.labelKey)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});

export const LanguageSwitcher = memo(function LanguageSwitcher({
  className,
  variant = "header",
}: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pendingLang, setPendingLang] = useState<AppLanguage | null>(null);
  const active = resolveAppLanguageFromCode(i18n.language || i18n.resolvedLanguage);
  const displayLang = pendingLang ?? active;

  const setLang = useCallback((lng: AppLanguage) => {
    if (lng === displayLang) {
      setOpen(false);
      return;
    }
    setPendingLang(lng);
    void changeAppLanguage(lng)
      .then(() => {
        setOpen(false);
        try {
          if (hasClientAccessToken()) {
            void patchMyAccountSettings({ preferredLocale: lng });
          }
        } catch {
          /* logged-out or network — ignore */
        }
      })
      .catch(() => {
        /* Keep menu open if bundle load fails */
      })
      .finally(() => setPendingLang(null));
  }, [displayLang]);

  useEffect(() => {
    if (open) void prefetchAlternateLocaleBundle();
  }, [open]);

  return (
    <LanguageSelectDropdown
      displayLang={displayLang}
      open={open}
      onOpenChange={setOpen}
      onSelect={setLang}
      variant={variant}
      className={className}
      ariaLabel={t("nav.language")}
    />
  );
});
