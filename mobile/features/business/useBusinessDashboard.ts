import { useQuery } from "@tanstack/react-query";
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
  const [timeframe, setTimeframe] = usePersistedTimeframe<BusinessTimeframe>(
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
    enabled: scoped && profileQuery.isSuccess,
  });

  const refresh = async () => {
    await Promise.all([profileQuery.refetch(), statsQuery.refetch()]);
  };

  return {
    timeframe,
    setTimeframe,
    profile: profileQuery.data,
    premiumTier,
    stats: statsQuery.data,
    isLoading: profileQuery.isLoading || statsQuery.isLoading,
    isRefreshing: profileQuery.isRefetching || statsQuery.isRefetching,
    error: profileQuery.error ?? statsQuery.error,
    refresh,
  };
}
