export const LANDING_HERO_READY_ATTR = "data-caretip-hero-ready";

/** DOM signal used with #about-section for HTML boot retain on `/`. */
export function isLandingHeroCommitted(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector(
      `.caretip-landing #about-section.caretip-hero-section, .caretip-landing [${LANDING_HERO_READY_ATTR}]`,
    ) != null
  );
}
