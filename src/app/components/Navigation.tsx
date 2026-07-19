import { useLocation } from "react-router";
import { memo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMobileMenuState } from "../hooks/useMobileMenuState";
import { Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { landingUi } from "@/components/landing/landingUi";
import { cn } from "@/lib/utils";
import { CareTipLogo } from "./CareTipLogo";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { ThemeQuickToggle } from "@/app/components/theme/ThemeQuickToggle";
import { PrefetchLink } from "./PrefetchLink";
import { IndustriesNavDropdown } from "./IndustriesNavDropdown";
import { prefetchLandingRoute, prefetchPrimaryNavRoutes } from "../lib/prefetchPublicRoutes";
import { usePublicMountProbe } from "@/lib/publicMountProbe";
import { scheduleMobileDeferredWork } from "@/lib/mobilePerf";

let primaryNavPrefetchScheduled = false;

const NAV_ROUTES_BEFORE_INDUSTRIES = [
  { to: "/features" as const, nameKey: "nav.features" },
] as const;

const NAV_ROUTES_AFTER_INDUSTRIES = [
  { to: "/pricing" as const, nameKey: "nav.pricing" },
  { to: "/faq" as const, nameKey: "nav.faq" },
  { to: "/contact" as const, nameKey: "nav.contact" },
  { to: "/join" as const, nameKey: "nav.staffPortal", accent: true },
] as const;

export type NavigationVariant = "default" | "dark";

export const Navigation = memo(function Navigation({ variant: _variant = "default" }: { variant?: NavigationVariant }) {
  usePublicMountProbe("Navigation");
  const { t } = useTranslation();
  const { mobileMenuOpen, toggleMobileMenu, closeMobileMenu, backdropDismissible } =
    useMobileMenuState();
  const location = useLocation();

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

  const linkClass = cn(
    "caretip-public-nav-link text-sm font-semibold tracking-[-0.01em] text-foreground transition-[color,background-color,opacity] duration-200",
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
                "fixed inset-0 z-[250] flex h-[100dvh] w-full max-w-none flex-col",
                "bg-background lg:hidden",
              )}
            >
              <div className="relative shrink-0 overflow-visible px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
                <div className="flex items-center justify-between gap-2">
                <PrefetchLink
                  to="/"
                  onClick={() => closeMobileMenu("navigate")}
                  className="flex min-h-11 min-w-0 flex-1 items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <CareTipLogo size="nav" variant="wordmark" />
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
                  {NAV_ROUTES_BEFORE_INDUSTRIES.map((route) => (
                    <PrefetchLink
                      key={route.to}
                      to={route.to}
                      className={cn(
                        "caretip-public-mobile-nav-drawer__nav-link min-h-14",
                        location.pathname === route.to && "caretip-public-mobile-nav-drawer__nav-link--active",
                      )}
                      onClick={() => closeMobileMenu("navigate")}
                    >
                      {t(route.nameKey)}
                    </PrefetchLink>
                  ))}
                  <IndustriesNavDropdown
                    variant="mobile"
                    linkClass={linkClass}
                    onNavigate={() => closeMobileMenu("navigate")}
                  />
                  {NAV_ROUTES_AFTER_INDUSTRIES.map((route) => (
                    <PrefetchLink
                      key={route.to}
                      to={route.to}
                      className={cn(
                        "caretip-public-mobile-nav-drawer__nav-link min-h-14",
                        "accent" in route && route.accent && "caretip-public-mobile-nav-drawer__nav-link--accent",
                        location.pathname === route.to && "caretip-public-mobile-nav-drawer__nav-link--active",
                      )}
                      onClick={() => closeMobileMenu("navigate")}
                    >
                      {t(route.nameKey)}
                    </PrefetchLink>
                  ))}
                </nav>

                <div className="my-5 border-t border-border/60" />

                <div className="flex flex-col gap-0.5" aria-label={t("nav.mobileAccountSection")}>
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
          className="relative mx-auto max-w-7xl min-h-0 min-w-0 px-4 py-2.5 sm:px-6 sm:py-3 lg:px-8 lg:py-3.5"
          aria-label={t("nav.mainNav")}
        >
          <div className="relative grid min-h-0 min-w-0 max-w-full grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,auto)] items-center gap-2 sm:gap-3 lg:gap-4">
            <PrefetchLink
              to="/"
              className={cn(
                "relative z-[2] flex h-[3.5rem] min-h-[3.5rem] min-w-0 items-center overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-[3.5rem] sm:min-h-[3.5rem] md:h-16 md:min-h-[4rem] lg:h-16 lg:min-h-[4rem] xl:h-[4.25rem] xl:min-h-[4.25rem]",
                "max-w-[min(248px,42vw)] shrink-0 lg:max-w-[min(268px,28vw)]",
                "touch-manipulation",
              )}
            >
              <CareTipLogo size="nav" variant="wordmark" />
            </PrefetchLink>

            <div
              className="hidden min-w-0 items-center justify-center gap-1.5 overflow-x-clip lg:flex xl:gap-3 2xl:gap-5"
              aria-hidden={false}
            >
              {NAV_ROUTES_BEFORE_INDUSTRIES.map((route) => (
                <PrefetchLink
                  key={route.to}
                  to={route.to}
                  className={cn(
                    linkClass,
                    "shrink-0 whitespace-nowrap px-1.5 xl:px-2.5",
                    location.pathname === route.to && "text-primary bg-primary/[0.06] dark:bg-primary/[0.1]",
                  )}
                >
                  {t(route.nameKey)}
                </PrefetchLink>
              ))}
              <IndustriesNavDropdown variant="desktop" linkClass={cn(linkClass, "shrink-0 whitespace-nowrap px-1.5 xl:px-2.5")} />
              {NAV_ROUTES_AFTER_INDUSTRIES.map((route) => (
                <PrefetchLink
                  key={route.to}
                  to={route.to}
                  className={cn(
                    linkClass,
                    "shrink-0 whitespace-nowrap px-1.5 xl:px-2.5",
                    "accent" in route && route.accent && "text-primary",
                    location.pathname === route.to && "text-primary bg-primary/[0.06] dark:bg-primary/[0.1]",
                  )}
                >
                  {t(route.nameKey)}
                </PrefetchLink>
              ))}
            </div>

            <div className="relative z-[2] flex shrink-0 items-center justify-end gap-2 sm:gap-2.5 lg:gap-2.5 xl:gap-3.5">
              <div className="hidden items-center gap-2 lg:flex xl:gap-3">
                <ThemeQuickToggle />
                <LanguageSwitcher />
                <PrefetchLink
                  to="/login"
                  className={cn(
                    linkClass,
                    "whitespace-nowrap",
                    location.pathname === "/login" && "text-primary bg-primary/[0.06] dark:bg-primary/[0.1]",
                  )}
                >
                  {t("nav.logIn")}
                </PrefetchLink>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleMobileMenu();
                }}
                className={cn(
                  "relative shrink-0 touch-manipulation rounded-lg p-2.5 transition-colors active:opacity-90 lg:hidden",
                  "inline-flex items-center justify-center hover:bg-muted/80 active:bg-muted",
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
