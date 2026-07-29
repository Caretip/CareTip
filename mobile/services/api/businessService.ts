import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type { BusinessDashboardStats, BusinessProfile, BusinessTimeframe } from "@/types/business";
import type { BusinessQrAnalytics } from "@/types/qrAnalytics";

export async function fetchBusinessProfile(): Promise<BusinessProfile> {
  const { data } = await apiClient.get<BusinessProfile>(API_ENDPOINTS.business.profile);
  return data;
}

export async function patchBusinessProfile(body: {
  name?: string;
  legalBusinessName?: string;
  businessType?: string | null;
  location?: string | null;
  registeredAddress?: string | null;
  contactPhone?: string | null;
  website?: string | null;
}): Promise<BusinessProfile> {
  const { data } = await apiClient.patch<BusinessProfile>(API_ENDPOINTS.business.profile, body);
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

export async function fetchBusinessQrAnalytics(
  timeframe: BusinessTimeframe = "month",
): Promise<BusinessQrAnalytics> {
  const { data } = await apiClient.get<BusinessQrAnalytics>(API_ENDPOINTS.business.qrAnalytics, {
    params: { timeframe },
  });
  return data;
}
