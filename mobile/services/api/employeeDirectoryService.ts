import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";

export type BusinessDirectoryEmployee = {
  id: string;
  slug?: string | null;
  name: string;
  role: string;
  avatar: string | null;
  rating: number | null;
  tips: number;
  topRated: boolean;
  isActive?: boolean;
};

function normalizeEmployeeList(raw: unknown): BusinessDirectoryEmployee[] {
  if (Array.isArray(raw)) return raw as BusinessDirectoryEmployee[];
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const key of ["employees", "items", "data"]) {
      if (Array.isArray(record[key])) return record[key] as BusinessDirectoryEmployee[];
    }
  }
  return [];
}

export async function fetchBusinessEmployees(
  businessId: string,
): Promise<BusinessDirectoryEmployee[]> {
  const { data } = await apiClient.get<unknown>(API_ENDPOINTS.business.employees, {
    params: { businessId },
  });
  return normalizeEmployeeList(data);
}
