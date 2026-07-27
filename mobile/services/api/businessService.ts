import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type { BusinessDashboardStats, BusinessProfile, BusinessTimeframe } from "@/types/business";

export async function fetchBusinessProfile(): Promise<BusinessProfile> {
  const { data } = await apiClient.get<BusinessProfile>(API_ENDPOINTS.business.profile);
  return data;
}

export async function fetchBusinessStats(
  timeframe: BusinessTimeframe = "month",
): Promise<BusinessDashboardStats> {
  const { data } = await apiClient.get<BusinessDashboardStats>(API_ENDPOINTS.business.stats, {
    params: { timeframe, scope: "full" },
  });
  return data;
}
