import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { CareTipLandingHero } from "@/components/landing/CareTipLandingHero";
import { useLandingShellReady } from "@/app/lib/useLandingShellReady";

export const LANDING_HERO_SLOT_ID = "landing-hero-slot";

let landingHeroEverActivated = false;

/**
 * Mounts the landing hero once per app session and portals it into the home slot when on `/`.
 * While visiting other routes the hero stays mounted off-screen so warm returns avoid remount churn.
 */
export function LandingHeroPersistenceLayer() {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const isHome = pathname === "/";
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const isDe = i18n.language?.toLowerCase().startsWith("de");

  if (isHome) landingHeroEverActivated = true;

  useLandingShellReady(isHome ? "about-section" : undefined);

  useLayoutEffect(() => {
    if (!isHome) {
      setSlot(null);
      return;
    }
    setSlot(document.getElementById(LANDING_HERO_SLOT_ID));
  }, [isHome]);

  if (!landingHeroEverActivated && !isHome) return null;

  const hero = (
    <CareTipLandingHero
      id="about-section"
      imageAlt={t("landing.showcase.tabQrAlt")}
      isDe={isDe}
    />
  );

  if (isHome && slot) {
    return createPortal(hero, slot);
  }

  if (!isHome && landingHeroEverActivated) {
    return (
      <div hidden aria-hidden data-testid="landing-hero-persistence-layer">
        {hero}
      </div>
    );
  }

  return null;
}
