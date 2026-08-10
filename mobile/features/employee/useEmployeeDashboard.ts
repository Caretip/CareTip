import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchEmployeeProfile, fetchEmployeeTips } from "@/services/api/employeeService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { usePersistedTimeframe } from "@/hooks/usePersistedTimeframe";
import { PREFERENCE_KEYS } from "@/constants/storageKeys";
import type { EmployeeTimeframe } from "@/types/employee";

export function useEmployeeDashboard() {
  const { isAuthenticated } = useAuth();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const scoped = Boolean(isAuthenticated && userId);
  const [timeframe, setTimeframe, timeframeReady] = usePersistedTimeframe<EmployeeTimeframe>(
    PREFERENCE_KEYS.employeeDashboardTimeframe,
    "week",
  );
  const profileQuery = useQuery({
    queryKey: keys.employeeMe,
    queryFn: fetchEmployeeProfile,
    enabled: scoped,
    staleTime: queryStaleTimes.profile,
  });

  const tipsQuery = useQuery({
    queryKey: [...keys.employeeTips, timeframe] as const,
    queryFn: () => fetchEmployeeTips(timeframe),
    enabled: scoped && timeframeReady && profileQuery.isSuccess,
    placeholderData: keepPreviousData,
  });

  const refresh = async () => {
    await Promise.all([profileQuery.refetch(), tipsQuery.refetch()]);
  };

  const profile = profileQuery.data;
  const tips = tipsQuery.data;

  return {
    timeframe,
    setTimeframe,
    profile,
    tips,
    /** Full-screen spinner only until profile lands; tips can fail independently. */
    isLoading: profileQuery.isLoading && !profile,
    /** Period toggle: keep prior tips visible while the new period fetches. */
    isTipsLoading: (tipsQuery.isLoading || tipsQuery.isFetching) && !tips,
    isRefreshing: profileQuery.isRefetching || tipsQuery.isRefetching,
    error: profileQuery.error ?? tipsQuery.error,
    tipsError: tipsQuery.error,
    refresh,
  };
}
