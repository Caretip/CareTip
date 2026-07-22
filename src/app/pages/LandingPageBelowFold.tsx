import { LandingLazySection } from "@/components/landing/LandingLazySection";

/** Reversible: set true to restore #social-proof (PDF adjustment — hide testimonials & trust stats). */
export const SHOW_LANDING_SOCIAL_PROOF = false;

/** Approximate section heights — reserve space before lazy sections mount (CLS guard). */
const LAZY_SECTION_MIN_HEIGHT = {
  industriesTeaser: "var(--caretip-lazy-industries-h, 52rem)",
  audienceBenefits: "36rem",
  payments: "16rem",
  liveMinutes: "48rem",
  socialProof: "36rem",
  finalCta: "22rem",
  splitShowcase: "44rem",
} as const;

const loadLandingIndustriesTeaserSection = () =>
  import("../components/landing/LandingIndustriesTeaserSection").then((mod) => ({
    default: mod.LandingIndustriesTeaserSection,
  }));

const loadLandingAudienceBenefitsSection = () =>
  import("../components/landing/LandingAudienceBenefitsSection").then((mod) => ({
    default: mod.LandingAudienceBenefitsSection,
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
 * Below-the-fold landing — industry overview + combined audience benefits + product sections.
 */
export function LandingPageBelowFold() {
  return (
    <>
      <LandingLazySection
        load={loadLandingIndustriesTeaserSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.industriesTeaser}
      />

      <LandingLazySection
        load={loadLandingAudienceBenefitsSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.audienceBenefits}
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
