/**
 * Activity Center view filter — UI chips only.
 * "today" is client-side venue-midnight filter; source chips map to API source soft-sync.
 */
export type ActivityCenterFilter = "all" | "today" | "TIPS" | "QR" | "PAYMENTS";

export function activityFilterToApiSource(
  filter: ActivityCenterFilter,
): import("./api").ActivityEventSource | "all" {
  if (filter === "today" || filter === "all") return "all";
  return filter;
}
