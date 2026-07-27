/** Employee dashboard DTOs — aligned with web `EmployeeSelfProfile` / `EmployeeTipsResponse`. */

export type EmployeeTimeframe = "today" | "week" | "month";

export type EmployeeProfile = {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  avatar: string | null;
  businessId: string;
  businessName: string;
  businessSlug: string | null;
  slug: string | null;
  monthlyGoal: number | null;
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  bio?: string | null;
  subscriptionTier?: "basic" | "premium" | "enterprise" | null;
  hasActiveSubscription?: boolean;
  [key: string]: unknown;
};

export type EmployeeTipsStats = {
  tips: Array<{
    id: string;
    amount: number;
    createdAt: string;
    rating?: number | null;
    [key: string]: unknown;
  }>;
  monthlyGoal: number | null;
  currentMonthTotal: number;
  periodAmountEur?: number;
  periodTipCount?: number;
  averageRating?: number | null;
  ratingCount?: number;
  totalEarningsEur?: number;
  paidOutEur?: number;
  totalSupporters?: number;
  chartSeries?: Array<{ label: string; amount: number }>;
};
