import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { fetchBusinessEmployees } from "@/services/api/employeeDirectoryService";
import { fetchBusinessProfile } from "@/services/api/businessService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";

export type EmployeeAvatarLookup = {
  byId: Map<string, string | null>;
  byName: Map<string, string | null>;
  resolve: (opts: {
    employeeId?: string | null;
    name?: string | null;
  }) => string | null | undefined;
  isLoading: boolean;
};

/**
 * Manager-side roster avatar index — join tip/feedback/leaderboard rows that
 * only expose employeeId / name onto directory `avatar` URLs.
 */
export function useEmployeeAvatarLookup(enabled = true): EmployeeAvatarLookup {
  const { user } = useAuth();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const isManager = user?.role === "MANAGER";

  const profileQuery = useQuery({
    queryKey: keys.businessProfile,
    queryFn: fetchBusinessProfile,
    enabled: enabled && Boolean(userId) && Boolean(isManager),
    staleTime: queryStaleTimes.profile,
  });

  const businessId = user?.businessId ?? profileQuery.data?.id ?? "";

  const teamQuery = useQuery({
    queryKey: keys.businessEmployees(businessId),
    queryFn: () => fetchBusinessEmployees(businessId),
    enabled: enabled && Boolean(userId && businessId && isManager),
    staleTime: queryStaleTimes.roster,
  });

  return useMemo(() => {
    const byId = new Map<string, string | null>();
    const byName = new Map<string, string | null>();
    for (const employee of teamQuery.data ?? []) {
      byId.set(employee.id, employee.avatar);
      const key = employee.name.trim().toLowerCase();
      if (key) byName.set(key, employee.avatar);
    }
    return {
      byId,
      byName,
      resolve: ({ employeeId, name }) => {
        if (employeeId && byId.has(employeeId)) return byId.get(employeeId);
        const nameKey = name?.trim().toLowerCase();
        if (nameKey && byName.has(nameKey)) return byName.get(nameKey);
        return undefined;
      },
      isLoading: profileQuery.isLoading || teamQuery.isLoading,
    };
  }, [profileQuery.isLoading, teamQuery.data, teamQuery.isLoading]);
}
