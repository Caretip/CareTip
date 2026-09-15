import type { TippingVenuePayload } from "../context/TipFlowContext";

/** Map public employee/staff DTO assignment onto TipFlow. Clears a stale location-QR venue. */
export function tippingVenueFromEmployeeAssignment(
  locationId?: string | null,
  locationName?: string | null,
): TippingVenuePayload | null {
  const id = locationId?.trim();
  if (!id) return null;
  return { locationId: id, locationName: locationName?.trim() || "" };
}

/** Persist originating venue on `/tip-amount` so refresh/cancel cannot fall back to a later assignment. */
export function applyGuestTipVenueSearchParams(
  qs: URLSearchParams,
  venue: { locationId?: string | null; tableId?: string | null },
): void {
  const loc = venue.locationId?.trim();
  const tbl = venue.tableId?.trim();
  if (loc) qs.set("locationId", loc);
  if (tbl) qs.set("tableId", tbl);
}

/** URL venue wins over Employee.locationId for this customer journey. */
export function tippingVenueFromGuestSearchParams(
  sp: Pick<URLSearchParams, "get">,
): TippingVenuePayload | null {
  const locationId = sp.get("locationId")?.trim() || "";
  const tableId = sp.get("tableId")?.trim() || null;
  if (!locationId) return null;
  return { locationId, locationName: "", tableId };
}
