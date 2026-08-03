import { useQuery } from "@tanstack/react-query";
import { fetchBusinessQrAnalytics, fetchBusinessStats } from "@/services/api/businessService";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { usePersistedTimeframe } from "@/hooks/usePersistedTimeframe";
import { PREFERENCE_KEYS } from "@/constants/storageKeys";
import type { BusinessTimeframe } from "@/types/business";

type UseBusinessAnalyticsOptions = {
  /** When true, fetches QR scan analytics (Analytics screen only). */
  includeQr?: boolean;
};

export function useBusinessAnalytics(options: UseBusinessAnalyticsOptions = {}) {
  const includeQr = options.includeQr ?? false;
  const { isAuthenticated } = useAuth();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const scoped = Boolean(isAuthenticated && userId);
  const [timeframe, setTimeframe] = usePersistedTimeframe<BusinessTimeframe>(
    PREFERENCE_KEYS.businessAnalyticsTimeframe,
    "month",
  );

  const statsQuery = useQuery({
    queryKey: [...keys.businessStats, timeframe] as const,
    queryFn: () => fetchBusinessStats(timeframe),
    enabled: scoped,
  });

  const qrQuery = useQuery({
    queryKey: [...keys.businessQrAnalytics, timeframe] as const,
    queryFn: () => fetchBusinessQrAnalytics(timeframe),
    enabled: includeQr && scoped && statsQuery.isSuccess,
  });

  const refresh = async () => {
    await statsQuery.refetch();
    if (includeQr) await qrQuery.refetch();
  };

  return {
    timeframe,
    setTimeframe,
    stats: statsQuery.data,
    qrAnalytics: includeQr ? qrQuery.data : undefined,
    isLoading: statsQuery.isLoading,
    isRefreshing: statsQuery.isRefetching || (includeQr && qrQuery.isRefetching),
    error: statsQuery.error ?? (includeQr ? qrQuery.error : null),
    refresh,
  };
}
