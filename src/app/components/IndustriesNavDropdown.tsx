import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { INDUSTRY_NAV_ITEMS } from "@/app/data/industryPages";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import { cn } from "@/lib/utils";

type IndustriesNavDropdownProps = {
  linkClass: string;
  /** Mobile drawer: click to expand. Desktop: hover + click toggle. */
  variant: "desktop" | "mobile";
  onNavigate?: () => void;
};

export function IndustriesNavDropdown({
  linkClass,
  variant,
  onNavigate,
}: IndustriesNavDropdownProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const isIndustryRoute = location.pathname.startsWith("/industries/");

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openMenu = () => {
    clearCloseTimer();
    setOpen(true);
  };

  const scheduleCloseMenu = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 140);
  };

  useEffect(() => {
    setOpen(false);
    clearCloseTimer();
  }, [location.pathname]);

  useEffect(() => () => clearCloseTimer(), []);

  useEffect(() => {
    if (!open || variant !== "desktop") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, variant]);

  const label = t("nav.industries");

  if (variant === "mobile") {
    return (
      <div className="caretip-industries-nav caretip-industries-nav--mobile">
        <button
          type="button"
          className={cn(
            "caretip-public-mobile-nav-drawer__nav-link caretip-public-mobile-nav-drawer__nav-link--accent min-h-14 w-full justify-between",
            isIndustryRoute && "caretip-public-mobile-nav-drawer__nav-link--active",
          )}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((prev) => !prev)}
        >
          <span>{label}</span>
          <ChevronDown
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
        {open ? (
          <ul id={menuId} className="caretip-industries-nav__mobile-list" role="list">
            {INDUSTRY_NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <PrefetchLink
                  to={item.path}
                  className={cn(
                    "caretip-industries-nav__mobile-link",
                    location.pathname === item.path && "caretip-industries-nav__mobile-link--active",
                  )}
                  onClick={onNavigate}
                >
                  {t(item.labelKey)}
                </PrefetchLink>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="caretip-industries-nav caretip-industries-nav--desktop relative"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleCloseMenu}
    >
      <button
        type="button"
        className={cn(
          linkClass,
          "inline-flex items-center gap-1",
          (open || isIndustryRoute) && "text-primary bg-primary/[0.06] dark:bg-primary/[0.1]",
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((prev) => !prev)}
        onFocus={openMenu}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && rootRef.current?.contains(next)) return;
          scheduleCloseMenu();
        }}
      >
        {label}
        <ChevronDown
          className={cn("size-3.5 opacity-70 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      <div
        className={cn(
          "caretip-industries-nav__panel-wrap absolute left-1/2 top-full z-[60] -translate-x-1/2 pt-2",
          open ? "pointer-events-auto visible" : "pointer-events-none invisible",
        )}
        onMouseEnter={openMenu}
      >
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={cn(
            "caretip-industries-nav__panel w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border/80",
            "bg-background/95 p-1.5 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.45)] backdrop-blur-md",
            "dark:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.65)]",
            open ? "opacity-100" : "opacity-0",
            "transition-opacity duration-150",
          )}
        >
          <ul className="flex flex-col gap-0.5" role="none">
            {INDUSTRY_NAV_ITEMS.map((item) => (
              <li key={item.id} role="none">
                <PrefetchLink
                  role="menuitem"
                  to={item.path}
                  className={cn(
                    "block rounded-lg px-3 py-2.5 text-sm font-semibold text-foreground/90 transition-colors",
                    "hover:bg-muted/70 hover:text-primary",
                    location.pathname === item.path && "bg-primary/[0.08] text-primary",
                  )}
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.();
                  }}
                >
                  {t(item.labelKey)}
                </PrefetchLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
