import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../context/AppLoadingManager";
import { resolveAppLoadingContextMessage } from "./appLoadingContexts";
import { isAppShellInteractive } from "./appShellLifecycle";
import {
  isLandingHeroLcpWarm,
  warmLandingHeroLcpImage,
} from "@/lib/landingHeroStoryAssets";

export const LANDING_SHELL_READY_KEY = "landing-shell-ready";

/** Floor for a below-fold host to count as reserving space (well below the first section's 52rem). */
const PLACEHOLDER_RESERVE_FLOOR_PX = 100;

/** Cap so a stalled image never leaves the branded overlay forever. */
const HERO_LCP_WAIT_MS = 2500;

function reservedHostHeightPx(host: HTMLElement): number {
  const offset = host.offsetHeight;
  if (offset >= PLACEHOLDER_RESERVE_FLOOR_PX) return offset;

  const minHeight = getComputedStyle(host).minHeight;
  if (!minHeight || minHeight === "auto" || minHeight === "none" || minHeight === "0px") {
    return offset;
  }

  const parsed = Number.parseFloat(minHeight);
  return Number.isFinite(parsed) ? Math.max(offset, parsed) : offset;
}

/**
 * Semantic shell readiness — not a scrollHeight delta heuristic.
 * Requires the first lazy host to exist, preserve height, and extend <main> beyond the hero.
 */
function isLandingShellLayoutStable(heroId: string): boolean {
  const hero = document.getElementById(heroId);
  if (!hero) return false;

  const heroHeight = hero.getBoundingClientRect().height;
  if (heroHeight < 1) return false;

  const main = document.querySelector(".caretip-landing-main");
  if (!main) return false;

  const placeholder = main.querySelector<HTMLElement>("[data-landing-lazy-host]");
  if (!placeholder) return false;

  const reservedPx = reservedHostHeightPx(placeholder);
  if (reservedPx < PLACEHOLDER_RESERVE_FLOOR_PX) return false;

  return main.scrollHeight >= heroHeight + reservedPx;
}

function isHeroLcpPainted(): boolean {
  if (isLandingHeroLcpWarm()) return true;
  const img = document.querySelector('[data-hero-frame="wyc"] img');
  return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
}

/**
 * Holds the global branded overlay until the landing shell is visually ready —
 * cold URL entry only. Soft SPA remounts of `/` must never reopen the overlay.
 */
export function useLandingShellReady(heroId = "about-section"): void {
  const { t } = useTranslation();
  const softNav = isAppShellInteractive();
  const [shellReady, setShellReady] = useState(softNav);

  useAppLoadingRegistration(
    LANDING_SHELL_READY_KEY,
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    !softNav && !shellReady,
    resolveAppLoadingContextMessage("landing", t),
  );

  useLayoutEffect(() => {
    if (softNav || shellReady) return;

    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    let pollId = 0;
    let forceTimer = 0;
    const releasedRef = { current: false };

    const release = (): void => {
      if (cancelled || releasedRef.current) return;
      releasedRef.current = true;
      setShellReady(true);
    };

    const tryRelease = (): void => {
      if (cancelled || releasedRef.current) return;
      if (isLandingShellLayoutStable(heroId) && isHeroLcpPainted()) {
        release();
      }
    };

    void warmLandingHeroLcpImage().then(() => {
      if (!cancelled) tryRelease();
    });

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        tryRelease();
        if (cancelled || releasedRef.current) return;

        pollId = window.setInterval(() => {
          tryRelease();
        }, 50);

        forceTimer = window.setTimeout(() => {
          release();
        }, HERO_LCP_WAIT_MS);
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      if (pollId) window.clearInterval(pollId);
      if (forceTimer) window.clearTimeout(forceTimer);
    };
  }, [heroId, shellReady, softNav]);
}
