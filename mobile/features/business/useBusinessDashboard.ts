import { useQuery } from "@tanstack/react-query";
import { fetchBusinessProfile, fetchBusinessStats } from "@/services/api/businessService";
import { queryKeys } from "@/services/api/queryClient";
import { useBusinessStore } from "@/store/businessStore";
import { useAuth } from "@/hooks/useAuth";
import { usePersistedTimeframe } from "@/hooks/usePersistedTimeframe";
import { PREFERENCE_KEYS } from "@/constants/storageKeys";
import type { BusinessTimeframe } from "@/types/business";

export function useBusinessDashboard() {
  const { isAuthenticated } = useAuth();
  const [timeframe, setTimeframe] = usePersistedTimeframe<BusinessTimeframe>(
    PREFERENCE_KEYS.businessDashboardTimeframe,
    "month",
  );
  const setProfile = useBusinessStore((s) => s.setProfile);

  const profileQuery = useQuery({
    queryKey: queryKeys.businessProfile,
    queryFn: async () => {
      const profile = await fetchBusinessProfile();
      setProfile(profile);
      return profile;
    },
    enabled: isAuthenticated,
  });

  const statsQuery = useQuery({
    queryKey: [...queryKeys.businessStats, timeframe] as const,
    queryFn: () => fetchBusinessStats(timeframe),
    enabled: isAuthenticated && profileQuery.isSuccess,
  });

  const refresh = async () => {
    await Promise.all([profileQuery.refetch(), statsQuery.refetch()]);
  };

  return {
    timeframe,
    setTimeframe,
    profile: profileQuery.data,
    stats: statsQuery.data,
    isLoading: profileQuery.isLoading || statsQuery.isLoading,
    isRefreshing: profileQuery.isRefetching || statsQuery.isRefetching,
    error: profileQuery.error ?? statsQuery.error,
    refresh,
  };
}
