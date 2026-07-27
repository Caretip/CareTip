import { fetchBusinessProfile } from "@/services/api/businessService";
import {
  buildQrInventory,
  fetchBusinessEmployees,
  fetchLocations,
  fetchTables,
} from "@/services/api/qrService";
import { queryKeys } from "@/services/api/queryClient";
import { saveOfflineQrItems } from "@/utils/offlineQrCache";
import { useQuery } from "@tanstack/react-query";

/**
 * QR Studio — inventory + preview only (not analytics).
 */
export function useQrStudio() {
  const profileQuery = useQuery({
    queryKey: queryKeys.businessProfile,
    queryFn: fetchBusinessProfile,
  });

  const inventoryQuery = useQuery({
    queryKey: [...queryKeys.businessQr, "inventory"] as const,
    queryFn: async () => {
      const profile = profileQuery.data ?? (await fetchBusinessProfile());
      const [employees, locations, tables] = await Promise.all([
        fetchBusinessEmployees(profile.id),
        fetchLocations(),
        fetchTables(),
      ]);
      const items = buildQrInventory(profile, employees, locations, tables);
      await saveOfflineQrItems(items);
      return items;
    },
    enabled: profileQuery.isSuccess,
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
