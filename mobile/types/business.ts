/** Business dashboard DTOs — aligned with web `BusinessInfo` / `BusinessDashboardStats`. */

export type BusinessTimeframe = "week" | "month" | "year";

export type BusinessProfile = {
  id: string;
  name: string;
  businessName?: string;
  slug?: string | null;
  logo?: string | null;
  contactPhone?: string | null;
  location?: string | null;
  timezone?: string | null;
  employeeCount?: number;
  subscriptionTier?: "basic" | "premium" | "enterprise" | null;
  hasActiveSubscription?: boolean;
  [key: string]: unknown;
};

export type BusinessDashboardStats = {
  name?: string;
  slug?: string | null;
  timeframe?: BusinessTimeframe | "all";
  totalTips?: number;
  tipCount?: number;
  employeeCount?: number;
  /** Same series web AreaChart uses — from GET /api/business/me/stats?scope=full */
  dailyTipDistribution?: Array<{ day: string; amount: number }>;
  employees?: Array<{
    id?: string;
    name: string;
    tipsTotal: number;
    tipCount?: number;
    rating?: number | null;
    avatar?: string | null;
    isActive?: boolean;
    activationStatus?: string;
    emailVerified?: boolean;
  }>;
  employeeGoals?: Array<{
    employeeId: string;
    name?: string;
    avatar?: string | null;
    goalAmount: number;
    currentAmount: number;
    percent: number;
    status?: string;
  }>;
  locationRankings?: Array<{
    id: string | null;
    name: string;
    tipsEur: number;
    tipCount: number;
  }>;
  operationalPulse?: {
    tipsToday?: { amount: number; count: number };
    tipsLast60m?: { amount: number; count: number };
    tippingReadyEmployees?: number;
    rosterTotal?: number;
  };
  growthPercent?: number;
  priorPeriod?: { totalTips: number; tipCount: number };
};
