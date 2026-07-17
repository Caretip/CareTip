import restaurantWebp from "../../../images/Restaurant berlin(1).webp";
import restaurantAvif from "../../../images/Restaurant berlin(1).avif";
import hotelsWebp from "../../../images/Hotels.webp";
import hotelsAvif from "../../../images/Hotels.avif";
import logisticsWebp from "../../../images/Logistik.webp";
import logisticsAvif from "../../../images/Logistik.avif";
import midwivesWebp from "../../../images/new-mid.webp";
import midwivesAvif from "../../../images/new-mid.avif";
import fairsWebp from "../../../images/fromfanny002.webp";
import fairsAvif from "../../../images/fromfanny002.avif";
import fieldServiceWebp from "../../../images/trade and home services.webp";
import fieldServiceAvif from "../../../images/trade and home services.avif";
import hw04Webp from "../../../images/hw04.webp";
import hw04Avif from "../../../images/hw04.avif";
import repWebp from "../../../images/rep.webp";
import repAvif from "../../../images/rep.avif";
import brandedQrWebp from "../../../images/brandedqr.webp";
import brandedQrAvif from "../../../images/brandedqr.avif";
import hw05Webp from "../../../images/hw05.webp";
import hw05Avif from "../../../images/hw05.avif";
import type { IndustryPageId } from "@/app/data/industryPages";

export type IndustryMedia = {
  hero: { webp: string; avif: string };
  benefits: { webp: string; avif: string };
};

/** Shared media map — layout identical; assets differ per industry. */
export const INDUSTRY_MEDIA: Record<IndustryPageId, IndustryMedia> = {
  gastronomy: {
    hero: { webp: restaurantWebp, avif: restaurantAvif },
    benefits: { webp: hw04Webp, avif: hw04Avif },
  },
  hotels: {
    hero: { webp: repWebp, avif: repAvif },
    benefits: { webp: hotelsWebp, avif: hotelsAvif },
  },
  logistics: {
    hero: { webp: logisticsWebp, avif: logisticsAvif },
    benefits: { webp: brandedQrWebp, avif: brandedQrAvif },
  },
  midwives: {
    hero: { webp: midwivesWebp, avif: midwivesAvif },
    benefits: { webp: brandedQrWebp, avif: brandedQrAvif },
  },
  fairs: {
    hero: { webp: fairsWebp, avif: fairsAvif },
    benefits: { webp: hw05Webp, avif: hw05Avif },
  },
  "field-service": {
    hero: { webp: fieldServiceWebp, avif: fieldServiceAvif },
    benefits: { webp: brandedQrWebp, avif: brandedQrAvif },
  },
};
