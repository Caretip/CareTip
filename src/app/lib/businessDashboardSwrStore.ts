import type { BusinessDashboardStats } from "./api";
import { clearBusinessAnalyticsStore } from "./businessAnalytics/businessAnalyticsStore";
import { createDashboardSwrStore } from "./dashboardSwrCache";

export type BusinessSwrEntry = {
  summary: Partial<BusinessDashboardStats>;
  analytics: Partial<BusinessDashboardStats>;
  merged: BusinessDashboardStats;
  at: number;
};

export const businessSwrStore = createDashboardSwrStore<BusinessSwrEntry>();

export function clearBusinessDashboardSwrStore(): void {
  businessSwrStore.clear();
  clearBusinessAnalyticsStore();
}
