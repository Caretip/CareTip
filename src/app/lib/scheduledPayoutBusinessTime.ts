/**
 * Present a backend payout instant in the employer's IANA timezone.
 * Does not recompute the schedule. The browser timezone is never used.
 */

export type ScheduledPayoutBusinessTime = {
  /** The backend instant, unchanged. */
  instantIso: string;
  dateText: string;
  timeText: string;
  /** IANA zone used for both dateText and timeText. */
  formattedTimeZone: string;
  /** City-style name from the IANA id, only when the business zone is valid. */
  placeName: string | null;
  usesBusinessTimezone: boolean;
};

function intlLocale(locale: string): string {
  return locale.toLowerCase().startsWith("de") ? "de-DE" : "en-GB";
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  const raw = timeZone.trim();
  if (!raw) return false;
  try {
    Intl.DateTimeFormat("en-GB", { timeZone: raw }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Last IANA segment, with underscores shown as spaces. "America/New_York" → "New York". */
export function ianaPlaceName(timeZone: string): string {
  const segment = timeZone.trim().split("/").filter(Boolean).pop() ?? timeZone.trim();
  return segment.replace(/_/g, " ");
}

/**
 * Format `instantIso` in `businessTimezone`.
 * Missing or invalid zones format as UTC and are marked so the label cannot claim another city.
 */
export function formatScheduledPayoutBusinessTime(
  instantIso: string,
  businessTimezone: string | null | undefined,
  locale: string,
): ScheduledPayoutBusinessTime | null {
  const d = new Date(instantIso);
  if (Number.isNaN(d.getTime())) return null;

  const raw = typeof businessTimezone === "string" ? businessTimezone.trim() : "";
  const usesBusinessTimezone = raw.length > 0 && isValidIanaTimeZone(raw);
  const formattedTimeZone = usesBusinessTimezone ? raw : "UTC";
  const loc = intlLocale(locale);

  const dateText = new Intl.DateTimeFormat(loc, {
    timeZone: formattedTimeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
  const timeText = new Intl.DateTimeFormat(loc, {
    timeZone: formattedTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(d)
    .replace(/[\u202f\u00a0]/g, " ");

  return {
    instantIso,
    dateText,
    timeText,
    formattedTimeZone,
    placeName: usesBusinessTimezone ? ianaPlaceName(raw) : null,
    usesBusinessTimezone,
  };
}
