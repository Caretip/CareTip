import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type { TipActivityRow, TipListParams, TipListResult } from "@/types/tips";

function buildTipParams(params: TipListParams): Record<string, string | number> {
  const q: Record<string, string | number> = {};
  if (params.take != null) q.take = params.take;
  if (params.skip != null) q.skip = params.skip;
  if (params.q?.trim()) q.q = params.q.trim();
  if (params.status) q.status = params.status;
  if (params.range) q.range = params.range;
  if (params.fromDate) q.fromDate = params.fromDate;
  if (params.toDate) q.toDate = params.toDate;
  if (params.employeeId) q.employeeId = params.employeeId;
  if (params.locationId) q.locationId = params.locationId;
  if (params.tableId) q.tableId = params.tableId;
  return q;
}

export async function fetchBusinessTips(params: TipListParams = {}): Promise<TipListResult> {
  const { data } = await apiClient.get<TipListResult>(API_ENDPOINTS.tips.business, {
    params: buildTipParams(params),
  });
  return {
    timezone: data.timezone,
    total: data.total ?? 0,
    items: Array.isArray(data.items) ? data.items : [],
  };
}

export async function fetchEmployeeTipsList(params: TipListParams = {}): Promise<TipListResult> {
  const { data } = await apiClient.get<TipListResult>(API_ENDPOINTS.tips.employeeList, {
    params: buildTipParams(params),
  });
  return {
    timezone: data.timezone,
    total: data.total ?? 0,
    items: Array.isArray(data.items) ? data.items : [],
  };
}

/**
 * Resolve a tip by id using existing list endpoints (no dedicated tip-by-id API).
 * Used when deep links / cold opens lack the list payload param.
 */
export async function findTipById(
  audience: "business" | "employee",
  tipId: string,
): Promise<TipActivityRow | null> {
  const id = tipId.trim();
  if (!id) return null;
  const fetchList = audience === "business" ? fetchBusinessTips : fetchEmployeeTipsList;

  const searched = await fetchList({ take: 50, q: id });
  const fromSearch = searched.items.find((row) => row.id === id);
  if (fromSearch) return fromSearch;

  const recent = await fetchList({ take: 100 });
  return recent.items.find((row) => row.id === id) ?? null;
}
