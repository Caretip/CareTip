import { useLayoutEffect } from "react";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
  useReleaseAppBootOverlay,
} from "../context/AppLoadingManager";
import { isAppShellInteractive } from "./appShellLifecycle";
import { warmLandingHeroLcpImage } from "@/lib/landingHeroStoryAssets";

export const LANDING_SHELL_READY_KEY = "landing-shell-ready";

/**
 * Landing cold boot: never hold the global “Getting things ready…” overlay for hero LCP.
 * HTML boot covers JS download; as soon as this page mounts, drop app-boot so the hero can paint.
 * Soft SPA remounts of `/` must never reopen the branded overlay (`isAppShellInteractive()`).
 */
export function useLandingShellReady(_heroId = "about-section"): void {
  const softNav = isAppShellInteractive();
  const releaseAppBootOverlay = useReleaseAppBootOverlay();

  useAppLoadingRegistration(
    LANDING_SHELL_READY_KEY,
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    false,
  );

  useLayoutEffect(() => {
    releaseAppBootOverlay();
    if (softNav) return;
    void warmLandingHeroLcpImage();
  }, [releaseAppBootOverlay, softNav]);
}
