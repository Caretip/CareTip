import { useQuery } from "@tanstack/react-query";
import { fetchBusinessProfile, fetchBusinessQrAnalytics, fetchBusinessStats } from "@/services/api/businessService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { usePersistedTimeframe } from "@/hooks/usePersistedTimeframe";
import { PREFERENCE_KEYS } from "@/constants/storageKeys";
import {
  isPremiumAnalyticsTier,
  resolveAnalyticsStatsScope,
} from "@/utils/businessStatsScope";
import type { BusinessTimeframe } from "@/types/business";

type UseBusinessAnalyticsOptions = {
  /** When true, fetches QR scan analytics only for Premium+ (backend-gated). */
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

  const profileQuery = useQuery({
    queryKey: keys.businessProfile,
    queryFn: fetchBusinessProfile,
    enabled: scoped,
    staleTime: queryStaleTimes.profile,
  });

  const statsScope = resolveAnalyticsStatsScope(profileQuery.data?.subscriptionTier);
  const premiumTier = isPremiumAnalyticsTier(profileQuery.data?.subscriptionTier);

  const statsQuery = useQuery({
    queryKey: [...keys.businessStats, timeframe, statsScope] as const,
    queryFn: () => fetchBusinessStats(timeframe, statsScope),
    enabled: scoped && profileQuery.isSuccess,
  });

  // Never call Premium-only QR analytics on Basic — show upgrade UI instead.
  const qrQuery = useQuery({
    queryKey: [...keys.businessQrAnalytics, timeframe] as const,
    queryFn: () => fetchBusinessQrAnalytics(timeframe),
    enabled: includeQr && premiumTier && scoped && statsQuery.isSuccess,
  });

  const refresh = async () => {
    await Promise.all([
      profileQuery.refetch(),
      statsQuery.refetch(),
      ...(includeQr && premiumTier ? [qrQuery.refetch()] : []),
    ]);
  };

  return {
    timeframe,
    setTimeframe,
    profile: profileQuery.data,
    premiumTier,
    stats: statsQuery.data,
    qrAnalytics: includeQr && premiumTier ? qrQuery.data : undefined,
    isLoading: profileQuery.isLoading || statsQuery.isLoading,
    isRefreshing: statsQuery.isRefetching || (includeQr && premiumTier && qrQuery.isRefetching),
    // Do not surface QR entitlement errors into the whole Analytics page.
    error: profileQuery.error ?? statsQuery.error,
    refresh,
  };
}
