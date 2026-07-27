import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type { BusinessActivityListResult, ActivityEventSource } from "@/types/activity";

export async function fetchBusinessActivity(params?: {
  limit?: number;
  cursor?: string | null;
  source?: ActivityEventSource | "all";
}): Promise<BusinessActivityListResult> {
  const { data } = await apiClient.get<BusinessActivityListResult>(API_ENDPOINTS.business.activity, {
    params: {
      limit: params?.limit ?? 30,
      ...(params?.cursor ? { cursor: params.cursor } : {}),
      ...(params?.source && params.source !== "all" ? { source: params.source } : {}),
    },
  });
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextCursor: data.nextCursor ?? null,
  };
}
