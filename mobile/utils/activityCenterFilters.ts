import type { ActivityCenterFilter, ActivityEventSource } from "@/types/activity";

/** Maps UI filter chips to Activity API `source` param (matches web). */
export function activityFilterToApiSource(
  filter: ActivityCenterFilter,
): ActivityEventSource | "all" {
  if (filter === "today" || filter === "all") return "all";
  return filter;
}
