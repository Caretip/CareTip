import restaurantWebp from "../../../images/new-gastronomy001.webp";
import restaurantAvif from "../../../images/new-gastronomy001.avif";
import logisticsWebp from "../../../images/Logistik.webp";
import logisticsAvif from "../../../images/Logistik.avif";
import midwivesWebp from "../../../images/new-mid.webp";
import midwivesAvif from "../../../images/new-mid.avif";
import fairsWebp from "../../../images/event001.webp";
import fairsAvif from "../../../images/event001.avif";
import fieldServiceWebp from "../../../images/Handwerker.webp";
import fieldServiceAvif from "../../../images/Handwerker.avif";
import repWebp from "../../../images/rep.webp";
import repAvif from "../../../images/rep.avif";
import industryBenefitWebp from "../../../images/industry-benefit.webp";
import industryBenefitAvif from "../../../images/industry-benefit.avif";
import mockupAdjusted002Webp from "../../../images/mockupadjusted-002.webp";
import mockupAdjusted002Avif from "../../../images/mockupadjusted-002.avif";
import freelanMidwivesWebp from "../../../images/freelan-midwives.webp";
import freelanMidwivesAvif from "../../../images/freelan-midwives.avif";
import mockupBenefit002Webp from "../../../images/mockup-benefit002.webp";
import mockupBenefit002Avif from "../../../images/mockup-benefit002.avif";
import type { IndustryPageId } from "@/app/data/industryPages";

export type IndustryMedia = {
  hero: { webp: string; avif: string };
  benefits: { webp: string; avif: string };
};

const INDUSTRY_BENEFIT = { webp: industryBenefitWebp, avif: industryBenefitAvif };
const HOTELS_BENEFIT = { webp: mockupBenefit002Webp, avif: mockupBenefit002Avif };
const MOCKUP_ADJUSTED_002 = { webp: mockupAdjusted002Webp, avif: mockupAdjusted002Avif };
const FREELAN_MIDWIVES_BENEFIT = { webp: freelanMidwivesWebp, avif: freelanMidwivesAvif };

/** Shared media map — layout identical; assets differ per industry. */
export const INDUSTRY_MEDIA: Record<IndustryPageId, IndustryMedia> = {
  gastronomy: {
    hero: { webp: restaurantWebp, avif: restaurantAvif },
    benefits: INDUSTRY_BENEFIT,
  },
  hotels: {
    hero: { webp: repWebp, avif: repAvif },
    benefits: HOTELS_BENEFIT,
  },
  logistics: {
    hero: { webp: logisticsWebp, avif: logisticsAvif },
    benefits: MOCKUP_ADJUSTED_002,
  },
  midwives: {
    hero: { webp: midwivesWebp, avif: midwivesAvif },
    benefits: FREELAN_MIDWIVES_BENEFIT,
  },
  fairs: {
    hero: { webp: fairsWebp, avif: fairsAvif },
    benefits: INDUSTRY_BENEFIT,
  },
  "field-service": {
    hero: { webp: fieldServiceWebp, avif: fieldServiceAvif },
    benefits: MOCKUP_ADJUSTED_002,
  },
};
