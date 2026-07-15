import { LandingLazySection } from "@/components/landing/LandingLazySection";

/** Reversible: set true to restore #social-proof (PDF adjustment — hide testimonials & trust stats). */
export const SHOW_LANDING_SOCIAL_PROOF = false;

/** Approximate section heights — reserve space before lazy sections mount (CLS guard). */
const LAZY_SECTION_MIN_HEIGHT = {
  hospitality: "48rem",
  splitShowcase: "44rem",
  features: "48rem",
  realLife: "56rem",
  liveMinutes: "48rem",
  socialProof: "36rem",
  finalCta: "28rem",
} as const;

const loadHospitalityTeamsUnifiedSection = () =>
  import("../components/landing/HospitalityTeamsUnifiedSection").then((mod) => ({
    default: mod.HospitalityTeamsUnifiedSection,
  }));

const loadBusinessLandingSection = () =>
  import("../components/landing/BusinessLandingSection").then((mod) => ({
    default: mod.BusinessLandingSection,
  }));

const loadEmployeeLandingSection = () =>
  import("../components/landing/EmployeeLandingSection").then((mod) => ({
    default: mod.EmployeeLandingSection,
  }));

const loadLandingFeaturesSection = () =>
  import("../components/landing/LandingFeaturesSection").then((mod) => ({
    default: mod.LandingFeaturesSection,
  }));

const loadPaymentsSection = () =>
  import("../components/landing/PaymentsSection").then((mod) => ({
    default: mod.PaymentsSection,
  }));

const loadLandingRealLifeSection = () =>
  import("../components/landing/LandingRealLifeSection").then((mod) => ({
    default: mod.LandingRealLifeSection,
  }));

const loadLandingMotivationSection = () =>
  import("../components/landing/LandingMotivationSection").then((mod) => ({
    default: mod.LandingMotivationSection,
  }));

const loadSimpleSetupSection = () =>
  import("../components/landing/SimpleSetupSection").then((mod) => ({
    default: mod.SimpleSetupSection,
  }));

const loadLandingSocialProofSection = () =>
  import("../components/landing/LandingSocialProofSection").then((mod) => ({
    default: mod.LandingSocialProofSection,
  }));

const loadLandingFinalCtaSection = () =>
  import("../components/landing/LandingFinalCtaSection").then((mod) => ({
    default: mod.LandingFinalCtaSection,
  }));

/** Below-the-fold landing sections — viewport-gated + code-split. Hero stays eager in LandingPage. */
export function LandingPageBelowFold() {
  return (
    <>
      <LandingLazySection
        load={loadHospitalityTeamsUnifiedSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.hospitality}
      />

      <LandingLazySection
        load={loadBusinessLandingSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.splitShowcase}
      />
      <LandingLazySection
        load={loadEmployeeLandingSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.splitShowcase}
      />

      <LandingLazySection
        load={loadLandingFeaturesSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.features}
      />
      <LandingLazySection
        load={loadPaymentsSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.splitShowcase}
      />

      <LandingLazySection
        load={loadLandingRealLifeSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.realLife}
      />
      <LandingLazySection
        load={loadLandingMotivationSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.splitShowcase}
      />

      <LandingLazySection
        load={loadSimpleSetupSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.liveMinutes}
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
