import { cn } from "@/lib/utils";
import { caretipBtnPrimary, caretipBtnSecondary } from "@/lib/caretipButtonSystem";

export const publicPagesBrandUi = {
  pageAccent: "caretip-public-page-accent",
  warmDarkCta: "caretip-public-warm-dark-cta",
  warmDarkCtaTitle: "caretip-public-warm-dark-cta__title",
  warmDarkCtaBody: "caretip-public-warm-dark-cta__body",
  warmDarkCtaActions: "caretip-public-warm-dark-cta__actions",
  warmDarkCard: "caretip-public-warm-dark-card",
  warmDarkCardIcon: "caretip-public-warm-dark-card__icon",
  warmDarkCardTitle: "caretip-public-warm-dark-card__title",
  warmDarkCardBody: "caretip-public-warm-dark-card__body",
  warmDarkTrustStrip: "caretip-public-warm-dark-trust-strip",
  journeyBand: "caretip-how-journey-band",
  featureCardBrand: "caretip-feature-showcase-card--brand",
  ctaButtonPrimary: cn(
    caretipBtnPrimary,
    "inline-flex w-full justify-center no-underline sm:w-auto sm:min-w-[11rem] lg:min-w-[12rem]",
  ),
  ctaButtonSecondary: cn(
    caretipBtnSecondary,
    "inline-flex w-full justify-center no-underline sm:w-auto sm:min-w-[11rem] lg:min-w-[12rem]",
  ),
} as const;
