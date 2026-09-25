import {
  LandingLazySection,
  LANDING_NEAR_VIEWPORT_ROOT_MARGIN,
} from "@/components/landing/LandingLazySection";

/** Reversible: set true to restore #social-proof (PDF adjustment — hide testimonials & trust stats). */
export const SHOW_LANDING_SOCIAL_PROOF = false;

/** Approximate section heights — reserve space before lazy sections mount (CLS guard). */
const LAZY_SECTION_MIN_HEIGHT = {
  industriesTeaser: "var(--caretip-lazy-industries-h, 68rem)",
  audienceBenefits: "48rem",
  payments: "14rem",
  liveMinutes: "40rem",
  customerJourney: "52rem",
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

const loadLandingCustomerJourneySection = () =>
  import("../components/landing/LandingCustomerJourneySection").then((mod) => ({
    default: mod.LandingCustomerJourneySection,
  }));

function prefetchLandingCustomerJourneySection(): void {
  void loadLandingCustomerJourneySection().then(() => {
    void import("../components/landing/warmLandingCustomerJourneyAssets").then((mod) => {
      mod.warmLandingCustomerJourneyImages("low");
    });
  });
}

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

const INDUSTRY_TEASER_WARM_IDS = ["hotels", "logistics", "gastronomy"] as const;

/**
 * After LCP is warm: fetch below-fold JS (and the next photos) so scrolling
 * does not wait on chunk discovery. Does not eager-mount sections or compete
 * with the hero download.
 */
export function prefetchLandingBelowFoldSections(): void {
  void loadLandingIndustriesTeaserSection().then(() => {
    void import("@/lib/industryHeroAssets").then((mod) => {
      for (const id of INDUSTRY_TEASER_WARM_IDS) {
        void mod.warmIndustryHero(id, { priority: "low" });
      }
    });
  });
  void loadLandingAudienceBenefitsSection();
  prefetchLandingCustomerJourneySection();
  void loadPaymentsSection();
  void loadSimpleSetupSection();
  void loadLandingMotivationSection();
  if (SHOW_LANDING_SOCIAL_PROOF) {
    void loadLandingSocialProofSection();
  }
  void loadLandingFinalCtaSection();
}

/**
 * Below-the-fold landing — industry overview + combined audience benefits + product sections.
 */
export function LandingPageBelowFold() {
  return (
    <>
      <LandingLazySection
        load={loadLandingIndustriesTeaserSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.industriesTeaser}
        rootMargin={LANDING_NEAR_VIEWPORT_ROOT_MARGIN}
        prefetch
      />

      <LandingLazySection
        load={loadLandingAudienceBenefitsSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.audienceBenefits}
        eager
        prefetch
      />

      <LandingLazySection
        load={loadLandingCustomerJourneySection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.customerJourney}
        rootMargin={LANDING_NEAR_VIEWPORT_ROOT_MARGIN}
        prefetch
      />

      <LandingLazySection
        load={loadPaymentsSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.payments}
        rootMargin={LANDING_NEAR_VIEWPORT_ROOT_MARGIN}
        prefetch
      />

      <LandingLazySection
        load={loadSimpleSetupSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.liveMinutes}
        rootMargin={LANDING_NEAR_VIEWPORT_ROOT_MARGIN}
        prefetch
      />

      <LandingLazySection
        load={loadLandingMotivationSection}
        minHeight={LAZY_SECTION_MIN_HEIGHT.splitShowcase}
        rootMargin={LANDING_NEAR_VIEWPORT_ROOT_MARGIN}
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
