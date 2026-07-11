import { useState, useCallback, memo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Check, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import { patchMyAccountSettings, hasClientAccessToken } from "@/app/lib/api";
import { changeAppLanguage, type AppLanguage } from "@/i18n/i18n";

type LanguageSwitcherProps = {
  className?: string;
  /** Header: light surface. Inline: footer / dark band. Drawer: full-width mobile nav row. Dashboard: semantic tokens. */
  variant?: "header" | "inline" | "drawer" | "dashboard";
};

export const LanguageSwitcher = memo(function LanguageSwitcher({
  className,
  variant = "header",
}: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pendingLang, setPendingLang] = useState<AppLanguage | null>(null);
  const active = i18n.resolvedLanguage?.toLowerCase().startsWith("de") ? "de" : "en";
  const displayLang = pendingLang ?? active;

  const isInline = variant === "inline";
  const isDrawer = variant === "drawer";
  const isDashboard = variant === "dashboard";
  const useSemanticSurface = isDashboard || isDrawer;

  const triggerBase =
    "touch-manipulation inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-[15px] font-semibold tracking-tight transition-[colors,opacity,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:opacity-90 lg:min-h-9 lg:text-sm lg:px-3.5";

  const triggerStyles = useSemanticSurface
    ? "border-border bg-card text-foreground shadow-sm hover:bg-muted/60 focus-visible:ring-ring focus-visible:ring-offset-background"
    : isInline
    ? "border-white/25 bg-white/10 text-white shadow-[0_1px_0_rgba(255,255,255,0.08)_inset] hover:border-white/35 hover:bg-white/[0.14] focus-visible:ring-white/40 focus-visible:ring-offset-neutral-950"
    : "border-neutral-200/90 bg-white text-neutral-900 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_4px_14px_rgba(15,23,42,0.06)] hover:border-neutral-300 hover:bg-neutral-50/90 focus-visible:ring-[#e9781c]/35 focus-visible:ring-offset-background";

  const menuSurface = useSemanticSurface
    ? "border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
    : isInline
    ? "border-white/15 bg-neutral-950/98 p-1.5 text-white shadow-xl backdrop-blur-md"
    : "border-neutral-200/80 bg-white p-1.5 text-neutral-900 shadow-xl";

  const rowBase =
    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] font-semibold transition-colors lg:text-sm";

  const rowIdle = useSemanticSurface
    ? "text-muted-foreground hover:bg-muted"
    : isInline
    ? "text-neutral-200 hover:bg-white/10"
    : "text-neutral-700 hover:bg-neutral-100";

  const rowActive = useSemanticSurface
    ? "bg-primary/10 text-foreground"
    : isInline
    ? "bg-white/12 text-white"
    : "bg-[#fff6e8] text-neutral-900";

  const setLang = useCallback((lng: AppLanguage) => {
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
  }, []);

  const closeMenu = useCallback(() => setOpen(false), []);
  const drawerRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDrawer || !open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!drawerRootRef.current?.contains(event.target as Node)) closeMenu();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeMenu();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isDrawer, open, closeMenu]);

  if (isDrawer) {
    return (
      <div
        ref={drawerRootRef}
        className={cn("relative shrink-0", className)}
        data-mobile-nav-toolbar-menu-open={open ? "true" : undefined}
      >
        <button
          type="button"
          className={cn(
            triggerBase,
            triggerStyles,
            "caretip-public-mobile-nav-drawer__lang-trigger min-h-10 min-w-10 shrink-0 px-3",
          )}
          aria-label={t("nav.language")}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((value) => !value)}
        >
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="tabular-nums">{displayLang === "de" ? "DE" : "EN"}</span>
        </button>
        {open ? (
          <div
            className={cn(
              "absolute right-0 top-[calc(100%+0.5rem)] z-20 flex min-w-[12.5rem] flex-col gap-0.5 rounded-xl border p-1.5 shadow-xl",
              menuSurface,
            )}
            role="listbox"
            aria-label={t("nav.language")}
          >
            <button
              type="button"
              role="option"
              aria-selected={displayLang === "en"}
              className={cn(rowBase, displayLang === "en" ? rowActive : rowIdle)}
              onClick={() => setLang("en")}
            >
              <span>{t("nav.languageEnglish")}</span>
              {displayLang === "en" ? (
                <Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
              ) : null}
            </button>
            <button
              type="button"
              role="option"
              aria-selected={displayLang === "de"}
              className={cn(rowBase, displayLang === "de" ? rowActive : rowIdle)}
              onClick={() => setLang("de")}
            >
              <span>{t("nav.languageGerman")}</span>
              {displayLang === "de" ? (
                <Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
              ) : null}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(triggerBase, triggerStyles, className)}
          aria-label={t("nav.language")}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Globe className={cn("h-4 w-4 shrink-0 opacity-90", isInline ? "text-white/90" : useSemanticSurface ? "text-muted-foreground" : "text-neutral-600")} aria-hidden />
          <span className="tabular-nums">{displayLang === "de" ? "DE" : "EN"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className={cn("w-[min(100vw-1.5rem,200px)] rounded-xl p-0", menuSurface)}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-0.5" role="listbox" aria-label={t("nav.language")}>
          <button
            type="button"
            role="option"
            aria-selected={displayLang === "en"}
            className={cn(rowBase, displayLang === "en" ? rowActive : rowIdle)}
            onClick={() => setLang("en")}
          >
            <span>{t("nav.languageEnglish")}</span>
            {displayLang === "en" ? (
              <Check
                className={cn("h-4 w-4 shrink-0", isInline ? "text-amber-300" : useSemanticSurface ? "text-primary" : "text-[#b45309]")}
                strokeWidth={2.5}
                aria-hidden
              />
            ) : null}
          </button>
          <button
            type="button"
            role="option"
            aria-selected={displayLang === "de"}
            className={cn(rowBase, displayLang === "de" ? rowActive : rowIdle)}
            onClick={() => setLang("de")}
          >
            <span>{t("nav.languageGerman")}</span>
            {displayLang === "de" ? (
              <Check
                className={cn("h-4 w-4 shrink-0", isInline ? "text-amber-300" : useSemanticSurface ? "text-primary" : "text-[#b45309]")}
                strokeWidth={2.5}
                aria-hidden
              />
            ) : null}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
});
