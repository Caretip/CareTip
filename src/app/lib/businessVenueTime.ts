/**
 * Venue-local calendar helpers for Activity Center / optimistic pulse patches.
 * Matches backend default (`Europe/Berlin`) and uses IANA zones via Intl — no tip KPI math.
 */

export const DEFAULT_BUSINESS_TIMEZONE = "Europe/Berlin";

let cachedBusinessVenueTimezone: string | null = null;

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

/** Remember venue TZ from profile (or other trusted source) for optimistic patches. */
export function setCachedBusinessVenueTimezone(tz: unknown): void {
  cachedBusinessVenueTimezone = sanitizeBusinessTimezone(tz);
}

export function getCachedBusinessVenueTimezone(): string {
  return cachedBusinessVenueTimezone ?? DEFAULT_BUSINESS_TIMEZONE;
}

export function resolveBusinessTimezone(explicit?: string | null): string {
  if (explicit != null && String(explicit).trim()) {
    return sanitizeBusinessTimezone(explicit);
  }
  return getCachedBusinessVenueTimezone();
}

/** YYYY-MM-DD in the given IANA timezone. */
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
  // DST / near-midnight: 24h ago can still be "today" in the venue calendar.
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
  locale: string,
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

/**
 * Tip / transaction date+time in the venue (or platform) IANA zone.
 * Do NOT use date-fns `format(..., { timeZone })` — date-fns ignores `timeZone` without date-fns-tz.
 */
export function formatVenueDateTime(
  iso: string,
  timeZone?: string | null,
  locale = "en",
  opts?: {
    dateStyle?: Intl.DateTimeFormatOptions["dateStyle"];
    timeStyle?: Intl.DateTimeFormatOptions["timeStyle"] | null;
  },
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const tz = resolveBusinessTimezone(timeZone);
  try {
    const timeStyle = opts?.timeStyle === null ? undefined : (opts?.timeStyle ?? "short");
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      dateStyle: opts?.dateStyle ?? "medium",
      ...(timeStyle ? { timeStyle } : {}),
    }).format(d);
  } catch {
    return iso;
  }
}

/** Calendar day label for a YYYY-MM-DD bucket key (no browser TZ shift). */
export function formatVenueDayBucketLabel(
  ymd: string,
  locale = "en",
  timeZone?: string | null,
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  // Noon UTC keeps the civil day stable when formatting in Europe/* zones.
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z`);
  const tz = resolveBusinessTimezone(timeZone);
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return ymd;
  }
}

/** Hour 0–23 in the venue timezone (for shift heuristics). */
export function venueLocalHour(isoOrDate: string | Date, timeZone?: string | null): number {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return NaN;
  const tz = resolveBusinessTimezone(timeZone);
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(d).find((p) => p.type === "hour")?.value;
  return hour != null ? Number(hour) : NaN;
}

/** Step back N venue calendar days from a YYYY-MM-DD key (or from today). */
export function venueLocalDayKeyMinusDays(
  daysAgo: number,
  timeZone?: string | null,
  fromDayKeyOrNow?: string | Date,
): string {
  const tz = resolveBusinessTimezone(timeZone);
  let key =
    typeof fromDayKeyOrNow === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fromDayKeyOrNow)
      ? fromDayKeyOrNow
      : venueLocalDayKey(fromDayKeyOrNow ?? new Date(), tz);
  const n = Math.max(0, Math.floor(daysAgo));
  for (let i = 0; i < n; i += 1) {
    const [y, m, d] = key.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
    key = venueLocalDayKey(prev, tz);
    if (!key) break;
  }
  return key;
}

/**
 * Monday–Sunday venue-local YYYY-MM-DD keys for the week containing `now`
 * (matches backend Monday-start weeks).
 */
export function venueLocalWeekDayKeys(timeZone?: string | null, now = new Date()): string[] {
  const tz = resolveBusinessTimezone(timeZone);
  const todayKey = venueLocalTodayKey(tz, now);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  const monOffset: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const offset = monOffset[wd] ?? 0;
  const mondayKey = venueLocalDayKeyMinusDays(offset, tz, todayKey);
  const keys: string[] = [];
  let cur = mondayKey;
  for (let i = 0; i < 7; i += 1) {
    keys.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
    cur = venueLocalDayKey(next, tz);
  }
  return keys;
}

/** Venue-local calendar year (YYYY) for reporting windows. */
export function venueLocalCalendarYear(timeZone?: string | null, now = new Date()): string {
  return venueLocalTodayKey(resolveBusinessTimezone(timeZone), now).slice(0, 4);
}

/** Venue-local YYYY-MM prefix for “this month” filters. */
export function venueLocalMonthPrefix(timeZone?: string | null, now = new Date()): string {
  return venueLocalTodayKey(resolveBusinessTimezone(timeZone), now).slice(0, 7);
}


