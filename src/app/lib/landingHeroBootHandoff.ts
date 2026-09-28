import { useLayoutEffect, type RefObject } from "react";
import { useCompleteHtmlBootAfterPublicPaint } from "../context/AppLoadingManager";
import { isAppShellInteractive, markAppShellInteractive } from "./appShellLifecycle";
import { markLandingColdLoad } from "./landingColdLoadMarks";
import { LANDING_HERO_READY_ATTR } from "./landingHeroReadyDom";

/**
 * Call from CareTipLandingHero after the hero section is in the document.
 * Completes HTML boot handoff only after critical hero paint (cold `/` only).
 */
export function useLandingHeroBootHandoff(heroSectionRef: RefObject<HTMLElement | null>): void {
  const completeHtmlBootAfterPublicPaint = useCompleteHtmlBootAfterPublicPaint();
  const softNav = isAppShellInteractive();

  useLayoutEffect(() => {
    const el = heroSectionRef.current;
    if (!el || el.id !== "about-section") return;
    el.setAttribute(LANDING_HERO_READY_ATTR, "");
    markLandingColdLoad("hero-ready");

    if (softNav) return;
    return completeHtmlBootAfterPublicPaint();
  }, [completeHtmlBootAfterPublicPaint, softNav, heroSectionRef]);
}

export function noteLandingInteractiveIfBootGone(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("caretip-html-boot")) return;
  markLandingColdLoad("landing-interactive");
  markAppShellInteractive();
}
