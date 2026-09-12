import type { TipActivityRow } from "../api";
import type { LiveNewTipPayload } from "./realtimeContracts";

export function liveTipToActivityRow(payload: LiveNewTipPayload): TipActivityRow {
  return {
    id: payload.tip.id,
    amount: payload.tip.amount,
    status: payload.tip.status,
    createdAt: payload.tip.createdAt,
    employeeId: payload.employeeId ?? "",
    locationId: null,
    tableId: null,
    staffName: payload.employeeName ?? null,
    locationName: null,
    tableName: null,
  };
}

/** Prepend a live tip if it is not already in the first page. */
export function mergeLiveTipIntoActivity(
  items: TipActivityRow[],
  payload: LiveNewTipPayload,
): { items: TipActivityRow[]; added: boolean } {
  if (!payload.tip?.id) return { items, added: false };
  if (items.some((row) => row.id === payload.tip.id)) {
    return { items, added: false };
  }
  return { items: [liveTipToActivityRow(payload), ...items], added: true };
}
