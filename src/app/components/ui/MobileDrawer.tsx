import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { DASHBOARD_MOBILE_DRAWER_PANEL_CLASS } from "@/lib/theme/dashboardSidebarUi";
import {
  MOBILE_MENU_DISMISS_GUARD_MS,
  canDismissMobileMenuOverlay,
} from "@/app/lib/mobileMenuDismissGuard";

type MobileDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Defaults to left slide-in panel. */
  side?: "left" | "top";
  ariaLabel?: string;
};

/**
 * Lightweight mobile drawer — instant open, short close, no backdrop-blur (mobile GPU friendly).
 */
export function MobileDrawer({
  isOpen,
  onClose,
  children,
  className,
  side = "left",
  ariaLabel,
}: MobileDrawerProps) {
  const reduceMotion = useReducedMotion();
  const openedAtRef = useRef(0);
  const [backdropDismissible, setBackdropDismissible] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setBackdropDismissible(false);
      return;
    }
    openedAtRef.current = performance.now();
    const id = window.setTimeout(
      () => setBackdropDismissible(true),
      MOBILE_MENU_DISMISS_GUARD_MS,
    );
    return () => window.clearTimeout(id);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    // The drawer cannot outrank root-level banners from its stacking context; see caretip-mobile-perf.css.
    html.dataset.caretipMobileDrawerOpen = "";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      delete html.dataset.caretipMobileDrawerOpen;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const panelMotionClass =
    side === "left"
      ? reduceMotion
        ? "translate-x-0"
        : "caretip-mobile-drawer-panel--open"
      : reduceMotion
        ? "translate-y-0 opacity-100"
        : "caretip-mobile-drawer-panel--open-top";

  const handleBackdropDismiss = () => {
    if (!backdropDismissible || !canDismissMobileMenuOverlay(openedAtRef.current)) return;
    onClose();
  };

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        className={cn(
          "fixed inset-0 z-40 touch-manipulation bg-black/50 lg:hidden",
          reduceMotion ? "opacity-100" : "caretip-mobile-drawer-backdrop--open",
          !backdropDismissible && "pointer-events-none",
        )}
        onClick={handleBackdropDismiss}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          "caretip-mobile-drawer-panel fixed z-50 flex touch-manipulation flex-col overflow-x-clip overscroll-contain lg:hidden",
          side === "left"
            ? cn(
                "inset-y-0 left-0 w-[min(100%,18rem)] max-w-[85vw] border-r",
                DASHBOARD_MOBILE_DRAWER_PANEL_CLASS,
              )
            : cn("left-0 right-0 top-full border-b shadow-lg", DASHBOARD_MOBILE_DRAWER_PANEL_CLASS),
          panelMotionClass,
          className,
        )}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </aside>
    </>
  );
}
