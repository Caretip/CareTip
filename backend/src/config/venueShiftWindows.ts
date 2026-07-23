/**
 * Configurable venue shift windows (business-local hours).
 * Authoritative for peak/best-shift SQL mapping and avg tips per completed shift.
 * Late wraps midnight (22–24 and 0–6).
 */
export type VenueShiftKey = "morning" | "afternoon" | "evening" | "late";

export type VenueShiftWindow = {
  key: VenueShiftKey;
  /** Inclusive start hour 0–23 */
  startHour: number;
  /** Exclusive end hour 0–24 (24 = end of day); late may wrap */
  endHour: number;
};

/** Default CareTip venue shifts — product can override later via business settings. */
export const DEFAULT_VENUE_SHIFT_WINDOWS: readonly VenueShiftWindow[] = [
  { key: "morning", startHour: 6, endHour: 12 },
  { key: "afternoon", startHour: 12, endHour: 17 },
  { key: "evening", startHour: 17, endHour: 22 },
  { key: "late", startHour: 22, endHour: 6 },
] as const;

export function shiftKeyForHour(
  hour: number,
  windows: readonly VenueShiftWindow[] = DEFAULT_VENUE_SHIFT_WINDOWS,
): VenueShiftKey {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  for (const w of windows) {
    if (w.startHour < w.endHour) {
      if (h >= w.startHour && h < w.endHour) return w.key;
    } else {
      // wraps midnight
      if (h >= w.startHour || h < w.endHour) return w.key;
    }
  }
  return "late";
}

export type TipShiftAggregate = {
  peakHour: number | null;
  peakHourAmount: number;
  bestShift: VenueShiftKey | null;
  bestShiftAmount: number;
  /** Distinct (local day × shift) buckets with ≥1 successful tip */
  completedShifts: number;
  /**
   * periodTipsEur / completedShifts when completedShifts > 0; otherwise null (never fabricate).
   */
  avgTipsPerShift: number | null;
  hourlyTotals: Array<{ hour: number; amount: number }>;
  shiftTotals: Array<{ shift: VenueShiftKey; amount: number; tipCount: number }>;
};

export function buildTipShiftAggregateFromHourly(
  hourlyByHour: Map<number, number>,
  /** Optional day×shift completion count from SQL; if omitted, estimate completions from hours only as null avg. */
  completedShifts: number,
  tipCountByHour?: Map<number, number>,
): TipShiftAggregate {
  let peakHour: number | null = null;
  let peakHourAmount = 0;
  const shiftAmounts: Record<VenueShiftKey, number> = {
    morning: 0,
    afternoon: 0,
    evening: 0,
    late: 0,
  };
  const shiftCounts: Record<VenueShiftKey, number> = {
    morning: 0,
    afternoon: 0,
    evening: 0,
    late: 0,
  };

  const hourlyTotals: Array<{ hour: number; amount: number }> = [];
  for (let h = 0; h < 24; h += 1) {
    const amount = hourlyByHour.get(h) ?? 0;
    hourlyTotals.push({ hour: h, amount });
    if (amount > peakHourAmount) {
      peakHourAmount = amount;
      peakHour = h;
    }
    if (amount > 0) {
      const key = shiftKeyForHour(h);
      shiftAmounts[key] += amount;
      shiftCounts[key] += tipCountByHour?.get(h) ?? 0;
    }
  }

  let bestShift: VenueShiftKey | null = null;
  let bestShiftAmount = 0;
  for (const key of Object.keys(shiftAmounts) as VenueShiftKey[]) {
    if (shiftAmounts[key] > bestShiftAmount) {
      bestShiftAmount = shiftAmounts[key];
      bestShift = key;
    }
  }

  const periodTips = [...hourlyByHour.values()].reduce((s, n) => s + n, 0);
  const avgTipsPerShift =
    completedShifts > 0 && periodTips > 0 ? periodTips / completedShifts : null;

  return {
    peakHour: peakHourAmount > 0 ? peakHour : null,
    peakHourAmount,
    bestShift: bestShiftAmount > 0 ? bestShift : null,
    bestShiftAmount,
    completedShifts,
    avgTipsPerShift,
    hourlyTotals,
    shiftTotals: (Object.keys(shiftAmounts) as VenueShiftKey[]).map((shift) => ({
      shift,
      amount: shiftAmounts[shift],
      tipCount: shiftCounts[shift],
    })),
  };
}
