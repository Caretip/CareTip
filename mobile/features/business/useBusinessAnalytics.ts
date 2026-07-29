import { useQuery } from "@tanstack/react-query";
import { fetchBusinessQrAnalytics, fetchBusinessStats } from "@/services/api/businessService";
import { queryKeys } from "@/services/api/queryClient";
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
  const [timeframe, setTimeframe] = usePersistedTimeframe<BusinessTimeframe>(
    PREFERENCE_KEYS.businessAnalyticsTimeframe,
    "month",
  );

  const statsQuery = useQuery({
    queryKey: [...queryKeys.businessStats, timeframe] as const,
    queryFn: () => fetchBusinessStats(timeframe),
    enabled: isAuthenticated,
  });

  const qrQuery = useQuery({
    queryKey: [...queryKeys.businessQrAnalytics, timeframe] as const,
    queryFn: () => fetchBusinessQrAnalytics(timeframe),
    enabled: includeQr && isAuthenticated && statsQuery.isSuccess,
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
