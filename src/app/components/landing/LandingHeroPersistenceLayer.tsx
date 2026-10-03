import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { CareTipLandingHero } from "@/components/landing/CareTipLandingHero";
import { resolveAppLanguageFromCode } from "@/i18n/i18n";

export const LANDING_HERO_SLOT_ID = "landing-hero-slot";

let landingHeroEverActivated = false;

const persistedHeroCopy = {
  imageAlt: "",
  isDe: true,
};

/** Hidden warm hero — must not subscribe to i18n (guest language switch must not remount hero off `/`). */
function PersistedHeroOffHome() {
  return (
    <div hidden aria-hidden data-testid="landing-hero-persistence-layer">
      <CareTipLandingHero
        id="about-section-persisted"
        imageAlt={persistedHeroCopy.imageAlt}
        isDe={persistedHeroCopy.isDe}
      />
    </div>
  );
}

/** Sync persisted hero copy while the user is on `/` (marketing language switch). */
function LandingHeroPersistenceHomeSync() {
  const { t, i18n } = useTranslation();

  useLayoutEffect(() => {
    landingHeroEverActivated = true;
    persistedHeroCopy.isDe = resolveAppLanguageFromCode(i18n.language) === "de";
    persistedHeroCopy.imageAlt = t("landing.showcase.tabQrAlt");
  }, [t, i18n.language]);

  return null;
}

/**
 * Off-home only: keeps a hidden hero mounted after the user has visited `/` once,
 * so warm returns avoid re-fetching hero-only state. Cold `/` renders the hero inline in
 * {@link LandingPage} so the boot handoff can wait for real hero DOM (no portal delay).
 */
export function LandingHeroPersistenceLayer() {
  const { pathname } = useLocation();
  const isHome = pathname === "/";

  if (isHome) {
    return <LandingHeroPersistenceHomeSync />;
  }

  if (!landingHeroEverActivated) return null;

  return <PersistedHeroOffHome />;
}
