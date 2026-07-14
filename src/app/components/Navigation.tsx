import { useLocation } from "react-router";
import { memo, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useMobileMenuState } from "../hooks/useMobileMenuState";
import { Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { landingUi } from "@/components/landing/landingUi";
import { cn } from "@/lib/utils";
import { CareTipLogo } from "./CareTipLogo";
import { useTheme } from "../context/ThemeContext";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { ThemeQuickToggle } from "@/app/components/theme/ThemeQuickToggle";
import { PrefetchLink } from "./PrefetchLink";
import { prefetchLandingRoute, prefetchPrimaryNavRoutes } from "../lib/prefetchPublicRoutes";
import { usePublicMountProbe } from "@/lib/publicMountProbe";
import { scheduleMobileDeferredWork } from "@/lib/mobilePerf";

let primaryNavPrefetchScheduled = false;

const NAV_ROUTES = [
  { to: "/features" as const, nameKey: "nav.features" },
  { to: "/pricing" as const, nameKey: "nav.pricing" },
  { to: "/faq" as const, nameKey: "nav.faq" },
  { to: "/contact" as const, nameKey: "nav.contact" },
] as const;

export type NavigationVariant = "default" | "dark";

export const Navigation = memo(function Navigation({ variant = "default" }: { variant?: NavigationVariant }) {
  usePublicMountProbe("Navigation");
  const { t, i18n } = useTranslation();
  const { mobileMenuOpen, toggleMobileMenu, closeMobileMenu, backdropDismissible } =
    useMobileMenuState();
  const location = useLocation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark" || variant === "dark";

  useEffect(() => {
    if (primaryNavPrefetchScheduled) return;
    primaryNavPrefetchScheduled = true;
    scheduleMobileDeferredWork(() => {
      prefetchPrimaryNavRoutes();
    });
  }, []);

  useEffect(() => {
    if (location.pathname === "/") return;
    scheduleMobileDeferredWork(
      () => {
        prefetchLandingRoute();
      },
      { desktopTimeoutMs: 1200, mobileTimeoutMs: 2200 },
    );
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[data-mobile-nav-toolbar-menu-open="true"]')) return;
      closeMobileMenu("immediate");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen, closeMobileMenu]);

  const navLinks = useMemo(
    () => NAV_ROUTES.map((r) => ({ ...r, label: t(r.nameKey) })),
    [t, i18n.language],
  );

  const linkClass = cn(
    "caretip-public-nav-link text-sm font-semibold text-foreground transition-[color,background-color,opacity] duration-200",
    "hover:text-primary active:opacity-85 rounded-lg px-2.5 py-1.5 hover:bg-muted/60",
  );

  const headerSurface = cn(
    "caretip-public-nav border-b border-border/88",
    "bg-background/88 backdrop-blur-md md:backdrop-blur-lg",
    "shadow-[0_6px_32px_-18px_rgba(15,23,42,0.12)] dark:shadow-[0_8px_32px_-16px_rgba(0,0,0,0.45)]",
  );

  const mobileDrawer =
    mobileMenuOpen && typeof document !== "undefined"
      ? createPortal(
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className={cn(
                "caretip-public-mobile-nav-backdrop caretip-mobile-drawer-backdrop--open",
                "fixed inset-0 z-[240] touch-manipulation bg-black/55 lg:hidden",
                !backdropDismissible && "pointer-events-none",
              )}
              onClick={() => closeMobileMenu("backdrop")}
            />
            <aside
              id="mobile-main-nav"
              role="dialog"
              aria-modal="true"
              aria-label={t("nav.mainNav")}
              className={cn(
                "caretip-public-mobile-nav-drawer caretip-mobile-drawer-panel--open-left",
                "fixed left-0 top-0 z-[250] flex h-[100dvh] w-[88vw] max-w-[90vw] flex-col",
                "border-r border-border/50 bg-background shadow-[12px_0_48px_-16px_rgba(15,23,42,0.28)] lg:hidden",
                "dark:shadow-[12px_0_48px_-16px_rgba(0,0,0,0.65)]",
              )}
            >
              <div className="relative shrink-0 overflow-visible px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
                <div className="flex items-center justify-between gap-2">
                <PrefetchLink
                  to="/"
                  onClick={() => closeMobileMenu("navigate")}
                  className="flex min-h-11 min-w-0 flex-1 items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <CareTipLogo size="nav" />
                </PrefetchLink>
                <div
                  className="caretip-public-mobile-nav-drawer__toolbar relative z-30 flex shrink-0 items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <LanguageSwitcher variant="drawer" />
                  <ThemeQuickToggle variant="drawer" />
                  <button
                    type="button"
                    onClick={() => closeMobileMenu("toggle")}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card text-foreground shadow-sm transition-colors hover:bg-muted/70 active:bg-muted"
                    aria-label={t("nav.closeMenu")}
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                </div>
              </div>

              <div className="mx-5 shrink-0 border-t border-border/60" />

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 py-5">
                <nav className="flex flex-col gap-0.5" aria-label={t("nav.mobileNavigationSection")}>
                  {navLinks.map((link) => (
                    <PrefetchLink
                      key={link.to}
                      to={link.to}
                      className={cn(
                        "caretip-public-mobile-nav-drawer__nav-link min-h-14",
                        location.pathname === link.to && "caretip-public-mobile-nav-drawer__nav-link--active",
                      )}
                      onClick={() => closeMobileMenu("navigate")}
                    >
                      {link.label}
                    </PrefetchLink>
                  ))}
                </nav>

                <div className="my-5 border-t border-border/60" />

                <div className="flex flex-col gap-0.5" aria-label={t("nav.mobileAccountSection")}>
                  <PrefetchLink
                    to="/join"
                    onClick={() => closeMobileMenu("navigate")}
                    className={cn(
                      "caretip-public-mobile-nav-drawer__account-link min-h-14",
                      location.pathname === "/join" && "text-primary",
                    )}
                  >
                    {t("nav.staffPortal")}
                  </PrefetchLink>
                  <PrefetchLink
                    to="/login"
                    onClick={() => closeMobileMenu("navigate")}
                    className={cn(
                      "caretip-public-mobile-nav-drawer__account-link min-h-14",
                      location.pathname === "/login" && "text-primary",
                    )}
                  >
                    {t("nav.logIn")}
                  </PrefetchLink>
                </div>

                <div className="flex-1 min-h-4" aria-hidden />
              </div>

              <div className="shrink-0 border-t border-border/60 px-5 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                <div className="flex flex-col gap-3">
                  <PrefetchLink
                    to="/signup"
                    onClick={() => closeMobileMenu("navigate")}
                    className={cn(
                      landingUi.heroCtaPrimary,
                      "caretip-public-mobile-nav-drawer__cta-primary !mx-0 w-full max-w-none",
                    )}
                  >
                    {t("landing.showcase.primaryCta")}
                  </PrefetchLink>
                  <PrefetchLink
                    to="/contact"
                    onClick={() => closeMobileMenu("navigate")}
                    className={cn(
                      landingUi.heroCtaSecondary,
                      "caretip-public-mobile-nav-drawer__cta-secondary !mx-0 w-full max-w-none",
                    )}
                  >
                    {t("nav.requestDemo")}
                  </PrefetchLink>
                </div>
              </div>
            </aside>
          </>,
          document.body,
        )
      : null;

  return (
    <>
      <header
        className={cn(
          "sticky top-0 left-0 right-0 z-50 w-full max-w-[100vw] overflow-x-clip",
          headerSurface,
        )}
      >
        <nav
          className="relative mx-auto max-w-7xl min-h-0 min-w-0 px-4 py-2 sm:px-6 sm:py-2.5 lg:px-8 lg:py-3.5"
          aria-label={t("nav.mainNav")}
        >
          <div className="relative flex min-h-0 min-w-0 max-w-full items-center justify-between gap-2 sm:gap-4">
            <PrefetchLink
              to="/"
              className={cn(
                "relative z-[2] flex h-[3.5rem] min-h-[3.5rem] min-w-0 items-center overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-[3.5rem] sm:min-h-[3.5rem] md:h-16 md:min-h-[4rem] lg:h-16 lg:min-h-[4rem] xl:h-[4.25rem] xl:min-h-[4.25rem]",
                "max-w-[calc(100%-5.5rem)] shrink-0 md:max-w-[min(240px,42vw)] lg:max-w-[min(260px,36vw)]",
                "touch-manipulation",
                isDark && "rounded-xl bg-card px-2 py-1 shadow-sm ring-1 ring-border/60",
              )}
            >
              <CareTipLogo size="nav" />
            </PrefetchLink>

            <div
              className="pointer-events-none absolute left-1/2 top-1/2 z-[1] hidden -translate-x-1/2 -translate-y-1/2 items-center gap-6 lg:pointer-events-auto lg:flex xl:gap-8"
              aria-hidden={false}
            >
              {navLinks.map((link) => (
                <PrefetchLink
                  key={link.to}
                  to={link.to}
                  className={cn(
                    linkClass,
                    location.pathname === link.to && "text-primary bg-primary/[0.06] dark:bg-primary/[0.1]",
                  )}
                >
                  {link.label}
                </PrefetchLink>
              ))}
            </div>

            <div className="relative z-[2] hidden items-center gap-3 lg:flex shrink-0">
              <ThemeQuickToggle />
              <LanguageSwitcher />
              <PrefetchLink
                to="/join"
                className={cn(
                  linkClass,
                  location.pathname === "/join" && "text-primary bg-primary/[0.06] dark:bg-primary/[0.1]",
                )}
              >
                {t("nav.staffPortal")}
              </PrefetchLink>
              <PrefetchLink
                to="/login"
                className={cn(
                  linkClass,
                  location.pathname === "/login" && "text-primary bg-primary/[0.06] dark:bg-primary/[0.1]",
                )}
              >
                {t("nav.logIn")}
              </PrefetchLink>
            </div>

            <div className="relative z-[2] flex items-center gap-2 lg:hidden">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleMobileMenu();
                }}
                className={cn(
                  "relative shrink-0 touch-manipulation rounded-lg p-2.5 transition-colors active:opacity-90",
                  "hover:bg-muted/80 active:bg-muted",
                )}
                style={{ color: "hsl(var(--foreground))" }}
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-main-nav"
                aria-label={mobileMenuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
              >
                {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </nav>
      </header>
      {mobileDrawer}
    </>
  );
});
