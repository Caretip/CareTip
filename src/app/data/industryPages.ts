/**
 * Marketing industry pages — shared routes + nav/footer catalog.
 * Content lives in i18n under `industries.pages.<id>.*`.
 */

export type IndustryPageId =
  | "gastronomy"
  | "hotels"
  | "logistics"
  | "midwives"
  | "fairs"
  | "field-service";

export type IndustryNavItem = {
  id: IndustryPageId;
  path: `/industries/${IndustryPageId}`;
  /** Nav / footer label key */
  labelKey: string;
};

/** Primary Industries dropdown + footer list — all live industry pages. */
export const INDUSTRY_NAV_ITEMS: IndustryNavItem[] = [
  {
    id: "gastronomy",
    path: "/industries/gastronomy",
    labelKey: "nav.industriesMenu.gastronomy",
  },
  {
    id: "hotels",
    path: "/industries/hotels",
    labelKey: "nav.industriesMenu.hotels",
  },
  {
    id: "logistics",
    path: "/industries/logistics",
    labelKey: "nav.industriesMenu.logistics",
  },
  {
    id: "midwives",
    path: "/industries/midwives",
    labelKey: "nav.industriesMenu.midwives",
  },
  {
    id: "fairs",
    path: "/industries/fairs",
    labelKey: "nav.industriesMenu.fairs",
  },
  {
    id: "field-service",
    path: "/industries/field-service",
    labelKey: "nav.industriesMenu.field-service",
  },
];

/** Homepage teaser cards (only two featured). */
export const INDUSTRY_TEASER_IDS = ["midwives", "field-service"] as const;

/** All pages that share the industry template (nav + teaser destinations). */
export const ALL_INDUSTRY_PAGE_IDS: IndustryPageId[] = [
  "gastronomy",
  "hotels",
  "logistics",
  "midwives",
  "fairs",
  "field-service",
];

export function isIndustryPageId(value: string): value is IndustryPageId {
  return (ALL_INDUSTRY_PAGE_IDS as string[]).includes(value);
}

export function industryPath(id: IndustryPageId): `/industries/${IndustryPageId}` {
  return `/industries/${id}`;
}
