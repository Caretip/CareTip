import { fetchBusinessProfile } from "@/services/api/businessService";
import { fetchBusinessEmployees as fetchDirectoryEmployees } from "@/services/api/employeeDirectoryService";
import {
  buildQrInventory,
  fetchLocations,
  fetchTables,
} from "@/services/api/qrService";
import { queryClient, queryKeys, queryStaleTimes } from "@/services/api/queryClient";
import { saveOfflineQrItems } from "@/utils/offlineQrCache";
import { useQuery } from "@tanstack/react-query";
import type { EmployeeQrItem } from "@/types/qr";

/**
 * QR Studio — inventory + preview only (not analytics).
 */
export function useQrStudio() {
  const profileQuery = useQuery({
    queryKey: queryKeys.businessProfile,
    queryFn: fetchBusinessProfile,
    staleTime: queryStaleTimes.profile,
  });

  const inventoryQuery = useQuery({
    queryKey: [...queryKeys.businessQr, "inventory"] as const,
    queryFn: async () => {
      const profile = profileQuery.data ?? (await fetchBusinessProfile());
      const directoryEmployees = await queryClient.fetchQuery({
        queryKey: queryKeys.businessEmployees(profile.id),
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
      await saveOfflineQrItems(items);
      return items;
    },
    enabled: profileQuery.isSuccess,
    staleTime: queryStaleTimes.inventory,
  });

  const refresh = async () => {
    await Promise.all([profileQuery.refetch(), inventoryQuery.refetch()]);
  };

  return {
    profile: profileQuery.data,
    items: inventoryQuery.data ?? [],
    isLoading: profileQuery.isLoading || inventoryQuery.isLoading,
    isRefreshing: profileQuery.isRefetching || inventoryQuery.isRefetching,
    error: profileQuery.error ?? inventoryQuery.error,
    refresh,
  };
}
