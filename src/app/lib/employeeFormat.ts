import { formatVenueDateTime, venueLocalDayKey, venueLocalTodayKey, resolveBusinessTimezone } from "./businessVenueTime";
import type { TipItem } from "./api";

/** Localized date+time for tip rows — always venue (or cached business) timezone. */
export function formatTipDateTime(iso: string, localeTag?: string, timeZone?: string | null): string {
  return formatVenueDateTime(iso, resolveBusinessTimezone(timeZone), localeTag || "en");
}

/**
 * Consecutive venue-calendar days with at least one tip.
 * Uses IANA venue timezone — never browser `getDate()`.
 */
export function computeEmployeeTipStreakDays(
  tips: TipItem[],
  timeZone?: string | null,
  now = new Date(),
): number {
  if (tips.length === 0) return 0;
  const tz = resolveBusinessTimezone(timeZone);
  const dayKeys = new Set(
    tips.map((t) => venueLocalDayKey(t.createdAt, tz)).filter(Boolean),
  );
  let streak = 0;
  let cursorKey = venueLocalTodayKey(tz, now);
  for (let i = 0; i < 30; i++) {
    if (!dayKeys.has(cursorKey)) break;
    streak += 1;
    // Step back one venue calendar day via UTC noon of previous YMD.
    const [y, m, d] = cursorKey.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
    cursorKey = venueLocalDayKey(prev, tz);
    if (!cursorKey) break;
  }
  return streak;
}
