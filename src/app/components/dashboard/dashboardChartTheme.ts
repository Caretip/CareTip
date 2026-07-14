/** Shared chart presentation tokens for business + employee dashboard shells. */

import { dashboardChartTooltipStyle, readThemeHsl } from "@/lib/theme/readThemeColor";

export const DASHBOARD_CHART_GRID = "hsl(var(--border) / 0.4)";
export const DASHBOARD_CHART_AXIS = "hsl(var(--muted-foreground) / 0.9)";
export const DASHBOARD_CHART_BAR = "hsl(var(--chart-3))";
export const DASHBOARD_CHART_BAR_SOFT = "hsl(var(--chart-3) / 0.72)";
export const DASHBOARD_CHART_AREA_STROKE = "hsl(var(--primary))";

export { dashboardChartTooltipStyle };

/** Runtime-resolved tooltip (updates when theme changes). */
export function getDashboardChartTooltipStyle() {
  return dashboardChartTooltipStyle();
}

export function dashboardChartBarFill(index: number, total: number): string {
  if (total <= 1) return readThemeHsl("--chart-3");
  const t = index / Math.max(total - 1, 1);
  const opacity = 0.42 + t * 0.38;
  return readThemeHsl("--chart-3", opacity);
}
