import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import { useTheme, type ThemePreference } from "@/app/context/ThemeContext";

type ThemeQuickToggleProps = {
  className?: string;
  /** Inline menu inside mobile nav drawer (no portal — avoids z-index conflicts). */
  variant?: "default" | "drawer";
};

const OPTIONS: { value: ThemePreference; labelKey: string; Icon: typeof Sun }[] = [
  { value: "light", labelKey: "theme.appearance.light", Icon: Sun },
  { value: "dark", labelKey: "theme.appearance.dark", Icon: Moon },
  { value: "system", labelKey: "theme.appearance.system", Icon: Monitor },
];

const triggerPillClass =
  "touch-manipulation inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card px-3 py-2 text-foreground shadow-sm transition-[colors,opacity,transform] outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] active:opacity-90 lg:min-h-9";

const drawerMenuClass =
  "absolute right-0 top-[calc(100%+0.5rem)] z-20 flex min-w-[12.5rem] flex-col gap-0.5 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl";

function useDrawerMenuDismiss(open: boolean, onClose: () => void) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose]);

  return rootRef;
}

export const ThemeQuickToggle = memo(function ThemeQuickToggle({
  className,
  variant = "default",
}: ThemeQuickToggleProps) {
  const { t } = useTranslation();
  const { preference, setPreference, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const closeMenu = useCallback(() => setOpen(false), []);
  const drawerRootRef = useDrawerMenuDismiss(open && variant === "drawer", closeMenu);

  const ActiveIcon = resolvedTheme === "dark" ? Moon : Sun;

  if (variant === "drawer") {
    return (
      <div
        ref={drawerRootRef}
        className={cn("relative shrink-0", className)}
        data-mobile-nav-toolbar-menu-open={open ? "true" : undefined}
      >
        <button
          type="button"
          className={triggerPillClass}
          aria-label={t("theme.appearance.toggleAria")}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((value) => !value)}
        >
          <ActiveIcon className="size-4 shrink-0" aria-hidden />
        </button>
        {open ? (
          <div className={drawerMenuClass} role="listbox" aria-label={t("theme.appearance.title")}>
            {OPTIONS.map(({ value, labelKey, Icon }) => {
              const selected = preference === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors touch-manipulation",
                    selected ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => {
                    setPreference(value);
                    setOpen(false);
                  }}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {t(labelKey)}
                  </span>
                  {selected ? <Check className="size-4 shrink-0 text-primary" strokeWidth={2.5} aria-hidden /> : null}
                </button>
              );
            })}
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
          className={cn(triggerPillClass, className)}
          aria-label={t("theme.appearance.toggleAria")}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <ActiveIcon className="size-4 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(100vw-1.5rem,220px)] rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-0.5" role="listbox" aria-label={t("theme.appearance.title")}>
          {OPTIONS.map(({ value, labelKey, Icon }) => {
            const selected = preference === value;
            return (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={selected}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors",
                  selected ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
                )}
                onClick={() => {
                  setPreference(value);
                  setOpen(false);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {t(labelKey)}
                </span>
                {selected ? <Check className="size-4 shrink-0 text-primary" strokeWidth={2.5} aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
});
