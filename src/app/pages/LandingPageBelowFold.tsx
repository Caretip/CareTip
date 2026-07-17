import { LandingLazySection } from "@/components/landing/LandingLazySection";

/** Reversible: set true to restore #social-proof (PDF adjustment — hide testimonials & trust stats). */
export const SHOW_LANDING_SOCIAL_PROOF = false;

/** Approximate section heights — reserve space before lazy sections mount (CLS guard). */
const LAZY_SECTION_MIN_HEIGHT = {
  industriesTeaser: "52rem",
  splitShowcase: "44rem",
  payments: "16rem",
  liveMinutes: "48rem",
  socialProof: "36rem",
  finalCta: "22rem",
} as const;

const loadLandingIndustriesTeaserSection = () =>
  import("../components/landing/LandingIndustriesTeaserSection").then((mod) => ({
    default: mod.LandingIndustriesTeaserSection,
  }));

const loadPaymentsSection = () =>
  import("../components/landing/PaymentsSection").then((mod) => ({
    default: mod.PaymentsSection,
  }));

const loadSimpleSetupSection = () =>
  import("../components/landing/SimpleSetupSection").then((mod) => ({
    default: mod.SimpleSetupSection,
  }));

const loadLandingMotivationSection = () =>
  import("../components/landing/LandingMotivationSection").then((mod) => ({
    default: mod.LandingMotivationSection,
  }));

const loadLandingSocialProofSection = () =>
  import("../components/landing/LandingSocialProofSection").then((mod) => ({
    default: mod.LandingSocialProofSection,
  }));

const loadLandingFinalCtaSection = () =>
  import("../components/landing/LandingFinalCtaSection").then((mod) => ({
    default: mod.LandingFinalCtaSection,
  }));

/**
 * Below-the-fold landing — teaser homepage IA.
 * Features live on /features; industry detail on /industries/*.
 * Order: setup (live in minutes) before recognition (motivation).
 */
export function LandingPageBelowFold() {
  return (
    <>
      <LandingLazySection
        load={loadLandingIndustriesTeaserSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.industriesTeaser}
      />

      <LandingLazySection
        load={loadPaymentsSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.payments}
      />

      <LandingLazySection
        load={loadSimpleSetupSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.liveMinutes}
      />

      <LandingLazySection
        load={loadLandingMotivationSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.splitShowcase}
      />

      {SHOW_LANDING_SOCIAL_PROOF ? (
        <LandingLazySection
          load={loadLandingSocialProofSection}
          minHeight={LAZY_SECTION_MIN_HEIGHT.socialProof}
        />
      ) : null}

      <LandingLazySection
        load={loadLandingFinalCtaSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.finalCta}
      />
    </>
  );
}
