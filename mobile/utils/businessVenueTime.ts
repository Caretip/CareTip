export const DEFAULT_BUSINESS_TIMEZONE = "Europe/Berlin";

export function sanitizeBusinessTimezone(tz: unknown): string {
  const raw = typeof tz === "string" ? tz.trim() : "";
  if (!raw) return DEFAULT_BUSINESS_TIMEZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return DEFAULT_BUSINESS_TIMEZONE;
  }
}

export function resolveBusinessTimezone(explicit?: string | null): string {
  if (explicit != null && String(explicit).trim()) {
    return sanitizeBusinessTimezone(explicit);
  }
  return DEFAULT_BUSINESS_TIMEZONE;
}

export function venueLocalDayKey(isoOrDate: string | Date, timeZone: string): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "";
  const tz = sanitizeBusinessTimezone(timeZone);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function venueLocalTodayKey(timeZone: string, now = new Date()): string {
  return venueLocalDayKey(now, timeZone);
}

export function isWithinVenueLocalDay(
  isoOrDate: string | Date,
  timeZone?: string | null,
  now = new Date(),
): boolean {
  const tz = resolveBusinessTimezone(timeZone);
  const eventKey = venueLocalDayKey(isoOrDate, tz);
  if (!eventKey) return false;
  return eventKey === venueLocalTodayKey(tz, now);
}

export function isVenueLocalYesterday(
  isoOrDate: string | Date,
  timeZone?: string | null,
  now = new Date(),
): boolean {
  const tz = resolveBusinessTimezone(timeZone);
  const eventKey = venueLocalDayKey(isoOrDate, tz);
  if (!eventKey) return false;
  const todayKey = venueLocalTodayKey(tz, now);
  let candidate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  let yesterdayKey = venueLocalDayKey(candidate, tz);
  if (yesterdayKey === todayKey) {
    candidate = new Date(now.getTime() - 36 * 60 * 60 * 1000);
    yesterdayKey = venueLocalDayKey(candidate, tz);
  }
  return Boolean(yesterdayKey) && eventKey === yesterdayKey;
}

export type ActivityVenueTimeParts = {
  dayLabel: "today" | "yesterday" | "date";
  dateText: string | null;
  timeText: string;
};

export function formatActivityVenueTimeParts(
  iso: string,
  timeZone: string,
  locale = "en-GB",
): ActivityVenueTimeParts {
  const tz = sanitizeBusinessTimezone(timeZone);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { dayLabel: "date", dateText: "—", timeText: "—" };
  }

  const timeText = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);

  if (isWithinVenueLocalDay(d, tz)) {
    return { dayLabel: "today", dateText: null, timeText };
  }
  if (isVenueLocalYesterday(d, tz)) {
    return { dayLabel: "yesterday", dateText: null, timeText };
  }

  const dateText = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);

  return { dayLabel: "date", dateText, timeText };
}
