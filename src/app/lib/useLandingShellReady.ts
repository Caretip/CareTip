import { useLayoutEffect } from "react";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
  useReleaseAppBootOverlay,
} from "../context/AppLoadingManager";
import { markLandingColdLoad } from "./landingColdLoadMarks";
import { isAppShellInteractive } from "./appShellLifecycle";
import { warmLandingHeroLcpImage } from "@/lib/landingHeroStoryAssets";

export const LANDING_SHELL_READY_KEY = "landing-shell-ready";

/**
 * Landing cold boot: HTML `#caretip-html-boot` stays until this page commits.
 * Then fade the boot over the painted landing — never over an empty `#root`.
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
    markLandingColdLoad("landing-commit");
    if (softNav) return;
    void warmLandingHeroLcpImage();
  }, [releaseAppBootOverlay, softNav]);
}
