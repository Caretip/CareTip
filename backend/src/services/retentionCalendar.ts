/**
 * Authoritative calendar-year retention date math.
 *
 * Policy: retain for N years from the END OF THE CALENDAR YEAR in which the
 * event occurred. Processing becomes eligible at the first instant of the
 * following year (exclusive end).
 *
 * Example (UTC): event 2026-08-15, 10 years
 *   calendar year = 2026
 *   retain through end of 2036
 *   eligibleAt = 2037-01-01T00:00:00.000Z
 *
 * Do not substitute now − (N * 365) days for this rule.
 */

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

export type TimeZoneResolution =
  | { ok: true; timeZone: string }
  | { ok: false; reason: "invalid_timezone" };

export type CalendarYearResult =
  | {
      ok: true;
      calendarYear: number;
      eligibleAt: Date;
      timeZoneUsed: string;
    }
  | { ok: false; reason: "invalid_timezone" | "invalid_years" | "invalid_event_date" };

export function isValidTimeZone(timeZone: string): boolean {
  const tz = String(timeZone ?? "").trim();
  if (!tz) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(timeZone?: string | null): TimeZoneResolution {
  if (timeZone == null || String(timeZone).trim() === "") {
    return { ok: true, timeZone: "UTC" };
  }
  const tz = String(timeZone).trim();
  if (!isValidTimeZone(tz)) return { ok: false, reason: "invalid_timezone" };
  return { ok: true, timeZone: tz };
}

export function calendarYearInTimeZone(
  eventDate: Date,
  timeZone: string,
): { ok: true; year: number } | { ok: false; reason: "invalid_timezone" | "invalid_event_date" } {
  if (!(eventDate instanceof Date) || Number.isNaN(eventDate.getTime())) {
    return { ok: false, reason: "invalid_event_date" };
  }
  const resolved = resolveTimeZone(timeZone);
  if (!resolved.ok) return { ok: false, reason: "invalid_timezone" };
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: resolved.timeZone,
    year: "numeric",
  }).format(eventDate);
  const year = Number(formatted);
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    return { ok: false, reason: "invalid_event_date" };
  }
  return { ok: true, year };
}

/**
 * Exclusive eligibility instant: 00:00:00.000 UTC on 1 January of
 * (eventCalendarYear + years + 1).
 *
 * The calendar year itself is determined in `timeZone` (default UTC).
 * The exclusive instant is compared in UTC so all workers share one clock.
 */
export function calendarYearRetentionEligibleAt(
  eventDate: Date,
  years: number,
  timeZone?: string | null,
): CalendarYearResult {
  if (!Number.isInteger(years) || years < 0 || years > 100) {
    return { ok: false, reason: "invalid_years" };
  }
  const resolved = resolveTimeZone(timeZone);
  if (!resolved.ok) return { ok: false, reason: "invalid_timezone" };
  const yearRes = calendarYearInTimeZone(eventDate, resolved.timeZone);
  if (!yearRes.ok) return { ok: false, reason: yearRes.reason };
  const eligibleAt = new Date(Date.UTC(yearRes.year + years + 1, 0, 1, 0, 0, 0, 0));
  return {
    ok: true,
    calendarYear: yearRes.year,
    eligibleAt,
    timeZoneUsed: resolved.timeZone,
  };
}

export function isCalendarYearRetentionElapsed(
  eventDate: Date,
  years: number,
  now: Date,
  timeZone?: string | null,
): { elapsed: boolean; eligibleAt: Date | null; failClosed: boolean; reason?: string } {
  const res = calendarYearRetentionEligibleAt(eventDate, years, timeZone);
  if (!res.ok) {
    return { elapsed: false, eligibleAt: null, failClosed: true, reason: res.reason };
  }
  return {
    elapsed: now.getTime() >= res.eligibleAt.getTime(),
    eligibleAt: res.eligibleAt,
    failClosed: false,
  };
}

export function addUtcDays(from: Date, days: number): Date {
  if (!(from instanceof Date) || Number.isNaN(from.getTime()) || !Number.isInteger(days)) {
    throw new Error("addUtcDays requires a valid Date and integer days");
  }
  return new Date(from.getTime() + days * MS_DAY);
}

export function addUtcHours(from: Date, hours: number): Date {
  if (!(from instanceof Date) || Number.isNaN(from.getTime()) || !Number.isFinite(hours)) {
    throw new Error("addUtcHours requires a valid Date and finite hours");
  }
  return new Date(from.getTime() + hours * MS_HOUR);
}

export function hoursCutoff(hours: number, now = new Date()): Date {
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error("hoursCutoff requires a non-negative finite hour count");
  }
  return new Date(now.getTime() - hours * MS_HOUR);
}

export function daysCutoff(days: number, now = new Date()): Date {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error("daysCutoff requires a non-negative integer day count");
  }
  return new Date(now.getTime() - days * MS_DAY);
}
