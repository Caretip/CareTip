/**
 * Dev-only KPI integrity checks.
 * Never throws; never runs in production builds.
 */
export function assertKpiChartIntegrity(opts: {
  kpiTotal: number;
  chartAmounts: number[];
  label?: string;
  /** Absolute EUR tolerance (floating-point / rounding). */
  toleranceEur?: number;
}): void {
  if (!import.meta.env.DEV) return;
  if (!opts.chartAmounts.length) return;

  const chartSum = opts.chartAmounts.reduce((sum, n) => sum + (Number(n) || 0), 0);
  const kpi = Number(opts.kpiTotal) || 0;
  const tolerance = opts.toleranceEur ?? 0.05;
  const delta = Math.abs(chartSum - kpi);
  if (delta <= tolerance) return;

  console.warn(
    `[SSOT] KPI↔chart mismatch${opts.label ? ` (${opts.label})` : ""}: KPI=${kpi.toFixed(2)} chartSum=${chartSum.toFixed(2)} Δ=${delta.toFixed(2)}`,
  );
}

export function assertRankingsReconcile(opts: {
  label?: string;
  rankings?: Array<{ tipsEur: number }>;
  /** Soft check: ranking totals should not exceed KPI (partial rankings OK). */
  kpiTotal: number;
  toleranceEur?: number;
}): void {
  if (!import.meta.env.DEV) return;
  const rankings = opts.rankings ?? [];
  if (!rankings.length) return;
  const sum = rankings.reduce((s, r) => s + (Number(r.tipsEur) || 0), 0);
  const kpi = Number(opts.kpiTotal) || 0;
  const tolerance = opts.toleranceEur ?? 0.05;
  if (sum > kpi + tolerance) {
    console.warn(
      `[SSOT] Rankings exceed KPI${opts.label ? ` (${opts.label})` : ""}: rankingsSum=${sum.toFixed(2)} KPI=${kpi.toFixed(2)}`,
    );
  }
}

/** Refund ledger must never be treated as tip GMV. */
export function assertRefundsExcludedFromGmv(opts: {
  label?: string;
  tipGmvEur: number;
  refundLedgerEur?: number;
}): void {
  if (!import.meta.env.DEV) return;
  // Structural guard: tip GMV path must not silently equal refund ledger when both non-zero
  // and identical (common fabrication smell). Soft informational only.
  const gmv = Number(opts.tipGmvEur) || 0;
  const refunds = Number(opts.refundLedgerEur) || 0;
  if (gmv > 0 && refunds > 0 && Math.abs(gmv - refunds) < 0.01) {
    console.warn(
      `[SSOT] Tip GMV equals refund ledger total${opts.label ? ` (${opts.label})` : ""} — verify refunds are not mixed into GMV`,
    );
  }
}

/** After live optimistic patch, chart + KPI should still reconcile within tolerance. */
export function assertLivePatchReconciles(opts: {
  label?: string;
  kpiTotal: number;
  chartAmounts: number[];
  toleranceEur?: number;
}): void {
  assertKpiChartIntegrity({
    ...opts,
    label: opts.label ? `live:${opts.label}` : "live",
  });
}

export function runBusinessSsotIntegrityChecks(opts: {
  label?: string;
  kpiTotal: number;
  chartAmounts: number[];
  locationRankings?: Array<{ tipsEur: number }>;
  tableRankings?: Array<{ tipsEur: number }>;
}): void {
  if (!import.meta.env.DEV) return;
  assertKpiChartIntegrity(opts);
  assertRankingsReconcile({
    label: opts.label ? `${opts.label}.locations` : "locations",
    rankings: opts.locationRankings,
    kpiTotal: opts.kpiTotal,
  });
  assertRankingsReconcile({
    label: opts.label ? `${opts.label}.tables` : "tables",
    rankings: opts.tableRankings,
    kpiTotal: opts.kpiTotal,
  });
}
