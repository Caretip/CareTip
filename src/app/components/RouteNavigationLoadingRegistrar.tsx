import type { ReactNode } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigation } from "react-router";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
  useReleaseAppBootOverlay,
} from "../context/AppLoadingManager";
import { resolveRouteLoadingMessage } from "../lib/appLoadingContexts";
import { shouldRegisterBrandedRouteNavigation } from "../lib/appLoadingJourney";
import { isAppShellInteractive } from "../lib/appShellLifecycle";
import { isPublicMarketingPath } from "../lib/publicRoutes";

function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Cold entry only: branded overlay while React Router resolves the first paint.
 * After the shell is interactive, SPA navigations never re-register the global loader.
 *
 * Landing (`/`) keeps `app-boot` until `landing-shell-ready` owns the overlay on cold boot.
 */
export function RouteNavigationLoadingRegistrar({ children }: { children: ReactNode }) {
  const navigation = useNavigation();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const pending = navigation.state === "loading";
  const softNav = isAppShellInteractive();
  const brandedRouteNavigation =
    !softNav && pending && shouldRegisterBrandedRouteNavigation(pathname);
  const releaseAppBootOverlay = useReleaseAppBootOverlay();
  const pathOnly = pathname.split("?")[0]?.split("#")[0] ?? pathname;

  useAppLoadingRegistration(
    "route-navigation",
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    brandedRouteNavigation,
    resolveRouteLoadingMessage(pathname, t),
  );

  useEffect(() => {
    /* Landing readiness owns the cold handoff — never drop app-boot here. */
    if (pathOnly === "/") return;

    const shouldReleaseBoot =
      isPublicMarketingPath(pathname) || isStandaloneDisplayMode();
    if (!shouldReleaseBoot) return;
    if (navigation.state === "loading") return;

    let cancelled = false;
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (!cancelled) releaseAppBootOverlay();
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [navigation.state, pathname, pathOnly, releaseAppBootOverlay]);

  return <>{children}</>;
}
