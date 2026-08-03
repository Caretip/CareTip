import { useQuery } from "@tanstack/react-query";
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
  const [timeframe, setTimeframe] = usePersistedTimeframe<EmployeeTimeframe>(
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
    enabled: scoped && profileQuery.isSuccess,
  });

  const refresh = async () => {
    await Promise.all([profileQuery.refetch(), tipsQuery.refetch()]);
  };

  return {
    timeframe,
    setTimeframe,
    profile: profileQuery.data,
    tips: tipsQuery.data,
    /** Full-screen spinner only until profile lands; tips can fail independently. */
    isLoading: profileQuery.isLoading,
    isTipsLoading: tipsQuery.isLoading || tipsQuery.isFetching,
    isRefreshing: profileQuery.isRefetching || tipsQuery.isRefetching,
    error: profileQuery.error ?? tipsQuery.error,
    tipsError: tipsQuery.error,
    refresh,
  };
}
