/** Dashboard chart tokens — mirrors web `dashboardChartTheme.ts` (CareTip teal bars + brand orange tips). */

export const DASHBOARD_CHART_BAR_BASE = "#197278";
export const DASHBOARD_CHART_GRID = "rgba(11, 18, 32, 0.12)";
export const DASHBOARD_CHART_AXIS = "rgba(91, 101, 119, 0.9)";

/** Same opacity ramp as web `dashboardChartBarFill`. */
export function dashboardChartBarFill(index: number, total: number): string {
  if (total <= 1) return DASHBOARD_CHART_BAR_BASE;
  const t = index / Math.max(total - 1, 1);
  const opacity = 0.42 + t * 0.38;
  const hex = DASHBOARD_CHART_BAR_BASE.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(2)})`;
}
