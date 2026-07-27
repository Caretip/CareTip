import { useQuery } from "@tanstack/react-query";
import { fetchEmployeeProfile, fetchEmployeeTips } from "@/services/api/employeeService";
import { queryKeys } from "@/services/api/queryClient";
import { useEmployeeStore } from "@/store/employeeStore";
import { useAuth } from "@/hooks/useAuth";
import { usePersistedTimeframe } from "@/hooks/usePersistedTimeframe";
import { PREFERENCE_KEYS } from "@/constants/storageKeys";
import type { EmployeeTimeframe } from "@/types/employee";

export function useEmployeeDashboard() {
  const { isAuthenticated } = useAuth();
  const [timeframe, setTimeframe] = usePersistedTimeframe<EmployeeTimeframe>(
    PREFERENCE_KEYS.employeeDashboardTimeframe,
    "week",
  );
  const setProfile = useEmployeeStore((s) => s.setProfile);

  const profileQuery = useQuery({
    queryKey: queryKeys.employeeMe,
    queryFn: async () => {
      const profile = await fetchEmployeeProfile();
      setProfile(profile);
      return profile;
    },
    enabled: isAuthenticated,
  });

  const tipsQuery = useQuery({
    queryKey: [...queryKeys.employeeTips, timeframe] as const,
    queryFn: () => fetchEmployeeTips(timeframe),
    enabled: isAuthenticated && profileQuery.isSuccess,
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
