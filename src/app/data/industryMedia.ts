import restaurantWebp from "../../../images/Restaurant berlin(1).webp";
import restaurantAvif from "../../../images/Restaurant berlin(1).avif";
import logisticsWebp from "../../../images/Logistik.webp";
import logisticsAvif from "../../../images/Logistik.avif";
import midwivesWebp from "../../../images/new-mid.webp";
import midwivesAvif from "../../../images/new-mid.avif";
import fairsWebp from "../../../images/fromfanny002.webp";
import fairsAvif from "../../../images/fromfanny002.avif";
import fieldServiceWebp from "../../../images/Handwerker.webp";
import fieldServiceAvif from "../../../images/Handwerker.avif";
import repWebp from "../../../images/rep.webp";
import repAvif from "../../../images/rep.avif";
import industryBenefitWebp from "../../../images/industry-benefit.webp";
import industryBenefitAvif from "../../../images/industry-benefit.avif";
import type { IndustryPageId } from "@/app/data/industryPages";

export type IndustryMedia = {
  hero: { webp: string; avif: string };
  benefits: { webp: string; avif: string };
};

const INDUSTRY_BENEFIT = { webp: industryBenefitWebp, avif: industryBenefitAvif };

/** Shared media map — layout identical; assets differ per industry. */
export const INDUSTRY_MEDIA: Record<IndustryPageId, IndustryMedia> = {
  gastronomy: {
    hero: { webp: restaurantWebp, avif: restaurantAvif },
    benefits: INDUSTRY_BENEFIT,
  },
  hotels: {
    hero: { webp: repWebp, avif: repAvif },
    benefits: INDUSTRY_BENEFIT,
  },
  logistics: {
    hero: { webp: logisticsWebp, avif: logisticsAvif },
    benefits: INDUSTRY_BENEFIT,
  },
  midwives: {
    hero: { webp: midwivesWebp, avif: midwivesAvif },
    benefits: INDUSTRY_BENEFIT,
  },
  fairs: {
    hero: { webp: fairsWebp, avif: fairsAvif },
    benefits: INDUSTRY_BENEFIT,
  },
  "field-service": {
    hero: { webp: fieldServiceWebp, avif: fieldServiceAvif },
    benefits: INDUSTRY_BENEFIT,
  },
};
