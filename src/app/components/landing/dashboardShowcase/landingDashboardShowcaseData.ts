/**
 * Static demo data for the landing-page Business Dashboard showcase.
 * Isolated from authenticated dashboard hooks and API — never import in business routes.
 */

import lukasAvatar from "../../../../../template/professional-bartender-service-stockcake.jpg";
import annaAvatar from "../../../../../template/welcoming-receptionist-smiling-stockcake.jpg";
import felixAvatar from "../../../../../template/focused-bartender-working-stockcake.jpg";
import sophieAvatar from "../../../../../template/focused-receptionist-working-stockcake.jpg";
import jonasAvatar from "../../../../../template/StockCake-Friendly_Delivery_Man-843938-medium.jpg";
import claraAvatar from "../../../../../template/receptionist-at-desk-stockcake.jpg";
import marcoAvatar from "../../../../../template/delivery-person-waiting-stockcake.jpg";

export type LandingDashboardShowcaseEmployeeStatus = "active" | "offShift";

export type LandingDashboardShowcaseEmployee = {
  id: string;
  name: string;
  avatarUrl: string;
  totalTips: number;
  tipCount: number;
  averageTip: number;
  rating: number;
  status: LandingDashboardShowcaseEmployeeStatus;
};

export const LANDING_DASHBOARD_SHOWCASE_KPIS = {
  totalTips: 3230.3,
  tipCount: 167,
  activeEmployees: 7,
  averageRating: 3.9,
} as const;

export type LandingDashboardShowcaseChartDay = {
  key: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  tips: number;
};

/** Weekly tip volume — static series for marketing chart. */
export const LANDING_DASHBOARD_SHOWCASE_WEEKLY_TIPS: LandingDashboardShowcaseChartDay[] = [
  { key: "mon", tips: 368 },
  { key: "tue", tips: 412 },
  { key: "wed", tips: 445 },
  { key: "thu", tips: 498 },
  { key: "fri", tips: 612 },
  { key: "sat", tips: 548 },
  { key: "sun", tips: 347 },
];

export type LandingDashboardShowcaseRecentTip = {
  id: string;
  employeeName: string;
  amount: number;
  timeKey: "time2m" | "time8m" | "time14m" | "time22m" | "time31m";
};

export const LANDING_DASHBOARD_SHOWCASE_RECENT_TIPS: LandingDashboardShowcaseRecentTip[] = [
  { id: "r1", employeeName: "Anna Müller", amount: 22.5, timeKey: "time2m" },
  { id: "r2", employeeName: "Lukas Schneider", amount: 18, timeKey: "time8m" },
  { id: "r3", employeeName: "Sophie Weber", amount: 15.5, timeKey: "time14m" },
  { id: "r4", employeeName: "Felix Wagner", amount: 20, timeKey: "time22m" },
];

export type LandingDashboardShowcaseReview = {
  id: string;
  employeeName: string;
  quoteKey: "quote1" | "quote2" | "quote3";
  rating: number;
};

export const LANDING_DASHBOARD_SHOWCASE_REVIEWS: LandingDashboardShowcaseReview[] = [
  { id: "v1", employeeName: "Anna Müller", quoteKey: "quote1", rating: 5 },
  { id: "v2", employeeName: "Lukas Schneider", quoteKey: "quote2", rating: 5 },
];

export const LANDING_DASHBOARD_SHOWCASE_EMPLOYEES: LandingDashboardShowcaseEmployee[] = [
  {
    id: "lukas",
    name: "Lukas Schneider",
    avatarUrl: lukasAvatar,
    totalTips: 892.5,
    tipCount: 47,
    averageTip: 18.99,
    rating: 5,
    status: "active",
  },
  {
    id: "anna",
    name: "Anna Müller",
    avatarUrl: annaAvatar,
    totalTips: 756,
    tipCount: 38,
    averageTip: 19.89,
    rating: 5,
    status: "active",
  },
  {
    id: "felix",
    name: "Felix Wagner",
    avatarUrl: felixAvatar,
    totalTips: 612.3,
    tipCount: 31,
    averageTip: 19.75,
    rating: 4,
    status: "active",
  },
  {
    id: "sophie",
    name: "Sophie Weber",
    avatarUrl: sophieAvatar,
    totalTips: 548,
    tipCount: 29,
    averageTip: 18.9,
    rating: 4,
    status: "active",
  },
  {
    id: "jonas",
    name: "Jonas Fischer",
    avatarUrl: jonasAvatar,
    totalTips: 421.5,
    tipCount: 22,
    averageTip: 19.16,
    rating: 2,
    status: "active",
  },
  {
    id: "clara",
    name: "Clara Hoffmann",
    avatarUrl: claraAvatar,
    totalTips: 388.2,
    tipCount: 20,
    averageTip: 19.41,
    rating: 5,
    status: "active",
  },
  {
    id: "marco",
    name: "Marco Lehmann",
    avatarUrl: marcoAvatar,
    totalTips: 312.8,
    tipCount: 16,
    averageTip: 19.55,
    rating: 2,
    status: "offShift",
  },
];
