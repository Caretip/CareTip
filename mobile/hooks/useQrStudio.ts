import { fetchBusinessProfile } from "@/services/api/businessService";
import { fetchBusinessEmployees as fetchDirectoryEmployees } from "@/services/api/employeeDirectoryService";
import {
  buildQrInventory,
  fetchLocations,
  fetchTables,
} from "@/services/api/qrService";
import { queryClient, queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { saveOfflineQrItems } from "@/utils/offlineQrCache";
import { useQuery } from "@tanstack/react-query";
import type { EmployeeQrItem } from "@/types/qr";

/**
 * QR Studio — inventory + preview only (not analytics).
 * Offline persistence is scoped to AuthUser.id; late writes after account switch are dropped.
 */
export function useQrStudio() {
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const scoped = Boolean(userId);

  const profileQuery = useQuery({
    queryKey: keys.businessProfile,
    queryFn: fetchBusinessProfile,
    enabled: scoped,
    staleTime: queryStaleTimes.profile,
  });

  const inventoryQuery = useQuery({
    queryKey: [...keys.businessQr, "inventory"] as const,
    queryFn: async () => {
      const ownerUserId = userId;
      if (!ownerUserId) return [];

      const profile = profileQuery.data ?? (await fetchBusinessProfile());
      const directoryEmployees = await queryClient.fetchQuery({
        queryKey: keys.businessEmployees(profile.id),
        queryFn: () => fetchDirectoryEmployees(profile.id),
        staleTime: queryStaleTimes.roster,
      });
      const employees: EmployeeQrItem[] = directoryEmployees.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        avatar: row.avatar,
      }));
      const [locations, tables] = await Promise.all([fetchLocations(), fetchTables()]);
      const items = buildQrInventory(profile, employees, locations, tables);
      await saveOfflineQrItems(ownerUserId, items, profile.id);
      return items;
    },
    enabled: scoped && profileQuery.isSuccess,
    staleTime: queryStaleTimes.inventory,
  });

  const refresh = async () => {
    await Promise.all([profileQuery.refetch(), inventoryQuery.refetch()]);
  };

  return {
    userId,
    profile: profileQuery.data,
    items: inventoryQuery.data ?? [],
    isLoading: profileQuery.isLoading || inventoryQuery.isLoading,
    isRefreshing: profileQuery.isRefetching || inventoryQuery.isRefetching,
    error: profileQuery.error ?? inventoryQuery.error,
    refresh,
  };
}
