import { colors } from "@/theme/colors";

/** Neutral bar base — top performer uses brand orange. */
export const DASHBOARD_CHART_BAR_BASE = colors.chartNeutral;
export const DASHBOARD_CHART_BAR_ACCENT = colors.primary;
export const DASHBOARD_CHART_GRID = "rgba(17, 24, 39, 0.06)";
export const DASHBOARD_CHART_AXIS = colors.mutedForeground;

const NEUTRAL_BAR_STEPS = [colors.chartNeutral, colors.chartNeutralMuted, "#F3F4F6"] as const;

/** Ranked bars: #1 orange, others neutral gray ramp. */
export function dashboardChartBarFill(index: number, _total: number): string {
  if (index === 0) return DASHBOARD_CHART_BAR_ACCENT;
  return NEUTRAL_BAR_STEPS[Math.min(index, NEUTRAL_BAR_STEPS.length - 1)] ?? DASHBOARD_CHART_BAR_BASE;
}
