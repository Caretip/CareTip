import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type {
  BusinessQrAnalytics,
  BusinessQrAnalyticsTimeframe,
  EmployeeQrItem,
  LocationItem,
  QrCodeItem,
  TableItem,
} from "@/types/qr";
import type { BusinessProfile } from "@/types/business";
import {
  publicBusinessTipUrl,
  qrLocationUrl,
  qrTableUrl,
  resolveEmployeeQrUrl,
} from "@/utils/appPublicUrl";

export async function fetchQrAnalytics(
  timeframe: BusinessQrAnalyticsTimeframe = "month",
): Promise<BusinessQrAnalytics> {
  const { data } = await apiClient.get<BusinessQrAnalytics>(API_ENDPOINTS.business.qrAnalytics, {
    params: { timeframe },
  });
  return data;
}

export async function fetchLocations(): Promise<LocationItem[]> {
  const { data } = await apiClient.get<LocationItem[] | { items: LocationItem[] }>(
    API_ENDPOINTS.business.locations,
  );
  if (Array.isArray(data)) return data;
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchTables(): Promise<TableItem[]> {
  const { data } = await apiClient.get<TableItem[] | { items: TableItem[] }>(
    API_ENDPOINTS.business.tables,
  );
  if (Array.isArray(data)) return data;
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchBusinessEmployees(businessId: string): Promise<EmployeeQrItem[]> {
  const { data } = await apiClient.get<EmployeeQrItem[] | { employees: EmployeeQrItem[] }>(
    API_ENDPOINTS.business.employees,
    { params: { businessId } },
  );
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.employees)) return data.employees;
  return [];
}

export function buildQrInventory(
  profile: BusinessProfile,
  employees: EmployeeQrItem[],
  locations: LocationItem[],
  tables: TableItem[],
): QrCodeItem[] {
  const items: QrCodeItem[] = [];
  const businessSlug = profile.slug ?? null;
  const businessName = profile.businessName ?? profile.name ?? "Business";

  if (businessSlug) {
    items.push({
      id: `business-${profile.id}`,
      type: "business",
      title: businessName,
      subtitle: "Team directory QR",
      url: publicBusinessTipUrl(businessSlug),
      slug: businessSlug,
      imageUrl: profile.logo ?? null,
    });
  }

  for (const employee of employees) {
    const url = resolveEmployeeQrUrl({
      employeeId: employee.id,
      businessSlug,
      employeeSlug: employee.slug,
    });
    if (!url) continue;
    items.push({
      id: `employee-${employee.id}`,
      type: "employee",
      title: employee.name,
      subtitle: employee.jobTitle ?? "Employee QR",
      url,
      slug: employee.slug ?? null,
      imageUrl: employee.avatar ?? null,
    });
  }

  for (const location of locations) {
    items.push({
      id: `location-${location.id}`,
      type: "location",
      title: location.name,
      subtitle: "Location QR",
      url: qrLocationUrl(location.id),
    });
  }

  for (const table of tables) {
    items.push({
      id: `table-${table.id}`,
      type: "table",
      title: table.name,
      subtitle: table.location?.name ?? "Table QR",
      url: qrTableUrl(table.id),
      slug: table.qrSlug ?? null,
    });
  }

  return items;
}
