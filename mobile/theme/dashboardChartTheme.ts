import type { ColorPalette } from "./colors";

/** Theme-aware chart tokens for dashboard SVG / bar fills. */
export function getDashboardChartGrid(isDark: boolean): string {
  return isDark ? "rgba(248, 250, 252, 0.08)" : "rgba(17, 24, 39, 0.06)";
}

export function getDashboardChartAxis(colors: ColorPalette): string {
  return colors.mutedForeground;
}

export function getDashboardChartBarAccent(colors: ColorPalette): string {
  return colors.primary;
}

export function getDashboardChartBarBase(colors: ColorPalette): string {
  return colors.chartNeutral;
}

/** Ranked bars: #1 accent, others neutral gray ramp. */
export function dashboardChartBarFill(
  index: number,
  _total: number,
  colors: ColorPalette,
): string {
  if (index === 0) return colors.primary;
  const steps = [colors.chartNeutral, colors.chartNeutralMuted, colors.secondary] as const;
  return steps[Math.min(index, steps.length - 1)] ?? colors.chartNeutral;
}
