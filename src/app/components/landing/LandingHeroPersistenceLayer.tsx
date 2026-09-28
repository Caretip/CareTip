import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { CareTipLandingHero } from "@/components/landing/CareTipLandingHero";

export const LANDING_HERO_SLOT_ID = "landing-hero-slot";

let landingHeroEverActivated = false;

/**
 * Off-home only: keeps a hidden hero mounted after the user has visited `/` once,
 * so warm returns avoid re-fetching hero-only state. Cold `/` renders the hero inline in
 * {@link LandingPage} so the boot handoff can wait for real hero DOM (no portal delay).
 */
export function LandingHeroPersistenceLayer() {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const isHome = pathname === "/";
  const isDe = i18n.language?.toLowerCase().startsWith("de");

  if (isHome) {
    landingHeroEverActivated = true;
    return null;
  }

  if (!landingHeroEverActivated) return null;

  return (
    <div hidden aria-hidden data-testid="landing-hero-persistence-layer">
      <CareTipLandingHero
        id="about-section-persisted"
        imageAlt={t("landing.showcase.tabQrAlt")}
        isDe={isDe}
      />
    </div>
  );
}
