import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchBusinessProfile, fetchBusinessStats } from "@/services/api/businessService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { usePersistedTimeframe } from "@/hooks/usePersistedTimeframe";
import { PREFERENCE_KEYS } from "@/constants/storageKeys";
import {
  isPremiumAnalyticsTier,
  resolveDashboardStatsScope,
} from "@/utils/businessStatsScope";
import type { BusinessTimeframe } from "@/types/business";

export function useBusinessDashboard() {
  const { isAuthenticated } = useAuth();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const scoped = Boolean(isAuthenticated && userId);
  const [timeframe, setTimeframe, timeframeReady] = usePersistedTimeframe<BusinessTimeframe>(
    PREFERENCE_KEYS.businessDashboardTimeframe,
    "month",
  );
  const profileQuery = useQuery({
    queryKey: keys.businessProfile,
    queryFn: fetchBusinessProfile,
    enabled: scoped,
    staleTime: queryStaleTimes.profile,
  });

  // Basic → summary; Premium+ → full (charts + employeeGoals; web parity).
  const statsScope = resolveDashboardStatsScope(profileQuery.data?.subscriptionTier);
  const premiumTier = isPremiumAnalyticsTier(profileQuery.data?.subscriptionTier);

  const statsQuery = useQuery({
    queryKey: [...keys.businessStats, timeframe, statsScope] as const,
    queryFn: () => fetchBusinessStats(timeframe, statsScope),
    enabled: scoped && timeframeReady && profileQuery.isSuccess,
    placeholderData: keepPreviousData,
  });

  const refresh = async () => {
    await Promise.all([profileQuery.refetch(), statsQuery.refetch()]);
  };

  const profile = profileQuery.data;
  const stats = statsQuery.data;

  return {
    timeframe,
    setTimeframe,
    profile,
    premiumTier,
    stats,
    /** Full skeleton only on first paint — not on period toggles / background refetch. */
    isLoading:
      !timeframeReady ||
      (profileQuery.isLoading && !profile) ||
      (statsQuery.isLoading && !stats),
    isRefreshing: profileQuery.isRefetching || statsQuery.isRefetching,
    error: profileQuery.error ?? statsQuery.error,
    refresh,
  };
}
